-- Calendar and teaching units (tasks 2.18–2.24).
--
-- Purely additive: new tables only. Nothing existing is touched.

CREATE TYPE "CalendarEventType" AS ENUM ('LESSON', 'ACTIVITY', 'ANNOUNCEMENT');

-- ---------------------------------------------------------------------------
-- Units and lessons
-- ---------------------------------------------------------------------------

CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    -- Archived is not deleted: last year's units are the material a nursery
    -- reuses. Hiding them from the working list is the requirement; losing them
    -- is not.
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Unit_schoolId_archivedAt_idx" ON "Unit"("schoolId", "archivedAt");
CREATE INDEX "Unit_schoolId_deletedAt_idx" ON "Unit"("schoolId", "deletedAt");

ALTER TABLE "Unit" ADD CONSTRAINT "Unit_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UnitClass" (
    "unitId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,

    CONSTRAINT "UnitClass_pkey" PRIMARY KEY ("unitId", "classId")
);

CREATE INDEX "UnitClass_classId_idx" ON "UnitClass"("classId");

ALTER TABLE "UnitClass" ADD CONSTRAINT "UnitClass_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    -- Explicit ordering: lessons are a sequence, and sorting by creation time
    -- breaks the moment one is inserted between two others.
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lesson_unitId_orderIndex_idx" ON "Lesson"("unitId", "orderIndex");

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Its own table, not columns on Unit: attachments are base64 payloads until the
-- move to R2 (tasks 0.34/0.35), and holding them on the unit row would drag
-- megabytes into every query that lists units.
CREATE TABLE "UnitFile" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "url" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnitFile_unitId_idx" ON "UnitFile"("unitId");

ALTER TABLE "UnitFile" ADD CONSTRAINT "UnitFile_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    -- Null for an announcement, which has a day but no duration.
    "endAt" TIMESTAMP(3),
    -- Distinguishes "all of Thursday" from "Thursday at midnight" — the same
    -- instant, and not the same statement.
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "teacherId" TEXT,
    "unitId" TEXT,
    "lessonId" TEXT,
    "location" TEXT,
    "createdByName" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- The month view's query: everything in a school between two instants.
CREATE INDEX "CalendarEvent_schoolId_startAt_idx" ON "CalendarEvent"("schoolId", "startAt");
CREATE INDEX "CalendarEvent_schoolId_type_startAt_idx" ON "CalendarEvent"("schoolId", "type", "startAt");
CREATE INDEX "CalendarEvent_teacherId_startAt_idx" ON "CalendarEvent"("teacherId", "startAt");

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CalendarEventClass" (
    "eventId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventClass_pkey" PRIMARY KEY ("eventId", "classId")
);

CREATE INDEX "CalendarEventClass_classId_idx" ON "CalendarEventClass"("classId");

ALTER TABLE "CalendarEventClass" ADD CONSTRAINT "CalendarEventClass_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
