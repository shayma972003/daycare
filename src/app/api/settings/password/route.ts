import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { passwordSchema, BCRYPT_COST } from "@/lib/password-policy";
import { z } from "zod";
import bcrypt from "bcryptjs";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // Was `min(6)` at cost 10 — the weakest password path in the product, and the
  // one a school admin actually uses. Now on the shared policy.
  newPassword: passwordSchema,
});

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;

  const userEmail = session.user.email;
  if (!userEmail) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Null between invitation and activation. There is no current password to
  // prove, and this route must not become a way to set one without the link.
  const valid = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
  if (!valid) {
    return Response.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { password: hashed, authVersion: { increment: 1 } },
    });
    // A password change is a security boundary: invalidate every stateless web
    // session through authVersion and remove unfinished one-time sessions too.
    await tx.twoFASession.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
  });

  await logAction({
    school_id: session.user.schoolId,
    action: "تم تغيير كلمة المرور",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
