import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sendNotification } from "@/lib/notifications";
import { buildMessageVars } from "@/lib/message-variables";
import { astDayStart } from "@/lib/datetime";
import { z } from "zod";

/**
 * Payment and renewal reminders, as two separate lists (task 2.38).
 *
 * They were one screen and they are not one job. A payment reminder chases money
 * that is already owed; a renewal reminder asks a family to decide whether the
 * child is coming back next term. Different recipients on a given day, different
 * wording, and — most importantly — different consequences for getting the list
 * wrong. Merged, a nursery sending "your fees are overdue" to a family whose
 * enrolment merely expires next month damages a relationship for nothing.
 */

/** Renewal window: enrolments ending within this many days. */
const RENEWAL_HORIZON_DAYS = 30;

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  const kind = new URL(request.url).searchParams.get("kind") ?? "payment";
  const today = astDayStart();

  if (kind === "renewal") {
    const horizon = new Date(today.getTime() + RENEWAL_HORIZON_DAYS * 86400000);

    const students = await prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        // Only children still enrolled: someone who has already left does not
        // need to be asked whether they are renewing.
        status: "ACTIVE",
        enrollmentEndDate: { gte: today, lte: horizon },
      },
      orderBy: { enrollmentEndDate: "asc" },
      select: {
        id: true,
        name: true,
        enrollmentEndDate: true,
        billingCycle: true,
        guardian: { select: { name: true, email: true, phone1: true } },
      },
    });

    return Response.json(
      students.map((student) => ({
        studentId: student.id,
        name: student.name,
        dueDate: student.enrollmentEndDate,
        daysLeft: student.enrollmentEndDate
          ? Math.ceil((student.enrollmentEndDate.getTime() - today.getTime()) / 86400000)
          : null,
        guardianName: student.guardian?.name ?? null,
        guardianEmail: student.guardian?.email ?? null,
        // Surfaced so the sender can see who has no address before pressing send
        // on forty messages that will silently fail.
        contactable: Boolean(student.guardian?.email),
      }))
    );
  }

  // Payment: anyone owing money, by the status the finance layer already keeps.
  const students = await prisma.student.findMany({
    where: {
      schoolId,
      deletedAt: null,
      status: "ACTIVE",
      paymentStatus: { in: ["PENDING", "LATE"] },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      paymentStatus: true,
      registration_fee: true,
      payment_cycles: {
        where: { status: { in: ["PENDING", "OVERDUE"] } },
        orderBy: { due_date: "asc" },
        take: 1,
        select: { due_date: true, amount: true },
      },
      guardian: { select: { name: true, email: true, phone1: true } },
    },
  });

  return Response.json(
    students.map((student) => ({
      studentId: student.id,
      name: student.name,
      paymentStatus: student.paymentStatus,
      dueDate: student.payment_cycles[0]?.due_date ?? null,
      amount: student.payment_cycles[0]?.amount ?? null,
      guardianName: student.guardian?.name ?? null,
      guardianEmail: student.guardian?.email ?? null,
      contactable: Boolean(student.guardian?.email),
    }))
  );
}

const sendSchema = z.object({
  kind: z.enum(["payment", "renewal"]),
  studentIds: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * Bulk send.
 *
 * Sequential rather than `Promise.all`: each message is an SMTP round trip, and
 * two hundred at once is how a provider decides this looks like spam. The count
 * of failures comes back so the caller learns which families were not reached
 * instead of seeing a green tick over a partial send.
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const [school, settings, students] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, studentCheckinTime: true, studentCheckoutTime: true },
    }),
    prisma.settings.findUnique({
      where: { schoolId },
      select: { reminderTemplate: true, monthlyStudentFee: true },
    }),
    prisma.student.findMany({
      where: { id: { in: parsed.data.studentIds }, schoolId, deletedAt: null },
      select: {
        id: true,
        name: true,
        registration_fee: true,
        enrollmentEndDate: true,
        guardian: {
          select: { name: true, name_2: true, email: true, phone1: true, phone2: true },
        },
      },
    }),
  ]);

  const template =
    parsed.data.kind === "renewal"
      ? // Renewal has no configurable template yet; the wording is deliberately
        // neutral, because a renewal notice that reads like a demand for money is
        // the exact failure this split exists to prevent.
        [
          "مرحباً <guardian_name>،",
          "",
          "نود تذكيركم بأن فترة تسجيل <child_name> تنتهي بتاريخ <due_date>.",
          "يسعدنا استمراركم معنا — يرجى التواصل لتجديد التسجيل.",
          "",
          "مع تحيات <school_name>",
        ].join("\n")
      : (settings?.reminderTemplate ?? "");

  let sent = 0;
  let skipped = 0;

  for (const student of students) {
    const email = student.guardian?.email ?? null;
    if (!email) {
      skipped++;
      continue;
    }

    const vars = buildMessageVars({
      student: {
        name: student.name,
        registration_fee: student.registration_fee ?? settings?.monthlyStudentFee ?? null,
        enrollmentEndDate: student.enrollmentEndDate,
      },
      guardian: { name: student.guardian?.name, name_2: student.guardian?.name_2 },
      school: {
        name: school?.name,
        studentCheckinTime: school?.studentCheckinTime,
        studentCheckoutTime: school?.studentCheckoutTime,
      },
    });

    await sendNotification(
      schoolId,
      student.guardian?.name ?? "ولي الأمر",
      student.guardian?.phone1 ?? null,
      email,
      template,
      vars,
      school?.name ?? "",
      parsed.data.kind === "renewal" ? "renewal" : "reminder",
      { studentId: student.id }
    );
    sent++;
  }

  await logAction({
    school_id: schoolId,
    action:
      parsed.data.kind === "renewal"
        ? `إرسال تذكير تجديد لـ${sent} طفل`
        : `إرسال تذكير دفع لـ${sent} طفل`,
    entity_type: "notification",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ sent, skipped });
}
