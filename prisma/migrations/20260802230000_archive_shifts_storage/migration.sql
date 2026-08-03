-- Class archiving, staff shifts, and storage quotas (tasks 2.25–2.31).
--
-- Additive. Note what is *not* here: no `archivedAt` on Student or Teacher.
-- Both already carry `status` + `leftAt` from the retention work, so "archived"
-- for them means `status != ACTIVE`. A fourth overlapping flag on those tables
-- would be a near-duplicate state that eventually disagrees with itself.

-- ---------------------------------------------------------------------------
-- Class archiving
--
-- Distinct from `deletedAt`, which is the 30-day trash. A room closed at the end
-- of the year keeps its history and its links; it stops appearing in the
-- working lists.
-- ---------------------------------------------------------------------------

ALTER TABLE "Class" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Class_schoolId_archivedAt_idx" ON "Class"("schoolId", "archivedAt");

-- ---------------------------------------------------------------------------
-- Storage quota on the plan
--
-- Zero means unlimited, matching how `max_students` and `max_classes` are
-- already read — one sentinel across all three rather than three conventions.
-- ---------------------------------------------------------------------------

ALTER TABLE "SubscriptionPlan" ADD COLUMN "max_storage_mb" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Staff shifts
--
-- One row per person per day, not a recurrence rule: a nursery's rota is agreed
-- week by week and changes constantly, and a recurrence model would spend all
-- its time being overridden.
-- ---------------------------------------------------------------------------

CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    -- "HH:mm" wall clock in AST, matching how School stores its hours. Instants
    -- would mean converting back to the wall clock people actually talk in on
    -- every read.
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "role" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- One shift per person per day. A split shift is a wider range or a note; two
-- rows would break the weekly grid's one-cell assumption.
CREATE UNIQUE INDEX "Shift_teacherId_date_key" ON "Shift"("teacherId", "date");
CREATE INDEX "Shift_schoolId_date_idx" ON "Shift"("schoolId", "date");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Cached storage consumption
--
-- Cached because computing it means summing the length of every base64 column
-- in the tenant — fine to run nightly or on demand, not on every page load.
-- ---------------------------------------------------------------------------

CREATE TABLE "StorageUsage" (
    "schoolId" TEXT NOT NULL,
    "studentFilesBytes" INTEGER NOT NULL DEFAULT 0,
    "careReportBytes" INTEGER NOT NULL DEFAULT 0,
    "staffFilesBytes" INTEGER NOT NULL DEFAULT 0,
    "unitFilesBytes" INTEGER NOT NULL DEFAULT 0,
    "invoiceBytes" INTEGER NOT NULL DEFAULT 0,
    "otherBytes" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageUsage_pkey" PRIMARY KEY ("schoolId")
);

ALTER TABLE "StorageUsage" ADD CONSTRAINT "StorageUsage_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
