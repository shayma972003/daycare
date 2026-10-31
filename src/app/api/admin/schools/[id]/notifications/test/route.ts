import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { enqueuePushToDevice } from "@/lib/push";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const schema = z.object({ deviceId: z.string().min(1).max(200) }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: schoolId } = await params;
  for (const { key, limit } of [
    { key: `support-test-push:${session.adminId}:${schoolId}`, limit: 10 },
    { key: `support-test-push:ip:${clientIp(request)}`, limit: 20 },
  ]) {
    const limited = await rateLimit({ key, limit, windowMs: 15 * 60 * 1000 });
    const limitedResponse = rateLimitResponse(limited);
    if (limitedResponse) return limitedResponse;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const queued = await enqueuePushToDevice(
    { schoolId, deviceTokenId: parsed.data.deviceId },
    {
      title: "اختبار إشعارات طفولة تيك",
      body: "تم استلام إشعار الاختبار بنجاح.",
      data: { screen: "notifications", kind: "support_test" },
    }
  );
  if (!queued) {
    return Response.json(
      { error: "الجهاز غير متاح أو أن الحساب غير مفعل" },
      { status: 409 }
    );
  }

  await prisma.adminActivityLog.create({
    data: {
      school_id: schoolId,
      action: "support_test_notification_queued",
      metadata: { deviceId: parsed.data.deviceId },
      performed_by: session.adminId,
    },
  });

  return Response.json({ queued: true });
}
