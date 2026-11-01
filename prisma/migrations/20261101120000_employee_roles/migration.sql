-- Replace the legacy teaching-specialty account choices with a fixed employee
-- role set.  The old rows are retained for audit/history, but the application
-- no longer offers them for assignment.

INSERT INTO "Role" ("id", "schoolId", "key", "nameAr", "permissions", "isSystem", "updatedAt")
SELECT gen_random_uuid()::TEXT, s."id", t."key", t."nameAr", t."permissions", true, now()
FROM "School" s
CROSS JOIN (VALUES
  ('admin_assistant', 'مساعد إداري', ARRAY[
    'auth.portal','auth.app','students.view','students.all','students.manage',
    'students.guardians','students.files','classes.view','classes.assign',
    'schedule.view','attendance.students'
  ]::TEXT[]),
  ('teacher_assistant', 'مساعد معلم', ARRAY[
    'auth.portal','auth.app','students.view','students.files','classes.view',
    'units.view','schedule.view','attendance.students'
  ]::TEXT[])
) AS t("key", "nameAr", "permissions")
ON CONFLICT ("schoolId", "key") DO NOTHING;

-- Keep the product vocabulary stable without resetting tenant-specific
-- permission customisations on roles that already existed.
UPDATE "Role"
SET "nameAr" = CASE "key"
  WHEN 'manager' THEN 'مدير'
  WHEN 'admin_assistant' THEN 'مساعد إداري'
  WHEN 'teacher' THEN 'معلم'
  WHEN 'teacher_assistant' THEN 'مساعد معلم'
  WHEN 'accountant' THEN 'محاسب'
  WHEN 'hr' THEN 'موارد بشرية'
  ELSE "nameAr"
END,
"isSystem" = true,
"updatedAt" = now()
WHERE "key" IN (
  'manager', 'admin_assistant', 'teacher', 'teacher_assistant', 'accountant', 'hr'
);

-- Every employee role may sign into the mobile app for location attendance.
UPDATE "Role"
SET "permissions" = array_append("permissions", 'auth.app'),
    "updatedAt" = now()
WHERE "key" IN ('admin_assistant', 'teacher', 'teacher_assistant', 'accountant', 'hr')
  AND NOT ('auth.app' = ANY("permissions"));

-- Existing accounts on the two retired teaching-specialty roles become
-- teachers in the same tenant. No account, audit row or role history is deleted.
UPDATE "User" u
SET "roleId" = teacher_role."id"
FROM "Role" legacy_role
JOIN "Role" teacher_role
  ON teacher_role."schoolId" = legacy_role."schoolId"
 AND teacher_role."key" = 'teacher'
WHERE u."roleId" = legacy_role."id"
  AND legacy_role."key" IN ('special_ed', 'early_childhood');
