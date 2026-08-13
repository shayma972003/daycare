BEGIN;

CREATE TYPE "StoredFileOwnerType" AS ENUM (
    'LEGACY',
    'STUDENT',
    'TEACHER',
    'ENROLLMENT_TOKEN',
    'ENROLLMENT_SUBMISSION'
);

ALTER TABLE "StoredFile"
ADD COLUMN "ownerType" "StoredFileOwnerType" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "deletePendingAt" TIMESTAMP(3);

-- A submission URL is authoritative only when exactly one submission points at
-- the stored key. Duplicate legacy references are deliberately left LEGACY:
-- choosing one would silently transfer another child's file.
WITH unique_submission_files AS (
    SELECT
        sf."key",
        min(es."id") AS submission_id,
        min(es."student_id") AS student_id,
        bool_and(es."status" = 'approved' AND es."student_id" IS NOT NULL) AS approved,
        count(*) AS reference_count
    FROM "StoredFile" sf
    JOIN "EnrollmentSubmission" es
      ON es."school_id" = sf."schoolId"
     AND es."evaluation_file_url" = '/api/files/' || sf."key"
    WHERE sf."category" = 'students'
    GROUP BY sf."key"
)
UPDATE "StoredFile" sf
SET
    "ownerType" = CASE
        WHEN linked.approved THEN 'STUDENT'::"StoredFileOwnerType"
        ELSE 'ENROLLMENT_SUBMISSION'::"StoredFileOwnerType"
    END,
    "ownerId" = CASE
        WHEN linked.approved THEN linked.student_id
        ELSE linked.submission_id
    END
FROM unique_submission_files linked
WHERE linked.reference_count = 1
  AND sf."key" = linked."key";

-- Direct student uploads are provable when the legacy owner id names a student
-- in the same tenant. This also covers care photos.
UPDATE "StoredFile" sf
SET "ownerType" = 'STUDENT'
WHERE sf."ownerType" = 'LEGACY'
  AND sf."category" IN ('students', 'care')
  AND EXISTS (
      SELECT 1
      FROM "Student" student
      WHERE student."id" = sf."ownerId"
        AND student."schoolId" = sf."schoolId"
  );

UPDATE "StoredFile" sf
SET "ownerType" = 'TEACHER'
WHERE sf."ownerType" = 'LEGACY'
  AND sf."category" = 'staff'
  AND EXISTS (
      SELECT 1
      FROM "Teacher" teacher
      WHERE teacher."id" = sf."ownerId"
        AND teacher."schoolId" = sf."schoolId"
  );

-- Old pre-submission uploads used ownerId='enrollment', which cannot identify
-- the token that produced them. They intentionally remain LEGACY for manual
-- review or bounded cleanup; this migration never guesses, deletes, or assigns
-- those ambiguous rows.

CREATE INDEX "StoredFile_schoolId_ownerType_ownerId_idx"
ON "StoredFile"("schoolId", "ownerType", "ownerId");

CREATE INDEX "StoredFile_deletePendingAt_idx"
ON "StoredFile"("deletePendingAt");

COMMIT;
