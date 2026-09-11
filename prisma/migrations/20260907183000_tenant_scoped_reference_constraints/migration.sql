-- Strengthen tenant isolation at the database boundary. Application queries
-- already scope these references by schoolId; composite foreign keys make an
-- accidental cross-school write impossible as well.
--
-- This migration deliberately refuses to guess or repair ownership. If any
-- historical mismatch exists, it aborts before changing constraints so the
-- affected rows can be reviewed explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Class" c JOIN "Teacher" t ON t."id" = c."teacherId"
    WHERE c."teacherId" IS NOT NULL AND c."schoolId" <> t."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: Class.teacherId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Class" c JOIN "AcademicStageOption" s ON s."id" = c."stageId"
    WHERE c."stageId" IS NOT NULL AND c."schoolId" <> s."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: Class.stageId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Activity" a JOIN "Teacher" t ON t."id" = a."teacherId"
    WHERE a."teacherId" IS NOT NULL AND a."schoolId" <> t."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: Activity.teacherId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Activity" a JOIN "AcademicStageOption" s ON s."id" = a."stageId"
    WHERE a."stageId" IS NOT NULL AND a."schoolId" <> s."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: Activity.stageId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Shift" s JOIN "Class" c ON c."id" = s."classId"
    WHERE s."classId" IS NOT NULL AND s."schoolId" <> c."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: Shift.classId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "CalendarEvent" e JOIN "Teacher" t ON t."id" = e."teacherId"
    WHERE e."teacherId" IS NOT NULL AND e."schoolId" <> t."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: CalendarEvent.teacherId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "CalendarEvent" e JOIN "Unit" u ON u."id" = e."unitId"
    WHERE e."unitId" IS NOT NULL AND e."schoolId" <> u."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: CalendarEvent.unitId'; END IF;

  IF EXISTS (
    SELECT 1 FROM "User" u JOIN "Teacher" t ON t."id" = u."teacherId"
    WHERE u."teacherId" IS NOT NULL AND u."schoolId" <> t."schoolId"
  ) THEN RAISE EXCEPTION 'tenant mismatch: User.teacherId'; END IF;
END $$;

CREATE UNIQUE INDEX "Unit_id_schoolId_key" ON "Unit"("id", "schoolId");

ALTER TABLE "Class" DROP CONSTRAINT "Class_teacherId_fkey";
ALTER TABLE "Class" DROP CONSTRAINT "Class_stageId_fkey";
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_teacherId_fkey";
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_stageId_fkey";
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_classId_fkey";
ALTER TABLE "CalendarEvent" DROP CONSTRAINT "CalendarEvent_unitId_fkey";

ALTER TABLE "Class"
  ADD CONSTRAINT "Class_teacherId_schoolId_fkey"
  FOREIGN KEY ("teacherId", "schoolId") REFERENCES "Teacher"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Class"
  ADD CONSTRAINT "Class_stageId_schoolId_fkey"
  FOREIGN KEY ("stageId", "schoolId") REFERENCES "AcademicStageOption"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_teacherId_schoolId_fkey"
  FOREIGN KEY ("teacherId", "schoolId") REFERENCES "Teacher"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_stageId_schoolId_fkey"
  FOREIGN KEY ("stageId", "schoolId") REFERENCES "AcademicStageOption"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_classId_schoolId_fkey"
  FOREIGN KEY ("classId", "schoolId") REFERENCES "Class"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_teacherId_schoolId_fkey"
  FOREIGN KEY ("teacherId", "schoolId") REFERENCES "Teacher"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_unitId_schoolId_fkey"
  FOREIGN KEY ("unitId", "schoolId") REFERENCES "Unit"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_teacherId_schoolId_fkey"
  FOREIGN KEY ("teacherId", "schoolId") REFERENCES "Teacher"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
