import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ student_id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { student_id } = await params;

  const [school, student, invoiceCount] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.student.findFirst({
      where: { id: student_id, schoolId },
      include: { class: true, guardian: true },
    }),
    prisma.invoice.count({ where: { schoolId } }),
  ]);

  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const invoiceNumber = "INV-" + String(invoiceCount + 1).padStart(4, "0");

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const issuedAt = `${dd}/${mm}/${yyyy}`;

  // Current month activities for student's class with fee > 0
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const activities = student.classId
    ? await prisma.activity.findMany({
        where: {
          schoolId,
          activityFee: { gt: 0 },
          startDate: { gte: monthStart, lte: monthEnd },
          activityInvites: { some: { classId: student.classId } },
        },
        select: { id: true, name: true, activityFee: true },
      })
    : [];

  return Response.json(
    {
      school: {
        name: school?.name ?? "",
        logoUrl: school?.logoUrl ?? null,
        commercialRegistration: school?.commercialRegistration ?? null,
        vatNumber: school?.vatNumber ?? null,
        contactNumber: school?.contactNumber ?? null,
        email: school?.email ?? null,
        address: school?.address ?? null,
      },
      student: {
        name: student.name,
        idNumber: student.idNumber ?? null,
        className: student.class?.name ?? null,
        paymentMethod: student.paymentMethod,
      },
      guardian: {
        name: student.guardian?.name ?? null,
        phone1: student.guardian?.phone1 ?? null,
        email: student.guardian?.email ?? null,
      },
      invoiceNumber,
      issuedAt,
      activities: activities.map((a) => ({ id: a.id, name: a.name, fee: a.activityFee })),
    },
    { status: 200 }
  );
}
