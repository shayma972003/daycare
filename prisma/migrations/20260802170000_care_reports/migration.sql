-- Daily care reports (tasks 2.1–2.8).
--
-- Purely additive: one new table and its enums. Nothing existing is touched.

CREATE TYPE "CareReportType" AS ENUM (
    'MEAL', 'NAP', 'TOILET', 'MOOD', 'MEDICATION', 'HEALTH', 'SUPPLIES', 'GENERAL'
);
CREATE TYPE "MealAmount" AS ENUM ('ALL', 'HALF', 'LITTLE', 'REFUSED');
CREATE TYPE "ToiletKind" AS ENUM ('DIAPER', 'POTTY');
CREATE TYPE "ChildMood" AS ENUM ('HAPPY', 'CALM', 'TIRED', 'UPSET', 'CRYING', 'UNWELL');
CREATE TYPE "SupplyUrgency" AS ENUM ('NORMAL', 'SOON', 'URGENT');

-- Per-type columns rather than a JSON blob: "how much did he eat this week",
-- "how long did she nap", "temperature over time" are the questions this feature
-- exists to answer, and JSON cannot be indexed or aggregated without extracting
-- it at query time. See the model comment in schema.prisma.
CREATE TABLE "CareReport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "teacherId" TEXT,
    "reportedByName" TEXT NOT NULL,
    "type" "CareReportType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    "mealName" TEXT,
    "mealAmount" "MealAmount",

    "napStartAt" TIMESTAMP(3),
    "napEndAt" TIMESTAMP(3),
    "napMinutes" INTEGER,
    "napQuality" TEXT,

    "toiletKind" "ToiletKind",
    "toiletState" TEXT,

    "mood" "ChildMood",

    "medicationName" TEXT,
    "medicationDose" TEXT,
    "givenByName" TEXT,

    "temperature" DOUBLE PRECISION,
    "symptom" TEXT,
    "actionTaken" TEXT,

    "supplyItem" TEXT,
    "supplyQuantity" INTEGER,
    "supplyUrgency" "SupplyUrgency",

    "note" TEXT,
    "photoUrl" TEXT,

    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "summarizedAt" TIMESTAMP(3),

    CONSTRAINT "CareReport_pkey" PRIMARY KEY ("id")
);

-- The child's own feed — the most frequent query in the product once this ships.
CREATE INDEX "CareReport_studentId_occurredAt_idx" ON "CareReport"("studentId", "occurredAt");
CREATE INDEX "CareReport_schoolId_occurredAt_idx" ON "CareReport"("schoolId", "occurredAt");
-- Type-filtered history ("show me all meals"), and the future analytics rollups.
CREATE INDEX "CareReport_schoolId_type_occurredAt_idx" ON "CareReport"("schoolId", "type", "occurredAt");
-- Drives the nightly digest: unsent reports for a school.
CREATE INDEX "CareReport_schoolId_summarizedAt_idx" ON "CareReport"("schoolId", "summarizedAt");

ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
