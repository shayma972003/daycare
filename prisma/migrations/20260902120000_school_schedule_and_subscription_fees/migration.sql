-- Expand the old four schedule fields without removing them in this release.
-- Keeping the legacy columns lets the previous application version continue
-- to start and gives rollback a safe observation window. A later release may
-- drop them only after the old version is retired and the rollback window has
-- elapsed.
ALTER TABLE "School"
ADD COLUMN "teacherMorningCheckinTime" TEXT,
ADD COLUMN "teacherMorningCheckoutTime" TEXT,
ADD COLUMN "teacherEveningCheckinTime" TEXT,
ADD COLUMN "teacherEveningCheckoutTime" TEXT,
ADD COLUMN "studentMorningCheckinTime" TEXT,
ADD COLUMN "studentMorningCheckoutTime" TEXT,
ADD COLUMN "studentEveningCheckinTime" TEXT,
ADD COLUMN "studentEveningCheckoutTime" TEXT;

UPDATE "School"
SET
  "teacherMorningCheckinTime" = "teacherCheckinTime",
  "teacherMorningCheckoutTime" = "teacherCheckoutTime",
  "teacherEveningCheckinTime" = "teacherCheckinTime",
  "teacherEveningCheckoutTime" = "teacherCheckoutTime",
  "studentMorningCheckinTime" = "studentCheckinTime",
  "studentMorningCheckoutTime" = "studentCheckoutTime",
  "studentEveningCheckinTime" = "studentCheckinTime",
  "studentEveningCheckoutTime" = "studentCheckoutTime";

-- Transition plan:
-- 1. This release deploys period-aware reads/writes while the previous release
--    can still read the four retained legacy columns during rollback.
-- 2. Keep the columns through the old-version shutdown and rollback window;
--    do not infer two distinct periods back into one legacy value.
-- 3. In a later reviewed release, verify no old application instance remains,
--    then remove the legacy fields from Prisma and drop them in that release's
--    own migration. They are deliberately not dropped by this migration.

ALTER TABLE "Settings"
ADD COLUMN "weeklyStudentFee" DECIMAL(18,2),
ADD COLUMN "yearlyStudentFee" DECIMAL(18,2);

-- Freeze the inherited price of existing daily/monthly subscriptions. Later
-- settings changes must only affect a new subscription or the next renewal.
UPDATE "Student" student
SET "cycleFee" = CASE student."billingCycle"
  WHEN 'DAILY' THEN settings."dailyStudentFee"
  WHEN 'MONTHLY' THEN settings."monthlyStudentFee"
  ELSE student."cycleFee"
END
FROM "Settings" settings
WHERE student."schoolId" = settings."schoolId"
  AND student."cycleFee" IS NULL
  AND student."billingCycle" IN ('DAILY', 'MONTHLY');

-- Added separately from the ownership backfill. PostgreSQL does not allow a
-- newly-added enum value to be used safely before the transaction commits.
ALTER TYPE "StoredFileOwnerType" ADD VALUE 'SCHOOL';
