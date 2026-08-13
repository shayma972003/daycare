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
 * Every request revalidates the account and subscription in the database.
 * A signed token proves who received it; it does not prove that the account or
 * school is still active now.
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

  let currentSchoolId: string;
  let permissions: string[] = [];
  if (claims.kind === "staff") {
    const current = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        schoolId: true,
        disabledAt: true,
        acceptedAt: true,
        roleRef: { select: { permissions: true } },
        school: { select: { subscription_status: true } },
      },
    });
    if (
      !current ||
      current.schoolId !== claims.schoolId ||
      current.disabledAt ||
      !current.acceptedAt ||
      ["suspended", "cancelled", "expired"].includes(current.school.subscription_status)
    ) {
      throw new MobileAuthError(401, "ACCOUNT_REVOKED", "الحساب لم يعد فعالاً");
    }
    currentSchoolId = current.schoolId;
    permissions = current.roleRef?.permissions ?? [];
  } else {
    const current = await prisma.guardianAccount.findUnique({
      where: { id: claims.sub },
      select: {
        schoolId: true,
        disabledAt: true,
        acceptedAt: true,
        school: { select: { subscription_status: true } },
      },
    });
    if (
      !current ||
      current.schoolId !== claims.schoolId ||
      current.disabledAt ||
      !current.acceptedAt ||
      ["suspended", "cancelled", "expired"].includes(current.school.subscription_status)
    ) {
      throw new MobileAuthError(401, "ACCOUNT_REVOKED", "الحساب لم يعد فعالاً");
    }
    currentSchoolId = current.schoolId;
  }
  const can = (permission: string) =>
    claims.kind === "staff" ? grants(permissions, permission) : false;

  if (options.permission && !can(options.permission)) {
    throw new MobileAuthError(403, "FORBIDDEN", "لا تملك صلاحية لهذا الإجراء");
  }

  return {
    claims: { ...claims, ...(claims.kind === "staff" ? { permissions } : {}) },
    schoolId: currentSchoolId,
    can,
  };
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
      schoolId: true,
      guardian: {
        select: {
          // Children where this guardian is the primary contact…
          students: {
            where: { deletedAt: null },
            select: { id: true, schoolId: true },
          },
          // …and every child they are merely attached to (task 2.34). A father
          // listed as the second contact must see his own child; before the link
          // table there was no way for him to.
          links: {
            where: { student: { deletedAt: null } },
            select: { studentId: true, schoolId: true },
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
      ...account.guardian.students
        .filter((student) => student.schoolId === account.schoolId)
        .map((student) => student.id),
      ...account.guardian.links
        .filter((link) => link.schoolId === account.schoolId)
        .map((link) => link.studentId),
    ])
  );
}
