import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SUPPORT_VIEW_COOKIE_NAME, verifySupportViewToken } from "@/lib/support-view-token";

export interface ActiveSupportView {
  id: string;
  adminId: string;
  schoolId: string;
  schoolName: string;
  expiresAt: Date;
}

export async function getActiveSupportView(): Promise<ActiveSupportView | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SUPPORT_VIEW_COOKIE_NAME)?.value;
  if (!raw) return null;
  const claims = await verifySupportViewToken(raw);
  if (!claims) return null;

  const access = await prisma.supportAccessSession.findFirst({
    where: {
      id: claims.accessId,
      schoolId: claims.schoolId,
      createdByAdminId: claims.adminId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      createdByAdminId: true,
      expiresAt: true,
      school: { select: { id: true, name: true } },
    },
  });
  if (!access) return null;
  return {
    id: access.id,
    adminId: access.createdByAdminId,
    schoolId: access.school.id,
    schoolName: access.school.name,
    expiresAt: access.expiresAt,
  };
}
