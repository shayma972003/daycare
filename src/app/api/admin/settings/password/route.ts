import {
  buildAdminCookieHeader,
  signAdminToken,
  verifyAdminSessionFromRequest,
} from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { BCRYPT_COST, passwordSchema } from "@/lib/password-policy";
import {
  clientIp,
  rateLimit,
  rateLimitResponse,
  resetRateLimit,
} from "@/lib/rate-limit";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

class ConcurrentPasswordChangeError extends Error {}

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const accountLimitKey = `admin-password:${session.adminId}`;
  for (const { key, limit } of [
    { key: accountLimitKey, limit: 5 },
    { key: `admin-password:ip:${clientIp(request)}`, limit: 10 },
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
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const admin = await prisma.superAdmin.findUnique({
    where: { id: session.adminId },
  });
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const valid = await bcrypt.compare(
    parsed.data.currentPassword,
    admin.password_hash
  );
  if (!valid) {
    return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 401 });
  }

  const reusesCurrentPassword = await bcrypt.compare(
    parsed.data.newPassword,
    admin.password_hash
  );
  if (reusesCurrentPassword) {
    return Response.json({ error: "اختر كلمة مرور جديدة" }, { status: 400 });
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  // Sign first: if local JWT creation ever fails, the password remains intact.
  const replacementToken = await signAdminToken(admin.id, hash);

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.superAdmin.updateMany({
        where: { id: admin.id, password_hash: admin.password_hash },
        data: { password_hash: hash },
      });
      if (updated.count !== 1) throw new ConcurrentPasswordChangeError();

      await tx.adminActivityLog.create({
        data: {
          action: "admin_password_changed",
          performed_by: "super_admin",
          metadata: { adminId: admin.id },
        },
      });
    });
  } catch (error) {
    if (error instanceof ConcurrentPasswordChangeError) {
      return Response.json(
        { error: "تم تغيير كلمة المرور من جلسة أخرى" },
        { status: 409 }
      );
    }
    console.error("[admin-password] change failed");
    return Response.json({ error: "تعذر تغيير كلمة المرور" }, { status: 500 });
  }

  await resetRateLimit(accountLimitKey);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": buildAdminCookieHeader(replacementToken),
    },
  });
}
