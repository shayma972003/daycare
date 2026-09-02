-- Only an exact School.logoUrl -> StoredFile.key match proves ownership.
-- Ambiguous or unreferenced LEGACY rows intentionally remain untouched.
UPDATE "StoredFile" file
SET
  "ownerType" = 'SCHOOL',
  "ownerId" = school."id"
FROM "School" school
WHERE file."ownerType" = 'LEGACY'
  AND file."category" = 'school'
  AND file."schoolId" = school."id"
  AND school."logoUrl" = '/api/files/' || file."key";
