-- Roles and permissions, guardian accounts, mobile sessions, push delivery.
--
-- Additive. No column is dropped and no row is deleted. Existing users keep
-- working: `roleId` is nullable, and the permission layer treats a school's
-- first user as its owner until a role is assigned (see resolvePermissions in
-- src/lib/authz.ts) — so nobody is locked out of their own nursery the moment
-- this lands.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID', 'HUAWEI', 'WEB');
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- ---------------------------------------------------------------------------
-- Roles
--
-- `permissions` is a text array, not a join table. The permission *keys* live in
-- code (they change with each release); what belongs in the database is which of
-- them a given school's role holds. A Permission table would need a data
-- migration per deploy and could drift into granting keys nothing enforces.
-- ---------------------------------------------------------------------------

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_schoolId_key_key" ON "Role"("schoolId", "key");
CREATE INDEX "Role_schoolId_idx" ON "Role"("schoolId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Staff accounts — the existing User table gains a role and a staff link.
--
-- Deliberately NOT a second credentials table. A parallel "StaffAccount" would
-- mean two sign-in paths, two reset flows and two lockout counters for the same
-- audience, and every hardening step from week 1 would have to be duplicated
-- onto the copy or silently not apply to it.
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
    ADD COLUMN "roleId" TEXT,
    ADD COLUMN "teacherId" TEXT,
    ADD COLUMN "disabledAt" TIMESTAMP(3);

CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");
CREATE INDEX "User_teacherId_idx" ON "User"("teacherId");

ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Guardian accounts
-- ---------------------------------------------------------------------------

CREATE TABLE "GuardianAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuardianAccount_guardianId_key" ON "GuardianAccount"("guardianId");
CREATE UNIQUE INDEX "GuardianAccount_email_key" ON "GuardianAccount"("email");
CREATE UNIQUE INDEX "GuardianAccount_inviteTokenHash_key" ON "GuardianAccount"("inviteTokenHash");
CREATE INDEX "GuardianAccount_schoolId_idx" ON "GuardianAccount"("schoolId");
CREATE INDEX "GuardianAccount_phone_idx" ON "GuardianAccount"("phone");

ALTER TABLE "GuardianAccount" ADD CONSTRAINT "GuardianAccount_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianAccount" ADD CONSTRAINT "GuardianAccount_guardianId_fkey"
    FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Push delivery
-- ---------------------------------------------------------------------------

CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianAccountId" TEXT,
    "userId" TEXT,
    "platform" "PushPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "failedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- Unique so a device re-registering updates its row instead of accumulating
-- duplicates that would each produce a copy of every notification.
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX "DeviceToken_schoolId_idx" ON "DeviceToken"("schoolId");
CREATE INDEX "DeviceToken_guardianAccountId_idx" ON "DeviceToken"("guardianAccountId");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_guardianAccountId_fkey"
    FOREIGN KEY ("guardianAccountId") REFERENCES "GuardianAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushNotification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "deviceTokenId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushNotification_status_scheduledAt_idx" ON "PushNotification"("status", "scheduledAt");
CREATE INDEX "PushNotification_schoolId_createdAt_idx" ON "PushNotification"("schoolId", "createdAt");

-- ---------------------------------------------------------------------------
-- Mobile refresh tokens
--
-- Hash only. A leaked table must not be a set of working sessions — the same
-- reason password reset tokens are hashed.
-- ---------------------------------------------------------------------------

CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "guardianAccountId" TEXT,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_guardianAccountId_idx" ON "RefreshToken"("guardianAccountId");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- ---------------------------------------------------------------------------
-- Seed the six roles for every existing school, and make each school's first
-- user its manager.
--
-- Done here rather than lazily at runtime so the permission screen has something
-- to show from the first page load, and so the fallback in resolvePermissions is
-- a safety net rather than the normal path.
--
-- "First user" = earliest `createdAt`. For every school in production today that
-- is the account created by the registration wizard — the owner.
-- ---------------------------------------------------------------------------

INSERT INTO "Role" ("id", "schoolId", "key", "nameAr", "permissions", "isSystem", "updatedAt")
SELECT gen_random_uuid()::TEXT, s."id", t."key", t."nameAr", t."permissions", true, now()
FROM "School" s
CROSS JOIN (VALUES
    ('manager', 'مدير', ARRAY['*']),
    ('hr', 'موارد بشرية', ARRAY[
        'auth.portal','auth.app','staff.view','staff.manage','staff.archive',
        'attendance.staff','schedule.view','schedule.manage']),
    ('teacher', 'معلم/ة', ARRAY[
        'auth.portal','auth.app','students.view','students.files','classes.view',
        'classes.assign','units.view','schedule.view','attendance.students']),
    ('special_ed', 'معلم/ة تربية خاصة', ARRAY[
        'auth.portal','auth.app','students.view','students.files','classes.view',
        'classes.assign','units.view','schedule.view','attendance.students','students.manage']),
    ('early_childhood', 'معلم/ة طفولة مبكرة', ARRAY[
        'auth.portal','auth.app','students.view','students.files','classes.view',
        'classes.assign','units.view','schedule.view','attendance.students',
        'units.manage','schedule.manage']),
    ('accountant', 'محاسب', ARRAY[
        'auth.portal','students.view','finance.view','finance.manage','finance.subscriptions'])
) AS t("key", "nameAr", "permissions")
ON CONFLICT ("schoolId", "key") DO NOTHING;

UPDATE "User" u
SET "roleId" = r."id"
FROM "Role" r
WHERE r."schoolId" = u."schoolId"
  AND r."key" = 'manager'
  AND u."roleId" IS NULL
  AND u."id" = (
      SELECT u2."id" FROM "User" u2
      WHERE u2."schoolId" = u."schoolId"
      ORDER BY u2."createdAt" ASC, u2."id" ASC
      LIMIT 1
  );
