import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { decryptPii, encryptPii, hashPii, piiCryptoConfigured } from "@/lib/pii-crypto";

export interface ProtectedEnrollmentSubmissionIdNumber {
  id_number: null;
  encrypted_id_number: string | null;
  id_number_hash: string | null;
}

export function protectEnrollmentSubmissionIdNumber(
  value: string | null | undefined
): ProtectedEnrollmentSubmissionIdNumber {
  const normalized = value?.trim();
  if (!normalized) {
    return { id_number: null, encrypted_id_number: null, id_number_hash: null };
  }
  if (!piiCryptoConfigured()) {
    throw new Error("PII encryption is unavailable");
  }
  return {
    id_number: null,
    encrypted_id_number: encryptPii(normalized),
    id_number_hash: hashPii(normalized),
  };
}

export function revealEnrollmentSubmissionIdNumber(value: {
  id_number: string | null;
  encrypted_id_number: string | null;
}): string | null {
  if (value.encrypted_id_number) return decryptPii(value.encrypted_id_number);
  return value.id_number;
}

type BackfillDb = Pick<Prisma.TransactionClient, "$transaction" | "enrollmentSubmission">;

export async function backfillEnrollmentSubmissionIdNumbers(
  db: BackfillDb,
  limit = 100
): Promise<{ staged: number; skipped: number; failed: number }> {
  if (!piiCryptoConfigured()) throw new Error("PII encryption is unavailable");
  const rows = await db.enrollmentSubmission.findMany({
    where: { id_number: { not: null }, encrypted_id_number: null },
    select: { id: true, id_number: true },
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(limit, 500)),
  });
  const result = { staged: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    if (!row.id_number?.trim()) {
      result.skipped += 1;
      continue;
    }
    try {
      const protectedValue = protectEnrollmentSubmissionIdNumber(row.id_number);
      const updated = await db.$transaction(async (tx) => tx.enrollmentSubmission.updateMany({
        where: {
          id: row.id,
          id_number: row.id_number,
          encrypted_id_number: null,
        },
        data: protectedValue,
      }));
      if (updated.count === 1) result.staged += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
