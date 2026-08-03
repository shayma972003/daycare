-- Multiple guardians per child, and billing cycles (tasks 2.34 and 2.37).
--
-- Additive plus a backfill. `Student.guardianId` is NOT removed: it stays as the
-- primary contact, read by dozens of screens, the invoice generator and the
-- reminder flow. Turning that into a lookup through the join table in the same
-- change would have been a rewrite wearing a migration's clothes.

-- ---------------------------------------------------------------------------
-- Billing cycles
--
-- Every existing row is monthly — the product had no other option — so the
-- default changes nothing until a nursery chooses otherwise.
-- ---------------------------------------------------------------------------

CREATE TYPE "BillingCycle" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM');

ALTER TABLE "Student"
    ADD COLUMN "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    ADD COLUMN "billingIntervalDays" INTEGER,
    -- Null falls back to Settings.monthlyStudentFee, preserving today's
    -- behaviour for anyone who never sets it.
    ADD COLUMN "cycleFee" DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- Child ↔ guardian links
-- ---------------------------------------------------------------------------

CREATE TABLE "StudentGuardian" (
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "relation" TEXT,
    -- Denormalised mirror of Student.guardianId, so a query starting here does
    -- not have to join back to Student to know which contact comes first.
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    -- Defaults true because that is what a listed guardian usually means; the
    -- ones who may *not* collect are the exception worth recording.
    "canPickup" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("studentId", "guardianId")
);

CREATE INDEX "StudentGuardian_guardianId_idx" ON "StudentGuardian"("guardianId");

ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianId_fkey"
    FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill 1: the existing primary contact becomes a link.
-- ---------------------------------------------------------------------------

INSERT INTO "StudentGuardian" ("studentId", "guardianId", "isPrimary", "canPickup", "createdAt")
SELECT s."id", s."guardianId", true, true, now()
FROM "Student" s
WHERE s."guardianId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill 2: promote the flat second contact into a Guardian of its own.
--
-- `name_2` / `phone_3` / `phone_4` / `email_2` could hold a second adult but not
-- describe one — no relationship, no pick-up permission, no login. Each becomes
-- a real Guardian row linked to the same children.
--
-- The source columns are deliberately left in place. Dropping them in the same
-- migration would make this backfill unverifiable and unrepeatable; they are
-- cleared in a later change once the new table is confirmed correct in
-- production.
-- ---------------------------------------------------------------------------

WITH promoted AS (
    INSERT INTO "Guardian" ("id", "schoolId", "name", "phone1", "phone2", "email", "createdAt", "updatedAt")
    SELECT
        gen_random_uuid()::TEXT,
        g."schoolId",
        g."name_2",
        g."phone_3",
        g."phone_4",
        g."email_2",
        now(),
        now()
    FROM "Guardian" g
    WHERE g."name_2" IS NOT NULL
      AND btrim(g."name_2") <> ''
      AND g."deletedAt" IS NULL
      AND g."anonymizedAt" IS NULL
    RETURNING "id", "name", "schoolId"
)
INSERT INTO "StudentGuardian" ("studentId", "guardianId", "relation", "isPrimary", "canPickup", "createdAt")
SELECT DISTINCT s."id", p."id", 'ولي أمر ثانٍ', false, true, now()
FROM promoted p
JOIN "Guardian" original
     ON original."schoolId" = p."schoolId"
    AND original."name_2" = p."name"
JOIN "Student" s ON s."guardianId" = original."id"
WHERE s."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
