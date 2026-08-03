-- Widen the education-level backfill (follow-up to 20260803030000).
--
-- The first pass matched nothing. It looked for "بكالوريوس" and "بكالريوس"; the
-- live rows say **"بكلوريوس"** — a third spelling, which is exactly the reason
-- this column was introduced as an enum in the first place. The lesson is in the
-- data: guessing which variants exist from a keyboard is not the same as
-- reading them.
--
-- Patterns are deliberately loose now (`بك%وريوس`, `بك%لريوس`) so ordinary
-- misspellings are caught, and still anchored enough that an unrelated word
-- cannot match. Anything ambiguous is still left null for a human — a wrong
-- qualification on a staff record is worse than a blank one.

UPDATE "Teacher"
SET "educationLevel" = 'BACHELOR'
WHERE "educationLevel" IS NULL
  AND (
    "qualification1" ILIKE '%بك%وريوس%'
    OR "qualification1" ILIKE '%بك%لريوس%'
    OR "qualification1" ILIKE '%bachelor%'
    OR "specialization" ILIKE '%بك%وريوس%'
  );

UPDATE "Teacher"
SET "educationLevel" = 'DIPLOMA'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%دبلوم%' OR "qualification1" ILIKE '%diploma%');

UPDATE "Teacher"
SET "educationLevel" = 'MASTER'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%ماجست%' OR "qualification1" ILIKE '%master%');

UPDATE "Teacher"
SET "educationLevel" = 'PHD'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%دكتور%' OR "qualification1" ILIKE '%phd%');

UPDATE "Teacher"
SET "educationLevel" = 'HIGH_SCHOOL'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%ثانوي%' OR "qualification1" ILIKE '%secondary%');
