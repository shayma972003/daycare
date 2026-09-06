CREATE TYPE "SchoolBillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SchoolSubscriptionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

ALTER TABLE "SubscriptionPlan" ADD COLUMN "billing_interval" "SchoolBillingInterval";
CREATE UNIQUE INDEX "SubscriptionPlan_billing_interval_key" ON "SubscriptionPlan"("billing_interval");

-- The product has two canonical school subscriptions. Historical plans remain
-- in place for audit/history but are hidden from new selections.
INSERT INTO "SubscriptionPlan" (
  "id", "name", "price", "max_students", "max_classes", "max_storage_mb",
  "is_active", "billing_interval", "created_at", "updated_at"
) VALUES
  ('school-plan-monthly-v1', 'اشتراك المدارس الشهري', 299.00, 0, 0, 0, true, 'MONTHLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('school-plan-yearly-v1', 'اشتراك المدارس السنوي', 2990.00, 0, 0, 0, true, 'YEARLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price" = EXCLUDED."price",
  "is_active" = true,
  "billing_interval" = EXCLUDED."billing_interval",
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "SubscriptionPlan"
SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "billing_interval" IS NULL;

CREATE TABLE "SchoolSubscriptionPayment" (
  "id" TEXT NOT NULL,
  "school_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "billing_interval" "SchoolBillingInterval" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'SAR',
  "status" "SchoolSubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'moyasar',
  "provider_invoice_id" TEXT,
  "checkout_url" TEXT,
  "paid_at" TIMESTAMP(3),
  "period_start" TIMESTAMP(3),
  "period_end" TIMESTAMP(3),
  "failure_reason" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolSubscriptionPayment_provider_invoice_id_key"
  ON "SchoolSubscriptionPayment"("provider_invoice_id");
CREATE INDEX "SchoolSubscriptionPayment_school_id_created_at_idx"
  ON "SchoolSubscriptionPayment"("school_id", "created_at");
CREATE INDEX "SchoolSubscriptionPayment_status_created_at_idx"
  ON "SchoolSubscriptionPayment"("status", "created_at");

ALTER TABLE "SchoolSubscriptionPayment"
  ADD CONSTRAINT "SchoolSubscriptionPayment_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolSubscriptionPayment"
  ADD CONSTRAINT "SchoolSubscriptionPayment_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
