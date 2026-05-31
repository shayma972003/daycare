import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;

          const email = credentials.email.toLowerCase().trim();

          const user = await prisma.user.findUnique({
            where: { email },
            include: { school: true },
          });

          if (!user) return null;

          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;

          // Track last login time (fire-and-forget)
          prisma.school.update({
            where: { id: user.schoolId },
            data: { last_login_at: new Date() },
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
