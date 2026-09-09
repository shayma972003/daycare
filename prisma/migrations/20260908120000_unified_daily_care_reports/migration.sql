-- Additive support for the unified daily-care form. Existing reports remain
-- valid and are not rewritten or grouped retroactively.
CREATE TYPE "CareMealSource" AS ENUM ('CENTER', 'HOME');

ALTER TABLE "CareReport"
  ADD COLUMN "mealSource" "CareMealSource",
  ADD COLUMN "dailyBatchId" TEXT,
  ADD COLUMN "dailyBatchHash" TEXT,
  ADD COLUMN "dailyItemKey" TEXT;

CREATE UNIQUE INDEX "CareReport_schoolId_dailyBatchId_studentId_dailyItemKey_key"
  ON "CareReport"("schoolId", "dailyBatchId", "studentId", "dailyItemKey");

CREATE INDEX "CareReport_schoolId_dailyBatchId_idx"
  ON "CareReport"("schoolId", "dailyBatchId");
