/**
 * Request guard for `/api/mobile/v1/*` (task 1.12).
 *
 * The mobile surface is versioned and separate from the web routes on purpose.
 * An app in the wild cannot be updated on demand — a phone left on an old
 * version keeps calling whatever shipped with it — so the endpoints it depends
 * on must be free to stay still while the web routes change shape underneath
 * them. Sharing routes between the two makes every web refactor a potential
 * remote outage for users who cannot upgrade.
 *
 * Authentication is a bearer token, never a cookie: see src/lib/mobile-auth.ts.
 */

import { prisma } from "@/lib/prisma";
import { bearerToken, verifyAccessToken, type AccessTokenClaims } from "@/lib/mobile-auth";
import { grants } from "@/lib/permissions";

export interface MobileContext {
  claims: AccessTokenClaims;
  schoolId: string;
  can: (permission: string) => boolean;
}

export class MobileAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MobileAuthError";
  }
}

/**
 * Authenticates a mobile request.
 *
 * Signature-only by default. The access token lives fifteen minutes, so the
 * window in which a revoked account still works is bounded by that rather than
 * by a database read on every call — and the refresh that follows re-reads the
 * account and refuses. Routes that change money or delete data should pass
 * `fresh: true` and pay for the check.
 */
export async function requireMobileAuth(
  request: Request,
  options: { permission?: string; kind?: "staff" | "guardian"; fresh?: boolean } = {}
): Promise<MobileContext> {
  const token = bearerToken(request);
  if (!token) {
    throw new MobileAuthError(401, "NO_TOKEN", "التوكن مفقود");
  }

  const claims = await verifyAccessToken(token);
  if (!claims) {
    throw new MobileAuthError(401, "INVALID_TOKEN", "التوكن غير صالح أو منتهٍ");
  }

  if (options.kind && claims.kind !== options.kind) {
    throw new MobileAuthError(403, "WRONG_ACCOUNT_TYPE", "نوع الحساب غير مسموح لهذا الإجراء");
  }

  if (options.fresh) {
    const stillValid =
      claims.kind === "staff"
        ? await prisma.user.findFirst({
            where: { id: claims.sub, disabledAt: null },
            select: { id: true },
          })
        : await prisma.guardianAccount.findFirst({
            where: { id: claims.sub, disabledAt: null },
            select: { id: true },
          });
    if (!stillValid) {
      throw new MobileAuthError(401, "ACCOUNT_REVOKED", "الحساب لم يعد فعالاً");
    }
  }

  const can = (permission: string) =>
    claims.kind === "staff" ? grants(claims.permissions ?? [], permission) : false;

  if (options.permission && !can(options.permission)) {
    throw new MobileAuthError(403, "FORBIDDEN", "لا تملك صلاحية لهذا الإجراء");
  }

  return { claims, schoolId: claims.schoolId, can };
}

export function mobileAuthResponse(error: unknown): Response | null {
  if (error instanceof MobileAuthError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return null;
}

/**
 * The children a guardian may see.
 *
 * Every guardian-facing query goes through this. A parent portal has exactly one
 * catastrophic failure mode — showing one family another family's child — and
 * the way that happens is a query that forgets the filter. Centralising it means
 * there is one place to get right and one place to review.
 */
export async function guardianChildIds(guardianAccountId: string): Promise<string[]> {
  const account = await prisma.guardianAccount.findUnique({
    where: { id: guardianAccountId },
    select: {
      guardian: {
        select: {
          // Children where this guardian is the primary contact…
          students: { where: { deletedAt: null }, select: { id: true } },
          // …and every child they are merely attached to (task 2.34). A father
          // listed as the second contact must see his own child; before the link
          // table there was no way for him to.
          links: {
            where: { student: { deletedAt: null } },
            select: { studentId: true },
          },
        },
      },
    },
  });

  if (!account) return [];

  // Deduplicated: the primary contact appears in both lists, since the migration
  // gives them a link row too.
  return Array.from(
    new Set([
      ...account.guardian.students.map((student) => student.id),
      ...account.guardian.links.map((link) => link.studentId),
    ])
  );
}
