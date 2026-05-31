import { prisma } from '@/lib/prisma';

export async function deleteExpiredImportSessions(): Promise<void> {
  await prisma.importSession.deleteMany({
    where: { expires_at: { lt: new Date() } }
  });
}
