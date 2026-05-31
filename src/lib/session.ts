import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type AuthSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    schoolId: string;
    schoolName: string;
  };
};

export async function requireSession(): Promise<AuthSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session as unknown as AuthSession;
}

export async function getSchoolId(): Promise<string> {
  const session = await requireSession();
  return (session.user as { schoolId: string }).schoolId;
}
