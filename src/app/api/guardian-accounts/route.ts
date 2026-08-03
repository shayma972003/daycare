import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { sendEmail } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone-normalizer";
import { env } from "@/lib/env";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

/**
 * Guardian portal accounts (task 1.9).
 *
 * The flow is: the nursery creates the child → invites the guardian by email →
 * the guardian signs in with their phone number and an emailed code. There is no
 * self-registration: a parent cannot claim a child, the nursery grants access.
 * That is the only defensible direction for an account that can read a child's
 * daily reports.
 */

export async function GET() {
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

  const guardians = await prisma.guardian.findMany({
    where: { schoolId, deletedAt: null, anonymizedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone1: true,
      students: {
        where: { deletedAt: null },
        select: { id: true, name: true },
      },
      account: {
        select: {
          id: true,
          email: true,
          phone: true,
          acceptedAt: true,
          disabledAt: true,
          inviteExpiresAt: true,
          lastLoginAt: true,
        },
      },
    },
  });

  return Response.json(
    guardians.map((guardian) => ({
      guardianId: guardian.id,
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone1,
      children: guardian.students,
      account: guardian.account
        ? {
            id: guardian.account.id,
            email: guardian.account.email,
            phone: guardian.account.phone,
            // Three distinct states the UI needs to tell apart: invited but not
            // yet used, active, and switched off.
            status: guardian.account.disabledAt
              ? "disabled"
              : guardian.account.acceptedAt
                ? "active"
                : "invited",
            inviteExpiresAt: guardian.account.inviteExpiresAt,
            lastLoginAt: guardian.account.lastLoginAt,
          }
        : null,
    }))
  );
}

const createSchema = z.object({
  guardianId: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(20).optional(),
});

/** Seven days: long enough to survive a weekend, short enough to expire. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
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

  const guardian = await prisma.guardian.findFirst({
    where: { id: parsed.data.guardianId, schoolId, deletedAt: null },
    include: {
      account: { select: { id: true } },
      students: { where: { deletedAt: null }, select: { id: true } },
      school: { select: { name: true } },
    },
  });
  if (!guardian) {
    return Response.json({ error: "ولي الأمر غير موجود" }, { status: 404 });
  }

  // An account with no children would sign in to an empty portal and, worse,
  // would keep whatever access a later mis-linked child gave it.
  if (guardian.students.length === 0) {
    return Response.json(
      { error: "لا يوجد أطفال مرتبطون بولي الأمر هذا" },
      { status: 409 }
    );
  }

  const email = (parsed.data.email ?? guardian.email ?? "").toLowerCase().trim();
  if (!email) {
    return Response.json(
      { error: "لا يوجد بريد إلكتروني لولي الأمر — أضفه أولاً" },
      { status: 422 }
    );
  }

  const phone = parsed.data.phone
    ? normalizePhone(parsed.data.phone)
    : guardian.phone1
      ? normalizePhone(guardian.phone1)
      : null;

  // The phone is the sign-in identifier, so without one the account exists but
  // cannot be used — refused now rather than discovered by a confused parent.
  if (!phone) {
    return Response.json(
      { error: "لا يوجد رقم جوال لولي الأمر — أضفه أولاً" },
      { status: 422 }
    );
  }

  // `GuardianAccount.email` is unique across the platform, so a clash may be
  // with another tenant. The message does not say which — the same
  // enumeration reasoning as the staff route.
  const emailTaken = await prisma.guardianAccount.findFirst({
    where: { email, NOT: { guardianId: guardian.id } },
    select: { id: true },
  });
  if (emailTaken) {
    return Response.json({ error: "البريد مستخدم في حساب آخر" }, { status: 409 });
  }

  /**
   * The invitation token is stored hashed and returned once.
   *
   * Same rule as password reset: a database row must not be a working
   * invitation. The plaintext exists only in the email that is about to be sent.
   */
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const account = await prisma.guardianAccount.upsert({
    where: { guardianId: guardian.id },
    create: {
      schoolId,
      guardianId: guardian.id,
      email,
      phone,
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    // Re-inviting refreshes the token rather than creating a second account, and
    // deliberately does not clear `acceptedAt`: resending the email to a parent
    // who already signed in must not lock them out.
    update: {
      email,
      phone,
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { id: true, email: true, phone: true },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  const delivered = await sendEmail(
    email,
    `دعوة للانضمام إلى بوابة ${guardian.school?.name ?? "الحضانة"}`,
    [
      `مرحباً ${guardian.name}،`,
      "",
      `دعتك ${guardian.school?.name ?? "الحضانة"} لمتابعة تقارير طفلك عبر البوابة والتطبيق.`,
      "",
      `رقم الجوال المسجَّل: ${phone}`,
      "سجّل الدخول برقم جوالك وسيصلك رمز تحقق على هذا البريد.",
      "",
      appUrl ? `الرابط: ${appUrl}/portal?invite=${token}` : "",
      "",
      "الدعوة صالحة لمدة 7 أيام.",
    ]
      .filter(Boolean)
      .join("\n"),
    guardian.school?.name ?? ""
  );

  await logAction({
    school_id: schoolId,
    action: `دعوة ولي أمر إلى البوابة: ${guardian.name}`,
    entity_type: "guardian_account",
    entity_id: account.id,
    entity_name: guardian.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(
    { ...account, invitationSent: delivered.success },
    { status: 201 }
  );
}
