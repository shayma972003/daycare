BEGIN;

-- Do not conceal cross-tenant accounts. A deployment with inconsistent rows
-- must stop before any constraint is changed so the rows can be investigated.
DO $$
DECLARE
    conflicting_rows INTEGER;
BEGIN
    SELECT count(*)
      INTO conflicting_rows
      FROM "GuardianAccount" AS account
      JOIN "Guardian" AS guardian ON guardian."id" = account."guardianId"
     WHERE account."schoolId" <> guardian."schoolId";

    IF conflicting_rows > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce GuardianAccount tenant consistency: % conflicting row(s)',
            conflicting_rows;
    END IF;
END $$;

-- The composite unique key makes the tenant part of the referenced identity.
-- Guardian.id remains globally unique; the existing GuardianAccount guardianId
-- uniqueness is intentionally preserved by this migration.
CREATE UNIQUE INDEX "Guardian_id_schoolId_key"
ON "Guardian"("id", "schoolId");

CREATE UNIQUE INDEX "GuardianAccount_guardianId_schoolId_key"
ON "GuardianAccount"("guardianId", "schoolId");

ALTER TABLE "GuardianAccount"
DROP CONSTRAINT "GuardianAccount_guardianId_fkey";

ALTER TABLE "GuardianAccount"
DROP CONSTRAINT "GuardianAccount_schoolId_fkey";

ALTER TABLE "GuardianAccount"
ADD CONSTRAINT "GuardianAccount_guardianId_schoolId_fkey"
FOREIGN KEY ("guardianId", "schoolId") REFERENCES "Guardian"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianAccount"
ADD CONSTRAINT "GuardianAccount_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve deletion semantics through the whole ownership chain: deleting a
-- school removes its guardian rows, which in turn removes their login rows.
ALTER TABLE "Guardian"
DROP CONSTRAINT "Guardian_schoolId_fkey";

ALTER TABLE "Guardian"
ADD CONSTRAINT "Guardian_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Password reset previously targeted staff users only. Guardian accounts use
-- the same one-time OTP lifecycle without sharing identifiers or token rows.
ALTER TABLE "PasswordResetToken"
ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN "guardianAccountId" TEXT;

CREATE INDEX "PasswordResetToken_guardianAccountId_idx"
ON "PasswordResetToken"("guardianAccountId");

ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_guardianAccountId_fkey"
FOREIGN KEY ("guardianAccountId") REFERENCES "GuardianAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_exactly_one_subject_check"
CHECK (num_nonnulls("userId", "guardianAccountId") = 1);

COMMIT;
