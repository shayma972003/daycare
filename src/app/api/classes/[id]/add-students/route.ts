import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const schema = z.object({
  studentIds: z.array(z.string()).min(1),
});

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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

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

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: null },
  });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const students = await prisma.student.findMany({
    where: {
      id: { in: parsed.data.studentIds },
      schoolId,
      deletedAt: null,
      classId: null,
    },
    select: { id: true, name: true },
  });

  if (students.length === 0) {
    return Response.json({ error: "لا يوجد طلاب صالحين للإضافة" }, { status: 400 });
  }

  await prisma.student.updateMany({
    where: { id: { in: students.map((s) => s.id) } },
    data: { classId: id, needsClassWarning: false },
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة ${students.length} طالب إلى الفصل: ${cls.name}`,
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, added: students.length }, { status: 200 });
}
