-- Staff job titles and qualifications (task 2.39).
--
-- Additive. `qualification1..10` are kept: they hold the detail (institution,
-- year, subject) and the new columns hold the one comparable fact each.

CREATE TYPE "EducationLevel" AS ENUM ('HIGH_SCHOOL', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD', 'OTHER');

ALTER TABLE "Teacher"
    -- Free text with a suggested list in the UI, not an enum: a nursery's own
    -- words for its posts vary, and an enum would force "مساعدة معلمة" into
    -- whichever option fits worst.
    ADD COLUMN "jobTitle" TEXT,
    -- An enum here, because this is the field a licensing inspection asks about
    -- and the sector reports will group on. "بكالوريوس", "بكالريوس" and
    -- "بكالوريوس تربية" are three strings and one answer.
    ADD COLUMN "educationLevel" "EducationLevel",
    ADD COLUMN "specialization" TEXT;

-- Seed the level from the free-text qualification already on file, where it is
-- unambiguous. Deliberately conservative: anything that does not clearly match
-- one level is left null for a human to set, rather than guessed at.
UPDATE "Teacher"
SET "educationLevel" = 'BACHELOR'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%بكالوريوس%' OR "qualification1" ILIKE '%بكالريوس%');

UPDATE "Teacher"
SET "educationLevel" = 'DIPLOMA'
WHERE "educationLevel" IS NULL AND "qualification1" ILIKE '%دبلوم%';

UPDATE "Teacher"
SET "educationLevel" = 'MASTER'
WHERE "educationLevel" IS NULL AND "qualification1" ILIKE '%ماجستير%';

UPDATE "Teacher"
SET "educationLevel" = 'PHD'
WHERE "educationLevel" IS NULL
  AND ("qualification1" ILIKE '%دكتوراه%' OR "qualification1" ILIKE '%دكتورا%');

UPDATE "Teacher"
SET "educationLevel" = 'HIGH_SCHOOL'
WHERE "educationLevel" IS NULL AND "qualification1" ILIKE '%ثانوي%';
