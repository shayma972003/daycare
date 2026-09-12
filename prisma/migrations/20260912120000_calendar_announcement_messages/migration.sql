-- Reuse the durable in-app message feed for calendar announcements.
-- Exactly one source owns every message; existing activity messages remain valid.
ALTER TABLE "ActivityMessage"
  ALTER COLUMN "activityId" DROP NOT NULL,
  ADD COLUMN "calendarEventId" TEXT;

CREATE UNIQUE INDEX "CalendarEvent_id_schoolId_key"
  ON "CalendarEvent"("id", "schoolId");

CREATE UNIQUE INDEX "ActivityMessage_schoolId_calendarEventId_idempotencyKey_key"
  ON "ActivityMessage"("schoolId", "calendarEventId", "idempotencyKey");

CREATE INDEX "ActivityMessage_calendarEventId_createdAt_idx"
  ON "ActivityMessage"("calendarEventId", "createdAt");

ALTER TABLE "ActivityMessage"
  ADD CONSTRAINT "ActivityMessage_calendarEventId_schoolId_fkey"
  FOREIGN KEY ("calendarEventId", "schoolId")
  REFERENCES "CalendarEvent"("id", "schoolId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityMessage"
  ADD CONSTRAINT "ActivityMessage_exactly_one_source_check"
  CHECK (num_nonnulls("activityId", "calendarEventId") = 1);
