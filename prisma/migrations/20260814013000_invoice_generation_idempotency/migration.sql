BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AdminInvoice"
    GROUP BY "school_id", "invoice_number" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invoice idempotency migration rejected duplicate admin invoice numbers';
  END IF;
END $$;

CREATE TYPE "InvoiceGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "Invoice"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "operationKind" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "generationStatus" "InvoiceGenerationStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "generationError" TEXT;

ALTER TABLE "AdminInvoice"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "generation_status" "InvoiceGenerationStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "generation_error" TEXT;

CREATE UNIQUE INDEX "Invoice_schoolId_operationKind_idempotencyKey_key"
  ON "Invoice"("schoolId", "operationKind", "idempotencyKey");
CREATE INDEX "Invoice_schoolId_generationStatus_createdAt_idx"
  ON "Invoice"("schoolId", "generationStatus", "createdAt");
CREATE UNIQUE INDEX "AdminInvoice_school_id_idempotency_key_key"
  ON "AdminInvoice"("school_id", "idempotency_key");
CREATE UNIQUE INDEX "AdminInvoice_school_id_invoice_number_key"
  ON "AdminInvoice"("school_id", "invoice_number");
CREATE INDEX "AdminInvoice_school_id_generation_status_created_at_idx"
  ON "AdminInvoice"("school_id", "generation_status", "created_at");

COMMIT;
