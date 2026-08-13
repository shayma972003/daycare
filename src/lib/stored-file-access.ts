import "server-only";
import { bearerToken, verifyAccessToken, claimsForSubject } from "@/lib/mobile-auth";
import { verifyFileToken } from "@/lib/file-token";
import { prisma } from "@/lib/prisma";
import { grants } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { STORED_FILE_OWNER, type StoredFileOwner } from "@/lib/stored-file-ownership";

export interface StoredFileAccessRecord {
  key: string;
  schoolId: string;
  ownerType: StoredFileOwner;
  ownerId: string;
}

async function explicitOwnerExists(file: StoredFileAccessRecord): Promise<boolean> {
  if (file.ownerType === STORED_FILE_OWNER.STUDENT) {
    return (await prisma.student.count({
      where: { id: file.ownerId, schoolId: file.schoolId },
    })) === 1;
  }
  if (file.ownerType === STORED_FILE_OWNER.TEACHER) {
    return (await prisma.teacher.count({
      where: { id: file.ownerId, schoolId: file.schoolId },
    })) === 1;
  }
  if (file.ownerType === STORED_FILE_OWNER.ENROLLMENT_TOKEN) {
    return (await prisma.enrollmentToken.count({
      where: { id: file.ownerId, school_id: file.schoolId },
    })) === 1;
  }
  if (file.ownerType === STORED_FILE_OWNER.ENROLLMENT_SUBMISSION) {
    return (await prisma.enrollmentSubmission.count({
      where: { id: file.ownerId, school_id: file.schoolId },
    })) === 1;
  }
  // LEGACY is deliberately not interpreted from the shape of ownerId. A signed
  // exact-key grant may still open it, but no bearer receives ownership from it.
  return true;
}

async function guardianOwnsStudent(
  guardianAccountId: string,
  schoolId: string,
  studentId: string
): Promise<boolean> {
  const account = await prisma.guardianAccount.findFirst({
    where: {
      id: guardianAccountId,
      schoolId,
      disabledAt: null,
      acceptedAt: { not: null },
    },
    select: { guardianId: true },
  });
  if (!account) return false;

  return (await prisma.student.count({
    where: {
      id: studentId,
      schoolId,
      OR: [
        { guardianId: account.guardianId },
        { guardianLinks: { some: { guardianId: account.guardianId } } },
      ],
    },
  })) === 1;
}

function requiredStaffPermission(ownerType: StoredFileOwner): string | null {
  if (ownerType === STORED_FILE_OWNER.STUDENT) return "students.files";
  if (
    ownerType === STORED_FILE_OWNER.ENROLLMENT_TOKEN ||
    ownerType === STORED_FILE_OWNER.ENROLLMENT_SUBMISSION
  ) {
    return "students.manage";
  }
  if (ownerType === STORED_FILE_OWNER.TEACHER) return "staff.view";
  return null;
}

export async function mayReadStoredFile(
  request: Request,
  file: StoredFileAccessRecord
): Promise<boolean> {
  if (!(await explicitOwnerExists(file))) return false;

  const grant = new URL(request.url).searchParams.get("t");
  if (verifyFileToken(file.key, grant)) return true;

  // Ambiguous pre-migration ownership never becomes authority merely because a
  // same-tenant user learned the key. Legacy files require an exact grant minted
  // by an endpoint that already authorized the containing record.
  if (file.ownerType === STORED_FILE_OWNER.LEGACY) return false;

  const bearer = bearerToken(request);
  if (bearer) {
    const tokenClaims = await verifyAccessToken(bearer);
    if (!tokenClaims) return false;
    const freshClaims = await claimsForSubject(tokenClaims.kind, tokenClaims.sub);
    if (!freshClaims || freshClaims.schoolId !== file.schoolId) return false;

    if (freshClaims.kind === "guardian") {
      return (
        file.ownerType === STORED_FILE_OWNER.STUDENT &&
        guardianOwnsStudent(freshClaims.sub, file.schoolId, file.ownerId)
      );
    }

    const permission = requiredStaffPermission(file.ownerType);
    return permission !== null && grants(freshClaims.permissions ?? [], permission);
  }

  try {
    const session = await requireSession();
    if (session.user.schoolId !== file.schoolId) return false;
    const permission = requiredStaffPermission(file.ownerType);
    // Non-child explicit owner types can retain dashboard compatibility here;
    // LEGACY returned above and is never inferred from ownerId.
    return permission ? session.can(permission) : true;
  } catch {
    return false;
  }
}
