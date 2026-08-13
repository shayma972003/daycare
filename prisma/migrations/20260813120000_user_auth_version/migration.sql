-- A monotonic account-local session generation. Existing JWTs are generation
-- zero, so the backfilled default preserves them until that account resets its
-- password; then only that account's older sessions are rejected.
ALTER TABLE "User"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
