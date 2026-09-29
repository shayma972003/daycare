ALTER TABLE "ActivityMessage"
ADD COLUMN "studentId" TEXT,
ADD COLUMN "absenceDate" DATE;

CREATE UNIQUE INDEX "ActivityMessage_schoolId_studentId_absenceDate_key"
ON "ActivityMessage"("schoolId", "studentId", "absenceDate");

CREATE INDEX "ActivityMessage_studentId_createdAt_idx"
ON "ActivityMessage"("studentId", "createdAt");

ALTER TABLE "ActivityMessage"
ADD CONSTRAINT "ActivityMessage_studentId_schoolId_fkey"
FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;
