import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/notifications";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  rotateSchoolAdminInvite,
  SchoolAdminAlreadyActiveError,
  SchoolAdminInviteNotFoundError,
} from "@/lib/school-admin-invitations";

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: schoolId } = await params;
  for (const { key, limit } of [
    { key: `school-admin-invite:${session.adminId}`, limit: 10 },
    { key: `school-admin-invite:ip:${clientIp(request)}`, limit: 20 },
  ]) {
    const limited = await rateLimit({ key, limit, windowMs: 15 * 60 * 1000 });
    const limitedResponse = rateLimitResponse(limited);
    if (limitedResponse) return limitedResponse;
  }

  let invitation;
  try {
    invitation = await rotateSchoolAdminInvite(schoolId, session.adminId);
  } catch (error) {
    if (error instanceof SchoolAdminInviteNotFoundError) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof SchoolAdminAlreadyActiveError) {
      return Response.json(
        { error: "الحساب مفعّل بالفعل ولا يحتاج إلى دعوة" },
        { status: 409 }
      );
    }
    if (isUniqueConstraintError(error)) {
      return Response.json(
        { error: "تم تدوير الدعوة من طلب آخر. أعد المحاولة عند الحاجة." },
        { status: 409 }
      );
    }

    console.error("[admin-schools] invitation rotation failed", schoolId);
    return Response.json({ error: "تعذر إعادة إرسال الدعوة" }, { status: 500 });
  }

  const delivery = await sendEmail(
    invitation.email,
    `دعوة لإدارة ${invitation.schoolName}`,
    [
      `مرحباً ${invitation.name}،`,
      "",
      `تم إصدار رابط جديد لتفعيل حساب إدارة ${invitation.schoolName}.`,
      "اختاري كلمة المرور الخاصة بك من الرابط التالي:",
      `${env.APP_URL}/activate/${invitation.token}`,
      "",
      "الرابط صالح لمدة 7 أيام ولا يعمل إلا مرة واحدة. الرابط السابق لم يعد صالحاً.",
    ].join("\n"),
    invitation.schoolName
  );

  if (!delivery.success) {
    console.error("[admin-schools] invitation email delivery failed", schoolId);
  }

  return Response.json(
    {
      invitationStatus: "pending",
      emailDelivery: delivery.success ? "sent" : "failed",
    },
    {
      status: delivery.success ? 200 : 207,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
