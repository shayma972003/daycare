-- Health and allergy data is more sensitive than ordinary roster data. Keep
-- it behind its own permission instead of inheriting access from
-- `students.manage`. Existing special-education roles retain the access their
-- template was designed to have; manager roles already use the `*` wildcard.
UPDATE "Role"
SET "permissions" = array_append("permissions", 'students.health'),
    "updatedAt" = now()
WHERE "key" = 'special_ed'
  AND NOT ('students.health' = ANY("permissions"));
