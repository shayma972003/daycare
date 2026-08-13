ALTER TABLE "PushNotification"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "PushNotification_status_leaseExpiresAt_idx"
  ON "PushNotification"("status", "leaseExpiresAt");

ALTER TABLE "PushNotification" ADD CONSTRAINT "PushNotification_lease_state_check"
  CHECK (
    ("leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("status" = 'PENDING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  );
