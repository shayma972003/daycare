import { requireSession, sessionErrorResponse } from "@/lib/session";
import { assertCan } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { mintInvite } from "@/lib/invitations";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { env } from "@/lib/env";

class GuardianInviteNotFoundError extends Error {}
class GuardianInviteDisabledError extends Error {}
class GuardianInviteActiveError extends Error {}
class GuardianInviteIneligibleError extends Error {}
class GuardianInviteChangedError extends Error {}

/** Rotates an invitation only while the guardian account is still pending. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
    assertCan(session, "students.guardians");
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const schoolId = session.user.schoolId;
  const { id } = await params;
  const limited = await rateLimit({
    key: `guardian-invite:${schoolId}:${id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited, {
    limitedMessage: "تم تجاوز عدد محاولات إرسال الدعوة",
  });
  if (limitedResponse) return limitedResponse;

  const invite = mintInvite();
  let target: {
    id: string;
    email: string;
    name: string;
    schoolName: string;
    schoolEmail: string | null;
  };

  try {
    target = await prisma.$transaction(async (tx) => {
      const account = await tx.guardianAccount.findFirst({
        where: { id, schoolId },
        select: {
          id: true,
          schoolId: true,
          guardianId: true,
          email: true,
          passwordHash: true,
          acceptedAt: true,
          disabledAt: true,
          inviteTokenHash: true,
          inviteExpiresAt: true,
          school: { select: { name: true, email: true } },
          guardian: {
            select: {
              name: true,
              deletedAt: true,
              anonymizedAt: true,
              students: {
                where: {
                  schoolId,
                  status: "ACTIVE",
                  deletedAt: null,
                  anonymizedAt: null,
                },
                take: 1,
                select: { id: true },
              },
              links: {
                where: {
                  student: {
                    is: {
                      schoolId,
                      status: "ACTIVE",
                      deletedAt: null,
                      anonymizedAt: null,
                    },
                  },
                },
                take: 1,
                select: { studentId: true },
              },
            },
          },
        },
      });

      if (!account) throw new GuardianInviteNotFoundError();
      if (account.disabledAt) throw new GuardianInviteDisabledError();
      if (account.passwordHash || account.acceptedAt) throw new GuardianInviteActiveError();
      if (
        !account.guardian ||
        account.guardian.deletedAt ||
        account.guardian.anonymizedAt ||
        (account.guardian.students.length === 0 && account.guardian.links.length === 0)
      ) {
        throw new GuardianInviteIneligibleError();
      }

      // The previous token state is part of the predicate. Concurrent resends
      // cannot both replace the same invitation, even when the old value is null.
      const rotated = await tx.guardianAccount.updateMany({
        where: {
          id: account.id,
          schoolId,
          guardianId: account.guardianId,
          passwordHash: null,
          acceptedAt: null,
          disabledAt: null,
          inviteTokenHash: account.inviteTokenHash,
          inviteExpiresAt: account.inviteExpiresAt,
        },
        data: {
          inviteTokenHash: invite.tokenHash,
          inviteExpiresAt: invite.expiresAt,
        },
      });
      if (rotated.count !== 1) throw new GuardianInviteChangedError();

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `إعادة إرسال دعوة ولي أمر: ${account.guardian.name}`,
          entity_type: "guardian_account",
          entity_id: account.id,
          entity_name: account.guardian.name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });

      return {
        id: account.id,
        email: account.email,
        name: account.guardian.name,
        schoolName: account.school?.name ?? "",
        schoolEmail: account.school?.email ?? null,
      };
    });
  } catch (error) {
    if (error instanceof GuardianInviteNotFoundError) {
      return Response.json({ error: "الحساب غير موجود" }, { status: 404 });
    }
    if (error instanceof GuardianInviteDisabledError) {
      return Response.json({ error: "الحساب معطل" }, { status: 409 });
    }
    if (error instanceof GuardianInviteActiveError) {
      return Response.json(
        { error: "الحساب مفعّل؛ استخدم استعادة كلمة المرور", action: "password_reset" },
        { status: 409 }
      );
    }
    if (error instanceof GuardianInviteIneligibleError) {
      return Response.json({ error: "ولي الأمر غير مؤهل لإعادة الدعوة" }, { status: 409 });
    }
    if (error instanceof GuardianInviteChangedError) {
      return Response.json({ error: "تغيرت حالة الدعوة، أعد المحاولة" }, { status: 409 });
    }
    throw error;
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    target.email,
    `دعوة للانضمام إلى بوابة ${target.schoolName || "الحضانة"}`,
    [
      `مرحبًا ${target.name}،`,
      "",
      "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
      appUrl ? `${appUrl}/activate/${invite.token}` : "",
      "",
      "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
    ]
      .filter(Boolean)
      .join("\n"),
    target.schoolName,
    {
      sender: {
        kind: "school",
        displayName: target.schoolName,
        replyTo: target.schoolEmail,
      },
      language: "ar",
    }
  );

  return Response.json(
    { sent: delivered.success, deliveryStatus: delivered.status },
    { status: delivered.success ? 200 : 207 }
  );
}
