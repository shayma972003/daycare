import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashInviteToken, mintInvite } from "@/lib/invitations";
import { BCRYPT_COST } from "@/lib/password-policy";

export interface SchoolAdminInviteView {
  kind: "staff";
  name: string;
  email: string;
  schoolName: string;
}

export interface RotatedSchoolAdminInvite extends SchoolAdminInviteView {
  token: string;
  expiresAt: Date;
  userId: string;
  schoolId: string;
}

export class SchoolAdminInviteNotFoundError extends Error {}
export class SchoolAdminAlreadyActiveError extends Error {}

class SchoolAdminInviteNoLongerUsableError extends Error {}

function isUsable(
  invitation: {
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    schoolId: string;
    userId: string;
    user: {
      id: string;
      schoolId: string;
      acceptedAt: Date | null;
      disabledAt: Date | null;
    };
  },
  now: Date
): boolean {
  return (
    !invitation.usedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > now &&
    invitation.user.id === invitation.userId &&
    invitation.user.schoolId === invitation.schoolId &&
    !invitation.user.acceptedAt &&
    !invitation.user.disabledAt
  );
}

/** Public, read-only check used before showing the password form. */
export async function findSchoolAdminInvite(
  token: string
): Promise<SchoolAdminInviteView | null> {
  if (!token || token.length < 16) return null;

  const invitation = await prisma.schoolAdminInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      schoolId: true,
      userId: true,
      user: {
        select: {
          id: true,
          schoolId: true,
          name: true,
          email: true,
          acceptedAt: true,
          disabledAt: true,
        },
      },
      school: { select: { name: true } },
    },
  });

  if (!invitation || !isUsable(invitation, new Date())) return null;

  return {
    kind: "staff",
    name: invitation.user.name,
    email: invitation.user.email,
    schoolName: invitation.school.name,
  };
}

/**
 * Claims the invitation, sets the first password, invalidates stale login
 * artifacts, and audits the activation in one transaction.
 */
export async function redeemSchoolAdminInvite(
  token: string,
  password: string
): Promise<SchoolAdminInviteView | null> {
  if (!token || token.length < 16) return null;

  const tokenHash = hashInviteToken(token);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.schoolAdminInvitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
          schoolId: true,
          userId: true,
          user: {
            select: {
              id: true,
              schoolId: true,
              name: true,
              email: true,
              acceptedAt: true,
              disabledAt: true,
            },
          },
          school: { select: { name: true } },
        },
      });

      if (!invitation || !isUsable(invitation, now)) {
        throw new SchoolAdminInviteNoLongerUsableError();
      }

      // The conditional claim is the race barrier: only one transaction can
      // move the still-active row to usedAt.
      const claimed = await tx.schoolAdminInvitation.updateMany({
        where: {
          id: invitation.id,
          schoolId: invitation.schoolId,
          userId: invitation.userId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new SchoolAdminInviteNoLongerUsableError();
      }

      const activated = await tx.user.updateMany({
        where: {
          id: invitation.userId,
          schoolId: invitation.schoolId,
          acceptedAt: null,
          disabledAt: null,
        },
        data: {
          password: passwordHash,
          acceptedAt: now,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
      if (activated.count !== 1) {
        throw new SchoolAdminInviteNoLongerUsableError();
      }

      // A pending account cannot legitimately own any of these. Removing them
      // makes the invariant explicit and closes artifacts created by older code.
      await tx.twoFASession.deleteMany({ where: { userId: invitation.userId } });
      await tx.refreshToken.deleteMany({ where: { userId: invitation.userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: invitation.userId } });

      await tx.schoolAdminInvitation.updateMany({
        where: {
          userId: invitation.userId,
          schoolId: invitation.schoolId,
          id: { not: invitation.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      await tx.adminActivityLog.create({
        data: {
          school_id: invitation.schoolId,
          action: "school_admin_invitation_accepted",
          performed_by: "school_admin",
          metadata: { userId: invitation.userId },
        },
      });

      return {
        kind: "staff" as const,
        name: invitation.user.name,
        email: invitation.user.email,
        schoolName: invitation.school.name,
      };
    });
  } catch (error) {
    if (error instanceof SchoolAdminInviteNoLongerUsableError) return null;
    throw error;
  }
}

/** Rotates a pending owner's invitation inside the administrative boundary. */
export async function rotateSchoolAdminInvite(
  schoolId: string,
  adminId: string
): Promise<RotatedSchoolAdminInvite> {
  const minted = mintInvite();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const school = await tx.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!school) throw new SchoolAdminInviteNotFoundError();

    const owner = await tx.user.findFirst({
      where: { schoolId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        schoolId: true,
        name: true,
        email: true,
        password: true,
        acceptedAt: true,
        disabledAt: true,
      },
    });
    if (!owner || owner.schoolId !== school.id) {
      throw new SchoolAdminInviteNotFoundError();
    }
    if (owner.password || owner.acceptedAt || owner.disabledAt) {
      throw new SchoolAdminAlreadyActiveError();
    }

    await tx.schoolAdminInvitation.updateMany({
      where: {
        schoolId: school.id,
        userId: owner.id,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await tx.schoolAdminInvitation.create({
      data: {
        tokenHash: minted.tokenHash,
        expiresAt: minted.expiresAt,
        schoolId: school.id,
        userId: owner.id,
      },
    });

    await tx.adminActivityLog.create({
      data: {
        school_id: school.id,
        action: "school_admin_invitation_rotated",
        performed_by: "super_admin",
        metadata: { userId: owner.id, adminId },
      },
    });

    return {
      kind: "staff" as const,
      token: minted.token,
      expiresAt: minted.expiresAt,
      userId: owner.id,
      schoolId: school.id,
      name: owner.name,
      email: owner.email,
      schoolName: school.name,
    };
  });
}
