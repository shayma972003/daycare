BEGIN;

DO $$
DECLARE conflicts integer;
BEGIN
  SELECT count(*) INTO conflicts
  FROM "User" u JOIN "Role" r ON r."id" = u."roleId"
  WHERE u."roleId" IS NOT NULL AND u."schoolId" <> r."schoolId";
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'User/Role tenant conflicts: % row(s)', conflicts;
  END IF;

  SELECT count(*) INTO conflicts
  FROM "Student" s JOIN "Class" c ON c."id" = s."classId"
  WHERE s."classId" IS NOT NULL AND s."schoolId" <> c."schoolId";
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Student/Class tenant conflicts: % row(s)', conflicts;
  END IF;

  SELECT count(*) INTO conflicts
  FROM "Student" s JOIN "Guardian" g ON g."id" = s."guardianId"
  WHERE s."guardianId" IS NOT NULL AND s."schoolId" <> g."schoolId";
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Student/Guardian tenant conflicts: % row(s)', conflicts;
  END IF;

  SELECT count(*) INTO conflicts
  FROM "Student" s JOIN "AcademicStageOption" a ON a."id" = s."stageId"
  WHERE s."stageId" IS NOT NULL AND s."schoolId" <> a."schoolId";
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Student/AcademicStageOption tenant conflicts: % row(s)', conflicts;
  END IF;

  SELECT count(*) INTO conflicts
  FROM "StudentGuardian" sg
  JOIN "Student" s ON s."id" = sg."studentId"
  JOIN "Guardian" g ON g."id" = sg."guardianId"
  WHERE s."schoolId" <> g."schoolId";
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'StudentGuardian tenant conflicts: % row(s)', conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX "Role_id_schoolId_key" ON "Role"("id", "schoolId");
CREATE UNIQUE INDEX "Class_id_schoolId_key" ON "Class"("id", "schoolId");
CREATE UNIQUE INDEX "AcademicStageOption_id_schoolId_key"
  ON "AcademicStageOption"("id", "schoolId");
CREATE UNIQUE INDEX "Student_id_schoolId_key" ON "Student"("id", "schoolId");

ALTER TABLE "StudentGuardian" ADD COLUMN "schoolId" TEXT;
UPDATE "StudentGuardian" sg
SET "schoolId" = s."schoolId"
FROM "Student" s
WHERE s."id" = sg."studentId";
ALTER TABLE "StudentGuardian" ALTER COLUMN "schoolId" SET NOT NULL;
CREATE INDEX "StudentGuardian_schoolId_idx" ON "StudentGuardian"("schoolId");

ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_schoolId_fkey"
  FOREIGN KEY ("roleId", "schoolId") REFERENCES "Role"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_classId_fkey";
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_schoolId_fkey"
  FOREIGN KEY ("classId", "schoolId") REFERENCES "Class"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_guardianId_fkey";
ALTER TABLE "Student" ADD CONSTRAINT "Student_guardianId_schoolId_fkey"
  FOREIGN KEY ("guardianId", "schoolId") REFERENCES "Guardian"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_stageId_fkey";
ALTER TABLE "Student" ADD CONSTRAINT "Student_stageId_schoolId_fkey"
  FOREIGN KEY ("stageId", "schoolId") REFERENCES "AcademicStageOption"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentGuardian" DROP CONSTRAINT "StudentGuardian_studentId_fkey";
ALTER TABLE "StudentGuardian" DROP CONSTRAINT "StudentGuardian_guardianId_fkey";
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_schoolId_fkey"
  FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianId_schoolId_fkey"
  FOREIGN KEY ("guardianId", "schoolId") REFERENCES "Guardian"("id", "schoolId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
