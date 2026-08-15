import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { assertCan } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone-normalizer";
import { env } from "@/lib/env";
import { mintInvite, accountState } from "@/lib/invitations";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const createSchema = z
  .object({
    guardianId: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().min(6).max(20).optional(),
  })
  .strict();

const emailSchema = z.string().trim().email();

class GuardianNotEligibleError extends Error {}
class GuardianEmailRequiredError extends Error {}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function invitationEmail(args: {
  name: string;
  schoolName: string;
  email: string;
  token: string;
}): string {
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  return [
    `مرحبًا ${args.name}،`,
    "",
    `دعتك ${args.schoolName || "الحضانة"} لمتابعة تقارير طفلك عبر التطبيق.`,
    "",
    "اضغطي الرابط لتعيين كلمة المرور الخاصة بك:",
    appUrl ? `${appUrl}/activate/${args.token}` : "",
    "",
    `ثم سجّلي الدخول في التطبيق بالبريد: ${args.email}`,
    "",
    "الرابط صالح لمدة 7 أيام، ولا يعمل إلا مرة واحدة.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Lists only guardians and accounts belonging to the caller's school. */
export async function GET() {
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

  const guardians = await prisma.guardian.findMany({
    where: { schoolId, deletedAt: null, anonymizedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone1: true,
      students: {
        where: { schoolId, deletedAt: null, anonymizedAt: null },
        select: { id: true, name: true },
      },
    },
  });

  // Keep the tenant predicate on the account query even before the database
  // migration is deployed. A malformed legacy row must never ride through a
  // relation selected only by guardianId.
  const accounts = guardians.length
    ? await prisma.guardianAccount.findMany({
        where: { schoolId, guardianId: { in: guardians.map(({ id }) => id) } },
        select: {
          id: true,
          guardianId: true,
          email: true,
          phone: true,
          acceptedAt: true,
          disabledAt: true,
          inviteExpiresAt: true,
          lastLoginAt: true,
        },
      })
    : [];
  const accountByGuardian = new Map(accounts.map((account) => [account.guardianId, account]));

  return Response.json(
    guardians.map((guardian) => {
      const account = accountByGuardian.get(guardian.id) ?? null;
      return {
        guardianId: guardian.id,
        name: guardian.name,
        email: guardian.email,
        phone: guardian.phone1,
        children: guardian.students,
        account: account
          ? {
              id: account.id,
              email: account.email,
              phone: account.phone,
              status: accountState(account),
              inviteExpiresAt: account.inviteExpiresAt,
              lastLoginAt: account.lastLoginAt,
            }
          : null,
      };
    })
  );
}

/** Creates a pending guardian login and its hashed invitation atomically. */
export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  for (const key of [
    `guardian-account-create:${schoolId}:${parsed.data.guardianId}`,
    `guardian-account-create:ip:${clientIp(request)}`,
  ]) {
    const limited = await rateLimit({ key, limit: 5, windowMs: 60 * 60 * 1000 });
    const limitedResponse = rateLimitResponse(limited);
    if (limitedResponse) return limitedResponse;
  }

  const invite = mintInvite();
  let account: {
    id: string;
    email: string;
    phone: string | null;
    guardianName: string;
    schoolName: string;
    schoolEmail: string | null;
  };

  try {
    account = await prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.findFirst({
        where: {
          id: parsed.data.guardianId,
          schoolId,
          deletedAt: null,
          anonymizedAt: null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone1: true,
          school: { select: { name: true, email: true } },
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
      });

      if (!guardian || (guardian.students.length === 0 && guardian.links.length === 0)) {
        throw new GuardianNotEligibleError();
      }

      const emailResult = emailSchema.safeParse(parsed.data.email ?? guardian.email ?? "");
      if (!emailResult.success) throw new GuardianEmailRequiredError();
      const email = emailResult.data.toLowerCase();
      const phone = parsed.data.phone
        ? normalizePhone(parsed.data.phone)
        : guardian.phone1
          ? normalizePhone(guardian.phone1)
          : null;

      const created = await tx.guardianAccount.create({
        data: {
          schoolId,
          guardianId: guardian.id,
          email,
          phone,
          passwordHash: null,
          acceptedAt: null,
          inviteTokenHash: invite.tokenHash,
          inviteExpiresAt: invite.expiresAt,
        },
        select: { id: true, email: true, phone: true },
      });

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `إنشاء دعوة حساب ولي أمر: ${guardian.name}`,
          entity_type: "guardian_account",
          entity_id: created.id,
          entity_name: guardian.name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });

      return {
        ...created,
        guardianName: guardian.name,
        schoolName: guardian.school?.name ?? "",
        schoolEmail: guardian.school?.email ?? null,
      };
    });
  } catch (error) {
    if (error instanceof GuardianEmailRequiredError) {
      return Response.json({ error: "يجب تسجيل بريد إلكتروني صالح لولي الأمر" }, { status: 422 });
    }
    if (error instanceof GuardianNotEligibleError) {
      return Response.json({ error: "ولي الأمر غير مؤهل لإنشاء حساب" }, { status: 409 });
    }
    // Both guardianId and email are globally unique today. Do not reveal
    // whether a collision belongs to this school or a different tenant.
    if (isUniqueConflict(error)) {
      return Response.json({ error: "تعذر إنشاء الحساب بهذه البيانات" }, { status: 409 });
    }
    throw error;
  }

  const delivered = await sendEmail(
    account.email,
    `دعوة للانضمام إلى بوابة ${account.schoolName || "الحضانة"}`,
    invitationEmail({
      name: account.guardianName,
      schoolName: account.schoolName,
      email: account.email,
      token: invite.token,
    }),
    account.schoolName,
    {
      sender: {
        kind: "school",
        displayName: account.schoolName,
        replyTo: account.schoolEmail,
      },
      language: "ar",
    }
  );

  return Response.json(
    {
      id: account.id,
      email: account.email,
      phone: account.phone,
      invitationSent: delivered.success,
      deliveryStatus: delivered.status,
    },
    { status: delivered.success ? 201 : 207 }
  );
}
