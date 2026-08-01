import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { logAction } from "@/lib/activity-logger";

function generateOTP(): string {
  return String(randomInt(100000, 999999));
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

          const user = await prisma.user.findUnique({
            where: { email },
            include: { school: true },
          });

          if (!user) return null;

          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;

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
          if (err instanceof Error && err.message.startsWith("2FA_REQUIRED:")) {
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
