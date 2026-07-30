import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const schema = z.object({
  ids: z.array(z.string()).min(1),
  paymentStatus: z.string().min(1),
});

export async function PUT(request: Request) {
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
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, paymentStatus } = parsed.data;

  await prisma.student.updateMany({
    where: { id: { in: ids }, schoolId },
    data: { paymentStatus },
  });

  await logAction({
    school_id: schoolId,
    action: `تغيير حالة دفع ${ids.length} طالب إلى ${paymentStatus}`,
    entity_type: "student",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ updated: ids.length });
}
