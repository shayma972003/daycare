import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { logAction } from "@/lib/activity-logger";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { formatAst } from "@/lib/datetime";

/**
 * Sends a salary notice to a teacher.
 *
 * The button for this existed on the teacher profile and called
 * `alert("تم الإرسال")` with no request behind it — staff were told a message
 * had gone out when nothing had. This is the endpoint it should have been
 * calling.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  // Each send costs the platform money; an authenticated user should not be
  // able to spam a mailbox by holding the button down.
  const limited = await rateLimit({
    key: `reminder:teacher:${id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const teacher = await prisma.teacher.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone1: true,
      phone2: true,
      monthlySalary: true,
      lateHours: true,
      lateDeductionRate: true,
    },
  });
  if (!teacher) return Response.json({ error: "Not found" }, { status: 404 });

  const email = teacher.email;
  if (!email) {
    return Response.json(
      { error: "لا يوجد بريد إلكتروني مسجّل لهذه المعلمة" },
      { status: 422 }
    );
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });
  const schoolName = school?.name ?? "الحضانة";

  const deduction = teacher.lateHours * teacher.lateDeductionRate;
  const netSalary = Math.max(0, teacher.monthlySalary - deduction);

  const template = [
    "مرحباً <teacher_name>،",
    "",
    "إشعار راتب شهر <month>:",
    "  الراتب الأساسي: <base_salary> ر.س",
    "  خصم التأخير: <deduction> ر.س",
    "  صافي الراتب: <net_salary> ر.س",
    "",
    "مع تحيات <school_name>",
  ].join("\n");

  await sendNotification(
    schoolId,
    teacher.name,
    teacher.phone1 ?? teacher.phone2 ?? null,
    email,
    template,
    {
      teacher_name: teacher.name,
      month: formatAst(new Date(), { year: "numeric", month: "long" }),
      base_salary: teacher.monthlySalary.toFixed(2),
      deduction: deduction.toFixed(2),
      net_salary: netSalary.toFixed(2),
      school_name: schoolName,
    },
    schoolName,
    "teacher_salary"
  );

  await logAction({
    school_id: schoolId,
    action: `إرسال إشعار راتب إلى ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, sentTo: email });
}
