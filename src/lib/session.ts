import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { grants, ALL_PERMISSIONS } from "@/lib/permissions";
import { requirementFor, isUngated } from "@/lib/route-permissions";
import { schoolSubscriptionAccess, type SchoolSubscriptionAccess } from "@/lib/school-subscription";

export type AuthSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    schoolId: string;
    schoolName: string;
    role: string;
    authVersion: number;
  };
  /** Permission keys held by this user, or ["*"] for a school owner. */
  permissions: string[];
  /** Staff record this login belongs to, when it has one. */
  teacherId: string | null;
  subscription: SchoolSubscriptionAccess;
  can: (permission: string) => boolean;
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
 * Thrown when the caller is known but not allowed. Distinct from
 * `UnauthorizedError` so routes can answer 403 rather than bouncing a signed-in
 * teacher back to the login page every time she taps something she cannot do.
 */
export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export class SubscriptionLockedError extends Error {
  constructor() {
    super("اشتراك الحضانة يحتاج إلى تجديد. التصفح متاح مؤقتًا دون تعديل البيانات.");
    this.name = "SubscriptionLockedError";
  }
}

const LOCKED_WRITE_ALLOWLIST = [
  "/api/subscription",
  "/api/notifications/admin-messages",
];

async function enforceSubscriptionWriteAccess(access: SchoolSubscriptionAccess): Promise<void> {
  if (access.mode !== "locked") return;
  try {
    const headerList = await headers();
    const pathname = headerList.get("x-pathname");
    const method = headerList.get("x-method") ?? "GET";
    if (!pathname || method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (LOCKED_WRITE_ALLOWLIST.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return;
    throw new SubscriptionLockedError();
  } catch (error) {
    if (error instanceof SubscriptionLockedError) throw error;
    // Server component/build scope has no request headers and performs no API mutation.
  }
}

/**
 * Resolves what a user may do.
 *
 * Rows created before roles existed have `roleId = null`. Treating that as "no
 * permissions" would lock every existing school out of its own product the
 * moment this deploys; treating it as "everything" would make a forgotten role
 * assignment a silent privilege escalation. The compromise is narrow: only the
 * school's *first* user — the account the registration wizard created, its
 * owner — is trusted without a role. The migration assigns that user the manager
 * role anyway, so this path should not run in practice.
 */
async function resolvePermissions(
  schoolId: string,
  user: { id: string; roleRef: { permissions: string[] } | null }
): Promise<string[]> {
  if (user.roleRef) return user.roleRef.permissions;

  const first = await prisma.user.findFirst({
    where: { schoolId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  return first?.id === user.id ? [ALL_PERMISSIONS] : [];
}

/**
 * Returns the caller's session, guaranteeing a usable `schoolId`, re-validating
 * the account against the database, and enforcing the route's permission.
 *
 * Three separate jobs, deliberately in one function because it is the one call
 * every tenant route already makes:
 *
 * 1. **Tenant claim.** The original version cast the session with
 *    `as unknown as AuthSession`, asserting `schoolId: string` without checking.
 *    A token missing that claim produced `undefined`, and **Prisma treats
 *    `where: { schoolId: undefined }` as no filter at all** — one missing claim
 *    silently turned every tenant-scoped query into a cross-tenant one.
 *
 * 2. **Freshness (task 1.5b).** The session strategy is JWT, so the token is
 *    self-contained and believed until it expires. A user who is deleted or
 *    disabled, or whose school is suspended, kept a fully valid session for the
 *    rest of the token's life. The super-admin panel already re-checked this per
 *    request; tenants did not.
 *
 * 3. **Authorisation (task 1.5).** Until now every authenticated user of a
 *    school could reach every route in it, payroll and deletion included. The
 *    requirement comes from the table in src/lib/route-permissions.ts, keyed by
 *    the path and method the middleware forwards.
 */
export async function requireSession(): Promise<AuthSession> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    throw new UnauthorizedError();
  }

  const claims = session.user as Partial<AuthSession["user"]>;

  if (!claims.schoolId || typeof claims.schoolId !== "string") {
    throw new UnauthorizedError("Session is missing a school assignment");
  }

  // One indexed lookup carrying every freshness fact. This is the cost of a JWT
  // strategy, and it is the price of not honouring a revoked account.
  const user = await prisma.user.findUnique({
    where: { id: claims.id ?? "" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      schoolId: true,
      teacherId: true,
      disabledAt: true,
      acceptedAt: true,
      authVersion: true,
      roleRef: { select: { permissions: true } },
      school: {
        select: { name: true, subscription_status: true, renewal_date: true },
      },
    },
  });

  if (!user) throw new UnauthorizedError("الحساب لم يعد موجوداً");
  if (user.disabledAt) throw new UnauthorizedError("الحساب معطَّل");
  if (!user.acceptedAt) throw new UnauthorizedError("الحساب لم يُفعّل بعد");
  if ((claims.authVersion ?? 0) !== (user.authVersion ?? 0)) {
    throw new UnauthorizedError("انتهت صلاحية الجلسة");
  }

  // A token minted before the user moved schools would still carry the old
  // tenant. Trust the row, never the claim.
  if (user.schoolId !== claims.schoolId) {
    throw new UnauthorizedError("تغيّرت صلاحيات الحساب");
  }

  if (!user.school) throw new UnauthorizedError("الحضانة لم تعد موجودة");
  const subscription = schoolSubscriptionAccess(user.school);

  const permissions = await resolvePermissions(user.schoolId, user);

  await enforceRoutePermission(permissions);
  await enforceSubscriptionWriteAccess(subscription);

  return {
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      schoolId: user.schoolId,
      schoolName: user.school?.name ?? "",
      role: user.role ?? "admin",
      authVersion: user.authVersion ?? 0,
    },
    permissions,
    teacherId: user.teacherId,
    subscription,
    can: (permission: string) => grants(permissions, permission),
  };
}

/**
 * Checks the current route against the permission table.
 *
 * The path arrives on `x-pathname`, set by the middleware from the server's own
 * view of the request — an inbound header of that name is overwritten there, so
 * a caller cannot nominate a route with a weaker requirement.
 *
 * When the header is absent the check is skipped rather than failing closed.
 * That sounds wrong and is deliberate: `requireSession()` is also called from
 * server components and from contexts the middleware matcher does not cover, and
 * refusing there would break pages that have nothing to do with authorisation.
 * The middleware guarantees the header for the API surface this table describes.
 */
async function enforceRoutePermission(permissions: string[]): Promise<void> {
  let pathname: string | null = null;
  let method = "GET";

  try {
    const headerList = await headers();
    pathname = headerList.get("x-pathname");
    method = headerList.get("x-method") ?? "GET";
  } catch {
    // No request scope — a script or a build-time call. Nothing to enforce.
    return;
  }

  if (!pathname || !pathname.startsWith("/api/")) return;
  if (isUngated(pathname, method)) return;

  const required = requirementFor(pathname, method);
  if (!required) return;
  if (grants(permissions, required)) return;

  throw new ForbiddenError(required);
}

/**
 * Maps a session failure onto a response.
 *
 * Routes written before `ForbiddenError` existed catch everything and answer
 * 401; this helper is what lets a route distinguish the two without repeating
 * the `instanceof` chain.
 */
export function sessionErrorResponse(error: unknown): Response | null {
  if (error instanceof SubscriptionLockedError) {
    return Response.json(
      { error: error.message, code: "SUBSCRIPTION_READ_ONLY" },
      { status: 423 }
    );
  }
  if (error instanceof ForbiddenError) {
    return Response.json(
      {
        error: "لا تملك صلاحية لهذا الإجراء",
        code: "FORBIDDEN",
        permission: error.permission,
      },
      { status: 403 }
    );
  }

  if (error instanceof UnauthorizedError) {
    return Response.json({ error: error.message }, { status: 401 });
  }

  return null;
}
