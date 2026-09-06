import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash, randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { logAction } from "@/lib/activity-logger";
import {
  rateLimit,
  rateLimitResetResponse,
  rateLimitResponse,
  resetRateLimit,
} from "@/lib/rate-limit";
import { hashOneTimeCode } from "@/lib/one-time-code";
import { logSafeError } from "@/lib/safe-logger";

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
  "RATE_LIMIT_UNAVAILABLE",
];

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
            const user = await prisma.$transaction(async (tx) => {
              const session = await tx.twoFASession.findFirst({
                where: {
                  bypassTokenHash: hash,
                  bypassExpires: { gt: new Date() },
                  verified: true,
                  purpose: "LOGIN",
                },
              });
              if (!session?.userId) return null;

              const consumed = await tx.twoFASession.updateMany({
                where: {
                  id: session.id,
                  bypassTokenHash: hash,
                  bypassExpires: { gt: new Date() },
                  verified: true,
                  purpose: "LOGIN",
                },
                data: { bypassTokenHash: null, bypassExpires: null },
              });
              if (consumed.count !== 1) return null;

              return tx.user.findUnique({
                where: { id: session.userId },
                include: { school: true },
              });
            });
            if (!user || user.disabledAt || !user.acceptedAt) return null;

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
              authVersion: user.authVersion,
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
          const limitedResponse = rateLimitResponse(attempt);
          if (limitedResponse) {
            throw new Error(
              limitedResponse.status === 503
                ? "RATE_LIMIT_UNAVAILABLE"
                : "ACCOUNT_LOCKED"
            );
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

          if (!user || !isValid || user.disabledAt || !user.acceptedAt) return null;

          // Credentials are correct — clear the counter so an earlier typo does
          // not carry over into the next sign-in.
          const resetResponse = rateLimitResetResponse(await resetRateLimit(lockKey));
          if (resetResponse) throw new Error("RATE_LIMIT_UNAVAILABLE");

          if (user.school?.twoFaEnabled) {
            const otp = generateOTP();
            const otpCodeHash = hashOneTimeCode(otp, "2fa-login");
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
              await prisma.twoFASession.deleteMany({
                where: { id: twoFaSession.id, userId: user.id, purpose: "LOGIN" },
              });
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
            authVersion: user.authVersion,
          };
        } catch (err) {
          // These are signals to the sign-in page, not failures. Swallowing them
          // would collapse "your account is locked" into a generic "wrong
          // password" and leave the user retrying against a closed door.
          if (err instanceof Error && SIGNAL_ERRORS.some((p) => err.message.startsWith(p))) {
            throw err;
          }
          logSafeError("auth-authorize", err);
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
        token.authVersion = u.authVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { schoolId?: string }).schoolId = token.schoolId as string;
        (session.user as { schoolName?: string }).schoolName = token.schoolName as string;
        (session.user as { role?: string }).role = token.role as string;
        session.user.authVersion = typeof token.authVersion === "number" ? token.authVersion : 0;
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
