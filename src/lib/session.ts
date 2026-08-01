import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type AuthSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    schoolId: string;
    schoolName: string;
    role: string;
  };
};

/**
 * Thrown when there is no usable session. Routes catch this and answer 401.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Returns the caller's session, guaranteeing a usable `schoolId`.
 *
 * The previous version cast the session with `as unknown as AuthSession`, which
 * asserted `schoolId: string` without checking. A token missing that claim — a
 * stale cookie from before the field existed, or any change to the jwt callback
 * — produced `undefined`, and **Prisma treats `where: { schoolId: undefined }`
 * as no filter at all**. A single missing claim silently turned every
 * tenant-scoped query into a cross-tenant one. The guard below is the whole
 * point: fail loudly rather than leak.
 */
export async function requireSession(): Promise<AuthSession> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    throw new UnauthorizedError();
  }

  const user = session.user as Partial<AuthSession["user"]>;

  if (!user.schoolId || typeof user.schoolId !== "string") {
    throw new UnauthorizedError("Session is missing a school assignment");
  }

  return {
    user: {
      id: user.id ?? "",
      name: user.name ?? null,
      email: user.email ?? null,
      schoolId: user.schoolId,
      schoolName: user.schoolName ?? "",
      role: user.role ?? "admin",
    },
  };
}

/** Convenience wrapper for routes that only need the tenant id. */
export async function getSchoolId(): Promise<string> {
  const session = await requireSession();
  return session.user.schoolId;
}
