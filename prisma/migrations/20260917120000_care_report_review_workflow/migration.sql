CREATE TYPE "CareReportReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "CareReport"
ADD COLUMN "reviewStatus" "CareReportReviewStatus",
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedByName" TEXT,
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "guardianNotifiedAt" TIMESTAMP(3);

-- Rows created before the review workflow were already readable by guardians.
-- Keeping them approved avoids hiding historical reports after deployment.
UPDATE "CareReport"
SET "reviewStatus" = 'APPROVED',
    "reviewedAt" = COALESCE("updatedAt", "createdAt")
WHERE "reviewStatus" IS NULL;

ALTER TABLE "CareReport"
ALTER COLUMN "reviewStatus" SET DEFAULT 'PENDING_REVIEW',
ALTER COLUMN "reviewStatus" SET NOT NULL;

CREATE INDEX "CareReport_schoolId_reviewStatus_occurredAt_idx"
ON "CareReport"("schoolId", "reviewStatus", "occurredAt");
