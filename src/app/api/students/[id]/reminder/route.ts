import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { buildMessageVars } from "@/lib/message-variables";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId },
    include: { class: true, guardian: true },
  });

  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId } }),
  ]);

  const reminderTemplate =
    settings?.reminderTemplate ??
    "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <subscription_fee> تستحق بتاريخ <due_date>. مع تحيات <school_name>";

  const schoolName = school?.name ?? "الروضة";

  const guardianName = student.guardian?.name ?? student.name;
  const phone = student.guardian?.phone1 ?? student.guardian?.phone2 ?? null;
  const email = student.guardian?.email ?? null;

  const vars = buildMessageVars({
    student: {
      name: student.name,
      registration_fee: student.registration_fee ?? settings?.monthlyStudentFee,
      enrollmentEndDate: student.enrollmentEndDate,
    },
    guardian: {
      name: student.guardian?.name,
      name_2: student.guardian?.name_2,
    },
    school: {
      name: school?.name,
      studentCheckinTime: school?.studentCheckinTime,
      studentCheckoutTime: school?.studentCheckoutTime,
    },
  });

  await sendNotification(
    schoolId,
    guardianName,
    phone,
    email,
    reminderTemplate,
    vars,
    schoolName,
    "reminder"
  );

  return Response.json({ success: true });
}
