BEGIN;

ALTER TABLE "GuardianAccount"
ADD COLUMN "lastArrivalNoticeAt" TIMESTAMP(3);

CREATE TABLE "ArrivalRecipientSetting" (
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalRecipientSetting_pkey" PRIMARY KEY ("schoolId", "userId")
);

CREATE TABLE "ArrivalNotice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianAccountId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "pushQueuedCount" INTEGER NOT NULL DEFAULT 0,
    "pushFailureCount" INTEGER NOT NULL DEFAULT 0,
    "pushProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArrivalNoticeRecipient" (
    "noticeId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalNoticeRecipient_pkey" PRIMARY KEY ("noticeId", "userId")
);

CREATE INDEX "ArrivalRecipientSetting_userId_idx"
ON "ArrivalRecipientSetting"("userId");

CREATE UNIQUE INDEX "ArrivalNotice_id_schoolId_key"
ON "ArrivalNotice"("id", "schoolId");

CREATE INDEX "ArrivalNotice_schoolId_createdAt_idx"
ON "ArrivalNotice"("schoolId", "createdAt");

CREATE INDEX "ArrivalNotice_guardianAccountId_createdAt_idx"
ON "ArrivalNotice"("guardianAccountId", "createdAt");

CREATE INDEX "ArrivalNoticeRecipient_schoolId_userId_createdAt_idx"
ON "ArrivalNoticeRecipient"("schoolId", "userId", "createdAt");

ALTER TABLE "ArrivalRecipientSetting"
ADD CONSTRAINT "ArrivalRecipientSetting_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalRecipientSetting"
ADD CONSTRAINT "ArrivalRecipientSetting_userId_schoolId_fkey"
FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalNotice"
ADD CONSTRAINT "ArrivalNotice_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalNotice"
ADD CONSTRAINT "ArrivalNotice_guardianAccountId_schoolId_fkey"
FOREIGN KEY ("guardianAccountId", "schoolId") REFERENCES "GuardianAccount"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalNoticeRecipient"
ADD CONSTRAINT "ArrivalNoticeRecipient_noticeId_schoolId_fkey"
FOREIGN KEY ("noticeId", "schoolId") REFERENCES "ArrivalNotice"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalNoticeRecipient"
ADD CONSTRAINT "ArrivalNoticeRecipient_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrivalNoticeRecipient"
ADD CONSTRAINT "ArrivalNoticeRecipient_userId_schoolId_fkey"
FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
