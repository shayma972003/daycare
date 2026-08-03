-- Data retention and anonymisation.
--
-- Adds the lifecycle columns the nightly sweep reads, the platform-level policy
-- row, and the append-only anonymisation audit table.
--
-- Nothing here destroys data. The backfill only *classifies* rows that were
-- already inactive so their retention clock starts from a defensible date
-- instead of from the day this migration ran.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED');
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'TERMINATED', 'CONTRACT_ENDED');
CREATE TYPE "AnonymizedEntity" AS ENUM ('STUDENT', 'TEACHER', 'GUARDIAN');

-- ---------------------------------------------------------------------------
-- Platform policy (single row)
-- ---------------------------------------------------------------------------

CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "studentRetentionYears" INTEGER NOT NULL DEFAULT 5,
    "employeeRetentionYears" INTEGER NOT NULL DEFAULT 5,
    "anonymizationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSweepAt" TIMESTAMP(3),
    "lastSweepProcessed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton here rather than lazily at runtime, so the policy is
-- readable (and auditable) from the moment the migration lands.
INSERT INTO "SystemSettings" ("id", "updatedAt", "updatedBy")
VALUES ('global', now(), 'migration');

-- ---------------------------------------------------------------------------
-- Anonymisation audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE "AnonymizationLog" (
    "id" TEXT NOT NULL,
    "entityType" "AnonymizedEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "analyticsId" TEXT,
    "schoolId" TEXT,
    "anonymizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "clearedFieldCount" INTEGER NOT NULL,
    "clearedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "retentionYears" INTEGER,

    CONSTRAINT "AnonymizationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnonymizationLog_entityType_anonymizedAt_idx" ON "AnonymizationLog"("entityType", "anonymizedAt");
CREATE INDEX "AnonymizationLog_schoolId_anonymizedAt_idx" ON "AnonymizationLog"("schoolId", "anonymizedAt");
CREATE INDEX "AnonymizationLog_entityId_idx" ON "AnonymizationLog"("entityId");

-- ---------------------------------------------------------------------------
-- Student lifecycle
-- `retentionUntil` and `anonymizedAt` already exist from the earlier PII
-- migration; only the classification and analytics columns are new.
-- ---------------------------------------------------------------------------

ALTER TABLE "Student"
    ADD COLUMN "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "leftAt" TIMESTAMP(3),
    ADD COLUMN "ageAtEnrollmentMonths" INTEGER,
    ADD COLUMN "nationalityCode" TEXT,
    ADD COLUMN "enrollmentYear" INTEGER,
    ADD COLUMN "leftYear" INTEGER;

CREATE INDEX "Student_retentionUntil_anonymizedAt_idx" ON "Student"("retentionUntil", "anonymizedAt");
CREATE INDEX "Student_schoolId_status_idx" ON "Student"("schoolId", "status");

-- ---------------------------------------------------------------------------
-- Teacher lifecycle
-- ---------------------------------------------------------------------------

ALTER TABLE "Teacher"
    ADD COLUMN "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "leftAt" TIMESTAMP(3),
    ADD COLUMN "retentionUntil" TIMESTAMP(3),
    ADD COLUMN "anonymizedAt" TIMESTAMP(3),
    ADD COLUMN "ageAtHireMonths" INTEGER,
    ADD COLUMN "nationalityCode" TEXT,
    ADD COLUMN "hireYear" INTEGER,
    ADD COLUMN "leftYear" INTEGER;

CREATE INDEX "Teacher_retentionUntil_anonymizedAt_idx" ON "Teacher"("retentionUntil", "anonymizedAt");
CREATE INDEX "Teacher_schoolId_status_idx" ON "Teacher"("schoolId", "status");

-- ---------------------------------------------------------------------------
-- Guardian
-- ---------------------------------------------------------------------------

ALTER TABLE "Guardian" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Notification log — subject links
--
-- The log stores the recipient's name and the full message body, which names the
-- child. Nothing tied a row to the child it was about, so every reminder ever
-- sent kept a copy of the name that anonymisation had just destroyed.
--
-- Deliberately NOT foreign keys: the trash purge hard-deletes a student 30 days
-- after binning, and an FK would either block that delete or cascade away a
-- delivery record the school may still need to produce.
--
-- Historical rows stay NULL. They cannot be attributed after the fact without
-- guessing from the name — which is exactly the kind of fuzzy match that would
-- scrub a different, still-enrolled family's records by accident.
-- ---------------------------------------------------------------------------

ALTER TABLE "NotificationLog"
    ADD COLUMN "studentId" TEXT,
    ADD COLUMN "teacherId" TEXT;

CREATE INDEX "NotificationLog_studentId_idx" ON "NotificationLog"("studentId");
CREATE INDEX "NotificationLog_teacherId_idx" ON "NotificationLog"("teacherId");

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Existing rows carry no leaving date. `isActive = false` is the only signal
-- that a child or a staff member is gone, and the best available departure date
-- is the enrolment/contract end where one was entered, falling back to the last
-- time the row was touched.
--
-- WITHDRAWN / RESIGNED are used as the neutral classification: neither asserts
-- a reason the data does not support. An administrator can correct any of these
-- from the profile screen, and doing so recalculates the retention date.
--
-- Deliberately NOT setting a retention date for rows that are still active —
-- there is nothing to count from.
-- ---------------------------------------------------------------------------

UPDATE "Student"
SET "status" = 'WITHDRAWN',
    "leftAt" = COALESCE("enrollmentEndDate", "updatedAt")
WHERE "isActive" = false
  AND "deletedAt" IS NULL;

UPDATE "Teacher"
SET "status" = 'RESIGNED',
    "leftAt" = COALESCE("enrollmentEndDate", "updatedAt")
WHERE "isActive" = false
  AND "deletedAt" IS NULL;

-- Retention dates derived from the seeded default (5 years). Computed in SQL
-- rather than left to the first cron run so the admin page shows a truthful
-- "waiting for anonymisation" count immediately.
--
-- `+ 3h → truncate → − 3h` is the SQL spelling of astDayStart() in
-- src/lib/datetime.ts: anchor to Riyadh midnight so a departure at 23:00 and one
-- at 08:00 on the same date expire together. These columns are `timestamp`
-- holding UTC, so the fixed offset is the correct operator — AT TIME ZONE would
-- read the stored value as local time and shift it the wrong way.
UPDATE "Student"
SET "retentionUntil" = date_trunc('day', "leftAt" + INTERVAL '3 hours')
                       - INTERVAL '3 hours'
                       + INTERVAL '5 years'
WHERE "leftAt" IS NOT NULL
  AND "retentionUntil" IS NULL;

UPDATE "Teacher"
SET "retentionUntil" = date_trunc('day', "leftAt" + INTERVAL '3 hours')
                       - INTERVAL '3 hours'
                       + INTERVAL '5 years'
WHERE "leftAt" IS NOT NULL
  AND "retentionUntil" IS NULL;

-- Analytics dimensions for rows that already exist.
--
-- Age is captured NOW, while `dateOfBirth` is still present. After
-- anonymisation it cannot be recovered, and age is the dimension the future
-- sector reports are built on — a backfill written later would find only nulls.
--
-- `+ 3 hours` shifts UTC to Riyadh wall-clock before any calendar part is read,
-- matching astParts() in src/lib/datetime.ts. Without it a departure at 23:00 on
-- 31 December is filed under the wrong year.
UPDATE "Student"
SET "ageAtEnrollmentMonths" = GREATEST(
        0,
        (EXTRACT(YEAR FROM AGE(
            COALESCE("enrollment_date", "registrationDate") + INTERVAL '3 hours',
            "dateOfBirth" + INTERVAL '3 hours'
         )) * 12
         + EXTRACT(MONTH FROM AGE(
            COALESCE("enrollment_date", "registrationDate") + INTERVAL '3 hours',
            "dateOfBirth" + INTERVAL '3 hours'
         )))::INT
    )
WHERE "dateOfBirth" IS NOT NULL
  AND "ageAtEnrollmentMonths" IS NULL;

UPDATE "Student"
SET "enrollmentYear" = EXTRACT(
        YEAR FROM COALESCE("enrollment_date", "registrationDate") + INTERVAL '3 hours'
    )::INT
WHERE "enrollmentYear" IS NULL;

UPDATE "Student"
SET "leftYear" = EXTRACT(YEAR FROM "leftAt" + INTERVAL '3 hours')::INT
WHERE "leftAt" IS NOT NULL
  AND "leftYear" IS NULL;

UPDATE "Teacher"
SET "ageAtHireMonths" = GREATEST(
        0,
        (EXTRACT(YEAR FROM AGE("joinDate" + INTERVAL '3 hours', "dateOfBirth" + INTERVAL '3 hours')) * 12
         + EXTRACT(MONTH FROM AGE("joinDate" + INTERVAL '3 hours', "dateOfBirth" + INTERVAL '3 hours')))::INT
    )
WHERE "dateOfBirth" IS NOT NULL
  AND "ageAtHireMonths" IS NULL;

UPDATE "Teacher"
SET "hireYear" = EXTRACT(YEAR FROM "joinDate" + INTERVAL '3 hours')::INT
WHERE "hireYear" IS NULL;

UPDATE "Teacher"
SET "leftYear" = EXTRACT(YEAR FROM "leftAt" + INTERVAL '3 hours')::INT
WHERE "leftAt" IS NOT NULL
  AND "leftYear" IS NULL;
