import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { PAYMENT_STATUSES } from "@/lib/payment-status";
import { z } from "zod";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  // Was z.string().min(1), so any text at all could be written into the column.
  paymentStatus: z.enum(PAYMENT_STATUSES),
});

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { ids, paymentStatus } = parsed.data;

  const { count } = await prisma.student.updateMany({
    // `deletedAt: null` was missing, so students sitting in the trash were
    // silently mutated along with the live ones.
    where: { id: { in: ids }, schoolId, deletedAt: null },
    data: { paymentStatus },
  });

  await logAction({
    school_id: schoolId,
    action: `تغيير حالة دفع ${count} طفل إلى ${paymentStatus}`,
    entity_type: "student",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  // Reports how many rows actually changed, not how many were requested.
  return Response.json({ updated: count });
}
