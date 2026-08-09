import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { mintInvite } from "@/lib/invitations";
import { env } from "@/lib/env";

/**
 * Send — or resend — a staff invitation.
 *
 * Without this an expired link is a dead end: the account exists, so it cannot
 * be created again, and it has no password, so nobody can sign in to fix it.
 * Seven days is short enough that this will happen.
 *
 * Also the route for an account created before invitations existed, whose owner
 * has lost the password that was once mailed to them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  // Scoped to the school: an id from the client is not proof of anything.
  const user = await prisma.user.findFirst({
    where: { id, schoolId },
    select: {
      id: true,
      name: true,
      email: true,
      disabledAt: true,
      roleRef: { select: { nameAr: true } },
      school: { select: { name: true } },
    },
  });
  if (!user) {
    return Response.json({ error: "الحساب غير موجود" }, { status: 404 });
  }
  if (user.disabledAt) {
    return Response.json(
      { error: "الحساب معطَّل — فعّليه أولاً" },
      { status: 409 }
    );
  }

  /**
   * A fresh token replaces the old one.
   *
   * The previous link stops working the moment this is written, which is the
   * point: two live invitations to one account means the older mailbox keeps a
   * way in after the address has been corrected.
   *
   * `password` is deliberately not cleared. Someone who has already set one
   * keeps it until the new link is actually used — a resend that locked them
   * out in the meantime would be worse than the problem it solves.
   */
  const invite = mintInvite();
  await prisma.user.update({
    where: { id: user.id },
    data: { inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    user.email,
    `دعوة للانضمام إلى ${user.school?.name ?? "الحضانة"}`,
    [
      `مرحباً ${user.name}،`,
      "",
      `دعتك ${user.school?.name ?? "الحضانة"} للانضمام${
        user.roleRef?.nameAr ? ` بصلاحية: ${user.roleRef.nameAr}` : ""
      }`,
      "",
      "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
      appUrl ? `${appUrl}/activate/${invite.token}` : "",
      "",
      "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
    ]
      .filter(Boolean)
      .join("\n"),
    user.school?.name ?? ""
  );

  await logAction({
    school_id: schoolId,
    action: `إعادة إرسال دعوة: ${user.name}`,
    entity_type: "staff_account",
    entity_id: user.id,
    entity_name: user.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  // Reported rather than thrown: the token was rotated either way, and the
  // nursery needs to know the message did not go out so it can fix the mail
  // settings instead of waiting.
  return Response.json({ sent: delivered.success });
}
