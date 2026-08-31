-- Split shifts and optional classroom assignment for the day-first rota.
-- Historical rows remain intact; no class is guessed or backfilled.
ALTER TABLE "Shift"
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "classNameSnapshot" TEXT;

DROP INDEX "Shift_teacherId_date_key";

CREATE UNIQUE INDEX "Shift_teacherId_date_startTime_endTime_key"
  ON "Shift"("teacherId", "date", "startTime", "endTime");
CREATE INDEX "Shift_teacherId_date_idx" ON "Shift"("teacherId", "date");
CREATE INDEX "Shift_classId_date_idx" ON "Shift"("classId", "date");

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
