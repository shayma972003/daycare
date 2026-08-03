-- Infant age bands, class capacity, per-child attendance days, and explicit
-- attendance states (tasks 2.9–2.12).
--
-- Additive. `Class.group` is deliberately kept: existing rows, the import mapper
-- and the activities screen still read it. Dropping it would be a second, larger
-- change disguised as this one.

CREATE TYPE "AgeGroup" AS ENUM ('AGE_0_6M', 'AGE_6_12M', 'AGE_1_2Y', 'AGE_2_3Y', 'AGE_3_4Y');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'CHECKED_OUT', 'NO_RECORD');

-- ---------------------------------------------------------------------------
-- Class: age bands and capacity
-- ---------------------------------------------------------------------------

ALTER TABLE "Class"
    ADD COLUMN "ageGroups" "AgeGroup"[] DEFAULT ARRAY[]::"AgeGroup"[],
    -- Nullable on purpose: NULL is "not configured" and enforces nothing. An
    -- existing school must not start seeing capacity warnings on rooms it never
    -- set up. Zero is a real answer meaning the room is closed.
    ADD COLUMN "capacity" INTEGER;

-- Seeded from the legacy stage so the new field is not empty on day one.
-- The mapping is approximate by nature — "NURSERY" spans nought to three years,
-- which is exactly the imprecision these bands exist to remove — so it is a
-- starting point for the nursery to correct, not an assertion.
UPDATE "Class" SET "ageGroups" = ARRAY['AGE_1_2Y', 'AGE_2_3Y']::"AgeGroup"[]
WHERE "group" = 'NURSERY' AND cardinality("ageGroups") = 0;

UPDATE "Class" SET "ageGroups" = ARRAY['AGE_3_4Y']::"AgeGroup"[]
WHERE "group" IN ('KG1', 'KG2', 'KG3') AND cardinality("ageGroups") = 0;

-- ---------------------------------------------------------------------------
-- Student: which weekdays the child attends
--
-- 0 = Sunday … 6 = Saturday, matching Date.getUTCDay() so no translation table
-- is needed. Empty means "every working day", which is where every existing row
-- starts — attendance must keep working without anyone filling this in.
-- ---------------------------------------------------------------------------

ALTER TABLE "Student"
    ADD COLUMN "attendanceDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- ---------------------------------------------------------------------------
-- Attendance: state as a stored fact
-- ---------------------------------------------------------------------------

ALTER TABLE "Attendance"
    ADD COLUMN "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    ADD COLUMN "statusNote" TEXT;

-- Backfill: a row with a checkout already recorded is a completed day, not one
-- still in progress. Everything else keeps the PRESENT default, which is what a
-- row created by a check-in means.
UPDATE "Attendance" SET "status" = 'CHECKED_OUT'
WHERE "checkoutAt" IS NOT NULL;
