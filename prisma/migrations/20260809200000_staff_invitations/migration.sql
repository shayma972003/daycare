-- Staff invitations: the same three columns GuardianAccount already carries.
--
-- Staff used to be emailed a generated password in the clear. This replaces
-- that with an invitation, so the password is chosen by the person who types it
-- and the link that grants it expires.

ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "acceptedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");

-- `password` becomes nullable: an invited account has none until it is redeemed.
-- Nothing existing is affected — every current row has a password already, and
-- the auth layer compares against a dummy hash when the column is null, so a
-- pending invitation simply cannot sign in.
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- Backfill, and the reason it matters.
--
-- Every row that exists right now predates invitations: it was created by
-- registration or by the old mailed-password route, and its owner has been
-- signing in with it. Left null, `acceptedAt` would render each of them as a
-- stale invitation in the new accounts view — including the school owner's own
-- account. Their creation date is when they became usable, which is exactly
-- what this column means.
--
-- Sign-in never consults `acceptedAt` for staff, so this backfill is about what
-- the dashboard shows, not about who can get in.
UPDATE "User" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;
