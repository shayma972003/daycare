import "server-only";
import { Prisma } from "@/generated/prisma/client";

type EnrollmentTransaction = Prisma.TransactionClient;

export interface EnrollmentSlotReservation {
  submissionsCount: number;
  maxSubmissions: number;
}

/**
 * Reserves exactly one submission slot. The database re-checks the field
 * comparison while taking the row lock, so concurrent requests cannot exceed
 * max_submissions.
 */
export async function reserveEnrollmentSlot(
  tx: EnrollmentTransaction,
  input: { id: string; token: string; schoolId: string; now: Date }
): Promise<EnrollmentSlotReservation | null> {
  const rows = await tx.$queryRaw<Array<{
    submissions_count: number;
    max_submissions: number;
  }>>(Prisma.sql`
    UPDATE "EnrollmentToken"
    SET
      "submissions_count" = "submissions_count" + 1,
      "status" = CASE
        WHEN "submissions_count" + 1 >= "max_submissions" THEN 'completed'
        ELSE "status"
      END
    WHERE
      "id" = ${input.id}
      AND "token" = ${input.token}
      AND "school_id" = ${input.schoolId}
      AND "status" = 'active'
      AND "expires_at" > ${input.now}
      AND "submissions_count" < "max_submissions"
    RETURNING "submissions_count", "max_submissions"
  `);
  if (rows.length !== 1) return null;
  return {
    submissionsCount: rows[0].submissions_count,
    maxSubmissions: rows[0].max_submissions,
  };
}

/** Locks one tenant-scoped review row until the surrounding transaction ends. */
export async function lockEnrollmentSubmission(
  tx: EnrollmentTransaction,
  input: { id: string; schoolId: string }
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "EnrollmentSubmission"
    WHERE "id" = ${input.id} AND "school_id" = ${input.schoolId}
    FOR UPDATE
  `);
  return rows.length === 1;
}
