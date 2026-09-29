-- Absence notifications are a third ActivityMessage source. Keep the source
-- columns mutually exclusive and require absenceDate only for student messages.
BEGIN;

ALTER TABLE "ActivityMessage"
  DROP CONSTRAINT "ActivityMessage_exactly_one_source_check";

ALTER TABLE "ActivityMessage"
  ADD CONSTRAINT "ActivityMessage_exactly_one_source_check"
  CHECK (
    num_nonnulls("activityId", "calendarEventId", "studentId") = 1
    AND (("studentId" IS NOT NULL) = ("absenceDate" IS NOT NULL))
  );

COMMIT;
