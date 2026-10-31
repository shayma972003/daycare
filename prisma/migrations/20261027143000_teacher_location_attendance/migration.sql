ALTER TABLE "School"
  ADD COLUMN "locationAttendanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locationLatitude" DOUBLE PRECISION,
  ADD COLUMN "locationLongitude" DOUBLE PRECISION,
  ADD COLUMN "locationCheckinRadiusMeters" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "locationCheckoutRadiusMeters" INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN "locationMaxAccuracyMeters" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "TeacherAttendance"
  ADD COLUMN "checkinSource" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "checkoutSource" TEXT,
  ADD COLUMN "checkinDistanceMeters" DOUBLE PRECISION,
  ADD COLUMN "checkoutDistanceMeters" DOUBLE PRECISION,
  ADD COLUMN "checkinAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "checkoutAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "checkinEventId" TEXT,
  ADD COLUMN "checkoutEventId" TEXT;

CREATE UNIQUE INDEX "TeacherAttendance_checkinEventId_key"
  ON "TeacherAttendance"("checkinEventId");
CREATE UNIQUE INDEX "TeacherAttendance_checkoutEventId_key"
  ON "TeacherAttendance"("checkoutEventId");
