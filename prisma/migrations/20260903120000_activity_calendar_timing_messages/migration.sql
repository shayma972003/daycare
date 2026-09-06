-- Additive compatibility release:
-- * NULL Activity.allDay means the legacy date-only interpretation.
-- * Existing startDate/endDate values are left untouched.
ALTER TABLE "Activity" ADD COLUMN "allDay" BOOLEAN;

CREATE UNIQUE INDEX "Activity_id_schoolId_key" ON "Activity"("id", "schoolId");

CREATE TABLE "ActivityMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "targetRevision" TIMESTAMP(3) NOT NULL,
    "guardianRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "staffRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "pushQueuedCount" INTEGER NOT NULL DEFAULT 0,
    "pushFailureCount" INTEGER NOT NULL DEFAULT 0,
    "pushProcessedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityMessageRecipient" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT,
    "guardianAccountId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityMessageRecipient_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActivityMessageRecipient_exactly_one_owner_check"
      CHECK (num_nonnulls("userId", "guardianAccountId") = 1)
);

CREATE UNIQUE INDEX "ActivityMessage_id_schoolId_key" ON "ActivityMessage"("id", "schoolId");
CREATE UNIQUE INDEX "ActivityMessage_schoolId_activityId_idempotencyKey_key"
  ON "ActivityMessage"("schoolId", "activityId", "idempotencyKey");
CREATE INDEX "ActivityMessage_activityId_createdAt_idx" ON "ActivityMessage"("activityId", "createdAt");
CREATE INDEX "ActivityMessage_schoolId_createdAt_idx" ON "ActivityMessage"("schoolId", "createdAt");

CREATE UNIQUE INDEX "ActivityMessageRecipient_messageId_userId_key"
  ON "ActivityMessageRecipient"("messageId", "userId");
CREATE UNIQUE INDEX "ActivityMessageRecipient_messageId_guardianAccountId_key"
  ON "ActivityMessageRecipient"("messageId", "guardianAccountId");
CREATE INDEX "ActivityMessageRecipient_schoolId_userId_createdAt_idx"
  ON "ActivityMessageRecipient"("schoolId", "userId", "createdAt");
CREATE INDEX "ActivityMessageRecipient_schoolId_guardianAccountId_createdAt_idx"
  ON "ActivityMessageRecipient"("schoolId", "guardianAccountId", "createdAt");

ALTER TABLE "ActivityMessage"
  ADD CONSTRAINT "ActivityMessage_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMessage"
  ADD CONSTRAINT "ActivityMessage_activityId_schoolId_fkey"
  FOREIGN KEY ("activityId", "schoolId") REFERENCES "Activity"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMessageRecipient"
  ADD CONSTRAINT "ActivityMessageRecipient_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMessageRecipient"
  ADD CONSTRAINT "ActivityMessageRecipient_messageId_schoolId_fkey"
  FOREIGN KEY ("messageId", "schoolId") REFERENCES "ActivityMessage"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMessageRecipient"
  ADD CONSTRAINT "ActivityMessageRecipient_userId_schoolId_fkey"
  FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMessageRecipient"
  ADD CONSTRAINT "ActivityMessageRecipient_guardianAccountId_schoolId_fkey"
  FOREIGN KEY ("guardianAccountId", "schoolId") REFERENCES "GuardianAccount"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
