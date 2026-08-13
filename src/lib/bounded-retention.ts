import { prisma } from "@/lib/prisma";

const DAY = 86_400_000;
const LIMIT = 100;
const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

async function boundedDelete(
  findIds: () => Promise<{ id: string }[]>,
  remove: (ids: string[]) => Promise<{ count: number }>
): Promise<number> {
  const ids = (await findIds()).map((row) => row.id);
  return ids.length ? (await remove(ids)).count : 0;
}

export async function runBoundedRetention(now = new Date()) {
  const counts: Record<string, number> = {};
  const jobs: Array<[string, () => Promise<number>]> = [
    ["refreshTokens", () => boundedDelete(
      () => prisma.refreshToken.findMany({ where: { OR: [{ expiresAt: { lt: before(now, 7) } }, { revokedAt: { lt: before(now, 7) } }] }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.refreshToken.deleteMany({ where: { id: { in: ids } } })
    )],
    ["passwordResetTokens", () => boundedDelete(
      () => prisma.passwordResetToken.findMany({ where: { expiresAt: { lt: before(now, 1) } }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.passwordResetToken.deleteMany({ where: { id: { in: ids } } })
    )],
    ["schoolAdminInvitations", () => boundedDelete(
      () => prisma.schoolAdminInvitation.findMany({ where: { OR: [{ expiresAt: { lt: before(now, 30) } }, { usedAt: { lt: before(now, 30) } }, { revokedAt: { lt: before(now, 30) } }] }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.schoolAdminInvitation.deleteMany({ where: { id: { in: ids } } })
    )],
    ["twoFaSessions", () => boundedDelete(
      () => prisma.twoFASession.findMany({ where: { expiresAt: { lt: before(now, 1) } }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.twoFASession.deleteMany({ where: { id: { in: ids } } })
    )],
    ["pushNotifications", () => boundedDelete(
      () => prisma.pushNotification.findMany({ where: { status: { in: ["SENT", "FAILED"] }, createdAt: { lt: before(now, 90) } }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.pushNotification.deleteMany({ where: { id: { in: ids } } })
    )],
    ["notificationLogs", () => boundedDelete(
      () => prisma.notificationLog.findMany({ where: { sentAt: { lt: before(now, 365) } }, select: { id: true }, take: LIMIT }),
      (ids) => prisma.notificationLog.deleteMany({ where: { id: { in: ids } } })
    )],
  ];
  let failures = 0;
  for (const [name, job] of jobs) {
    try { counts[name] = await job(); }
    catch { counts[name] = 0; failures++; console.error(`[retention] ${name} cleanup failed`); }
  }
  return { counts, failures, limit: LIMIT };
}
