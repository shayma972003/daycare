-- The walk-up attendance QR kiosk is withdrawn.
--
-- Check-in and check-out are done by signed-in staff, so the unauthenticated
-- board at /attendance/public/<token> and the three endpoints behind it are
-- gone. These two columns held the credential that opened it.
--
-- Dropped rather than left in place: the value is a bearer token, and a live
-- credential for a door that no longer exists is the kind of row that gets
-- copied into a backup, an export or a support ticket long after anyone
-- remembers what it was for. Nothing reads them — `src/lib/attendance-token.ts`
-- and `/api/attendance/token` were removed in the same change.
--
-- Reversible: re-adding the columns restores the shape, and every token they
-- held was already meaningless once the routes went.

ALTER TABLE "School" DROP COLUMN IF EXISTS "attendanceToken";
ALTER TABLE "School" DROP COLUMN IF EXISTS "attendanceTokenCreatedAt";
