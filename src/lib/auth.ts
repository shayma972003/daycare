import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { logAction } from "@/lib/activity-logger";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { astDayStart } from "@/lib/datetime";

function generateOTP(): string {
  return String(randomInt(100000, 1000000));
}

/** Failed sign-ins allowed per account before it is locked for the window. */
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Compared against when no user matches, so a wrong email and a wrong password
 * take the same time. Returning early on an unknown address turned response
 * latency into an account-existence oracle.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.iVMhrpZ9zXBcVBrEXvXJZgFqbrJmZ7q";

/** Errors that carry meaning to the sign-in UI and must reach it unaltered. */
const SIGNAL_ERRORS = [
  "2FA_REQUIRED:",
  "2FA_DELIVERY_FAILED",
  "ACCOUNT_LOCKED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
];

/**
 * Whether a school's subscription bars its users from signing in.
 *
 * Returns the signal string for the sign-in page, or null when access is fine.
 * Expiry is judged against the AST business day so a renewal dated today is
 * still valid for the whole of today.
 */
function subscriptionBlockReason(school: {
  subscription_status: string;
  renewal_date: Date | null;
} | null): string | null {
  if (!school) return null;

  if (school.subscription_status === "suspended") return "SUBSCRIPTION_SUSPENDED";
  if (school.subscription_status === "cancelled") return "SUBSCRIPTION_SUSPENDED";
  if (school.subscription_status === "expired") return "SUBSCRIPTION_EXPIRED";

  // A renewal date in the past means expired even if the status field lags —
  // the nightly alerts job is what flips that flag, and it may not have run.
  if (school.renewal_date && school.renewal_date < astDayStart()) {
    return "SUBSCRIPTION_EXPIRED";
  }

  return null;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        twofa_bypass_token: { label: "2FA Bypass Token", type: "text" },
      },
      async authorize(credentials) {
        try {
          // Bypass-token path: completes login after successful 2FA verification
          if (credentials?.twofa_bypass_token) {
            const hash = createHash("sha256").update(credentials.twofa_bypass_token).digest("hex");
            const session = await prisma.twoFASession.findFirst({
              where: {
                bypassTokenHash: hash,
                bypassExpires: { gt: new Date() },
                verified: true,
                purpose: "LOGIN",
              },
            });
            if (!session || !session.userId) return null;

            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              include: { school: true },
            });
            if (!user) return null;

            // Single-use: clear bypass fields immediately
            await prisma.twoFASession.update({
              where: { id: session.id },
              data: { bypassTokenHash: null, bypassExpires: null },
            });

            prisma.school.update({
              where: { id: user.schoolId },
              data: { last_login_at: new Date() },
            }).catch(() => {});

            logAction({
              school_id: user.schoolId,
              action: "تم تسجيل الدخول إلى الحساب",
              entity_type: "auth",
              performed_by: user.name ?? "المدير",
            }).catch(() => {});

            return {
              id: user.id,
              email: user.email,
              name: user.name,
              schoolId: user.schoolId,
              schoolName: user.school?.name ?? user.name,
              role: user.role,
            };
          }

          if (!credentials?.email || !credentials?.password) return null;

          const email = credentials.email.toLowerCase().trim();
          const lockKey = `login:${email}`;

          // Lock the account after repeated failures. Checked before the
          // password comparison so a locked account costs an attacker nothing
          // to probe and gains them nothing.
          const attempt = await rateLimit({
            key: lockKey,
            limit: MAX_LOGIN_ATTEMPTS,
            windowMs: LOGIN_LOCKOUT_MS,
          });
          if (!attempt.ok) {
            throw new Error("ACCOUNT_LOCKED");
          }

          const user = await prisma.user.findUnique({
            where: { email },
            include: { school: true },
          });

          // Always run a comparison, even with no user, to keep timing flat.
          const isValid = await bcrypt.compare(
            credentials.password,
            user?.password ?? DUMMY_HASH
          );

          if (!user || !isValid) return null;

          // Credentials are correct — clear the counter so an earlier typo does
          // not carry over into the next sign-in.
          await resetRateLimit(lockKey);

          // The admin panel writes `subscription_status` and `renewal_date` but
          // nothing ever read them, so a suspended or expired school kept full
          // access to the product. Suspension was a label, not a control.
          const blocked = subscriptionBlockReason(user.school);
          if (blocked) throw new Error(blocked);

          if (user.school?.twoFaEnabled) {
            const otp = generateOTP();
            const otpCodeHash = await bcrypt.hash(otp, 10);
            const twoFaSession = await prisma.twoFASession.create({
              data: {
                schoolId: user.schoolId,
                userId: user.id,
                purpose: "LOGIN",
                otpCodeHash,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });

            // Delivered by email: the account's own address, so 2FA is per-user
            // rather than shared across everyone at the school.
            const sent = await sendEmail(
              user.email,
              "رمز التحقق بخطوتين",
              `رمز التحقق بخطوتين: ${otp}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
              user.school.name
            );

            if (!sent.success) {
              console.error("[auth] failed to deliver 2FA code", user.schoolId);
              throw new Error("2FA_DELIVERY_FAILED");
            }

            // Masked hint shown on the OTP screen, e.g. "sa***@example.com".
            const [local, domain] = user.email.split("@");
            const hint = `${local.slice(0, 2)}***@${domain ?? ""}`;
            throw new Error(`2FA_REQUIRED:${twoFaSession.id}:${hint}`);
          }

          // Track last login time (fire-and-forget)
          prisma.school.update({
            where: { id: user.schoolId },
            data: { last_login_at: new Date() },
          }).catch(() => {});

          logAction({
            school_id: user.schoolId,
            action: "تم تسجيل الدخول إلى الحساب",
            entity_type: "auth",
            performed_by: user.name ?? "المدير",
          }).catch(() => {});

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            schoolId: user.schoolId,
            schoolName: user.school?.name ?? user.name,
            role: user.role,
          };
        } catch (err) {
          // These are signals to the sign-in page, not failures. Swallowing them
          // would collapse "your account is locked" into a generic "wrong
          // password" and leave the user retrying against a closed door.
          if (err instanceof Error && SIGNAL_ERRORS.some((p) => err.message.startsWith(p))) {
            throw err;
          }
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any;
        token.schoolId = u.schoolId;
        token.schoolName = u.schoolName;
        token.role = u.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { schoolId?: string }).schoolId = token.schoolId as string;
        (session.user as { schoolName?: string }).schoolName = token.schoolName as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
