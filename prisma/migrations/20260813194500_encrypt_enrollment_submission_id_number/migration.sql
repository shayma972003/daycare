-- Transitional storage for EnrollmentSubmission national IDs.
-- Existing plaintext is intentionally left untouched for the separate,
-- application-keyed backfill. No secret or encryption operation belongs in SQL.
ALTER TABLE "EnrollmentSubmission"
  ADD COLUMN "encrypted_id_number" TEXT,
  ADD COLUMN "id_number_hash" TEXT;

CREATE INDEX "EnrollmentSubmission_school_id_id_number_hash_idx"
  ON "EnrollmentSubmission"("school_id", "id_number_hash");
