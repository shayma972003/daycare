import { requireSession, sessionErrorResponse } from "@/lib/session";
import { assertCan } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { mintInvite } from "@/lib/invitations";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { env } from "@/lib/env";

class StaffInviteNotFoundError extends Error {}
class StaffInviteDisabledError extends Error {}
class StaffInviteActiveError extends Error {}
class StaffInviteOwnerError extends Error {}
class StaffInviteChangedError extends Error {}

/** Rotates a pending staff invitation and keeps the old token invalid. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
    assertCan(session, "staff.manage");
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const schoolId = session.user.schoolId;
  const { id } = await params;
  const limited = await rateLimit({
    key: `staff-invite:${schoolId}:${id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited, {
    limitedMessage: "تم تجاوز عدد محاولات إرسال الدعوة",
  });
  if (limitedResponse) return limitedResponse;

  const invite = mintInvite();
  let user: {
    id: string;
    name: string;
    email: string;
    roleName: string | null;
    schoolName: string;
    schoolEmail: string | null;
  };

  try {
    user = await prisma.$transaction(async (tx) => {
      // Tenant scope is part of the lookup, so another nursery's id receives
      // the same not-found response as a random id.
      const target = await tx.user.findFirst({
        where: { id, schoolId },
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          acceptedAt: true,
          disabledAt: true,
          roleId: true,
          roleRef: { select: { nameAr: true, permissions: true } },
          school: { select: { name: true, email: true } },
        },
      });
      if (!target) throw new StaffInviteNotFoundError();
      if (target.disabledAt) throw new StaffInviteDisabledError();
      if (target.password || target.acceptedAt) throw new StaffInviteActiveError();

      const firstUser = await tx.user.findFirst({
        where: { schoolId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (
        firstUser?.id === target.id ||
        target.roleRef?.permissions.includes(ALL_PERMISSIONS)
      ) {
        throw new StaffInviteOwnerError();
      }

      // Include every eligibility field in the write predicate. If activation,
      // disabling, tenant movement, or role reassignment races this request,
      // the stale read cannot rotate a token afterward.
      const rotated = await tx.user.updateMany({
        where: {
          id: target.id,
          schoolId,
          password: null,
          acceptedAt: null,
          disabledAt: null,
          roleId: target.roleId,
          NOT: {
            roleRef: { is: { permissions: { has: ALL_PERMISSIONS } } },
          },
        },
        data: {
          inviteTokenHash: invite.tokenHash,
          inviteExpiresAt: invite.expiresAt,
        },
      });
      if (rotated.count !== 1) throw new StaffInviteChangedError();

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `إعادة إرسال دعوة: ${target.name}`,
          entity_type: "staff_account",
          entity_id: target.id,
          entity_name: target.name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });

      return {
        id: target.id,
        name: target.name,
        email: target.email,
        roleName: target.roleRef?.nameAr ?? null,
        schoolName: target.school?.name ?? "",
        schoolEmail: target.school?.email ?? null,
      };
    });
  } catch (error) {
    if (error instanceof StaffInviteNotFoundError) {
      return Response.json({ error: "الحساب غير موجود" }, { status: 404 });
    }
    if (error instanceof StaffInviteDisabledError) {
      return Response.json({ error: "الحساب معطل — فعّليه أولاً" }, { status: 409 });
    }
    if (error instanceof StaffInviteActiveError) {
      return Response.json({ error: "الحساب مفعّل بالفعل" }, { status: 409 });
    }
    if (error instanceof StaffInviteOwnerError) {
      return Response.json({ error: "لا يمكن إرسال دعوة لحساب المالك" }, { status: 403 });
    }
    if (error instanceof StaffInviteChangedError) {
      return Response.json({ error: "تغيرت حالة الحساب، أعيدي المحاولة" }, { status: 409 });
    }
    throw error;
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    user.email,
    `دعوة للانضمام إلى ${user.schoolName || "الحضانة"}`,
    [
      `مرحباً ${user.name}،`,
      "",
      `دعتك ${user.schoolName || "الحضانة"} للانضمام${
        user.roleName ? ` بصلاحية: ${user.roleName}` : ""
      }`,
      "",
      "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
      appUrl ? `${appUrl}/activate/${invite.token}` : "",
      "",
      "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
    ]
      .filter(Boolean)
      .join("\n"),
    user.schoolName,
    {
      sender: {
        kind: "school",
        displayName: user.schoolName,
        replyTo: user.schoolEmail,
      },
      language: "ar",
    }
  );

  return Response.json(
    {
      sent: delivered.success,
      deliveryStatus: delivered.status,
    },
    { status: delivered.success ? 200 : 207 }
  );
}
