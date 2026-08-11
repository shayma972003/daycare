-- Accounts created before school-admin invitations used a generated password.
-- They are already active and must not be locked out when sign-in starts
-- requiring acceptedAt. Newly-created invited accounts have a NULL password.
UPDATE "User"
SET "acceptedAt" = "createdAt"
WHERE "password" IS NOT NULL AND "acceptedAt" IS NULL;

CREATE TABLE "SchoolAdminInvitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolAdminInvitation_tokenHash_key"
ON "SchoolAdminInvitation"("tokenHash");

-- PostgreSQL partial uniqueness prevents two concurrent resend requests from
-- leaving two usable invitations for the same school administrator.
CREATE UNIQUE INDEX "SchoolAdminInvitation_one_active_per_user"
ON "SchoolAdminInvitation"("userId")
WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

CREATE INDEX "SchoolAdminInvitation_schoolId_userId_idx"
ON "SchoolAdminInvitation"("schoolId", "userId");

CREATE INDEX "SchoolAdminInvitation_userId_expiresAt_idx"
ON "SchoolAdminInvitation"("userId", "expiresAt");

CREATE INDEX "SchoolAdminInvitation_expiresAt_idx"
ON "SchoolAdminInvitation"("expiresAt");

ALTER TABLE "SchoolAdminInvitation"
ADD CONSTRAINT "SchoolAdminInvitation_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolAdminInvitation"
ADD CONSTRAINT "SchoolAdminInvitation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
