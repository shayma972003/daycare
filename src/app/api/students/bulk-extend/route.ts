import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import { z } from "zod";

const schema = z.object({
  ids: z.array(z.string()).min(1),
  enrollmentEndDate: z.string().min(1),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const { ids, enrollmentEndDate } = parsed.data;
  const newDate = new Date(enrollmentEndDate);
  if (isNaN(newDate.getTime())) {
    return Response.json({ error: "تاريخ غير صحيح" }, { status: 400 });
  }

  const students = await prisma.student.findMany({
    where: { id: { in: ids }, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });

  if (students.length === 0) {
    return Response.json({ error: "لا يوجد طلاب صالحين" }, { status: 400 });
  }

  await prisma.student.updateMany({
    where: { id: { in: students.map((s) => s.id) } },
    data: { enrollmentEndDate: newDate },
  });

  for (const student of students) {
    await generatePaymentCycles(student.id);
  }

  await logAction({
    school_id: schoolId,
    action: `تمديد تاريخ الاشتراك لـ ${students.length} طالب حتى ${newDate.toLocaleDateString("ar-SA")}`,
    entity_type: "student",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, updated: students.length }, { status: 200 });
}
