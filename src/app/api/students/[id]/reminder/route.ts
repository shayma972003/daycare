import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

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
    "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <amount_due> ريال تستحق بتاريخ <due_date>. مع تحيات <school_name>";

  const schoolName = school?.name ?? "الروضة";
  const monthlyStudentFee = student.registration_fee ?? settings?.monthlyStudentFee ?? 0;

  const now = new Date();
  const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dueDate = nextMonthFirst.toISOString().split("T")[0];

  const guardianName = student.guardian?.name ?? student.name;
  const phone = student.guardian?.phone1 ?? student.guardian?.phone2 ?? null;
  const email = student.guardian?.email ?? null;

  await sendNotification(
    schoolId,
    guardianName,
    phone,
    email,
    reminderTemplate,
    {
      child_name: student.name,
      guardian_name: guardianName,
      amount_due: String(monthlyStudentFee),
      due_date: dueDate,
      school_name: schoolName,
    },
    schoolName,
    "reminder"
  );

  return Response.json({ success: true });
}
