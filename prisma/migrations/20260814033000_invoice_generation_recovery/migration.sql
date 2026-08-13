-- A process can terminate after claiming an idempotency key but before it can
-- mark the row FAILED. A bounded lease makes that claim recoverable without
-- allowing two active generators to own it at the same time.
ALTER TABLE "Invoice"
  ADD COLUMN "generationLeaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "AdminInvoice"
  ADD COLUMN "generation_lease_expires_at" TIMESTAMP(3);

CREATE INDEX "Invoice_generationStatus_generationLeaseExpiresAt_idx"
  ON "Invoice"("generationStatus", "generationLeaseExpiresAt");

CREATE INDEX "AdminInvoice_generation_status_generation_lease_expires_at_idx"
  ON "AdminInvoice"("generation_status", "generation_lease_expires_at");
