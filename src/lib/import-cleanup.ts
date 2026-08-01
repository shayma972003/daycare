import { prisma } from '@/lib/prisma';

/**
 * Removes import sessions past their TTL.
 *
 * Global by design — this belongs to the nightly job, not to a tenant request.
 * It used to be fired unawaited from `import/upload`, where one school's upload
 * silently deleted another school's expired sessions.
 */
export async function deleteExpiredImportSessions(): Promise<number> {
  const { count } = await prisma.importSession.deleteMany({
    where: { expires_at: { lt: new Date() } }
  });
  return count;
}
