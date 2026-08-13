-- Transitional encrypted storage for staged spreadsheet rows. Legacy JSON
-- columns remain readable for an explicit, separately operated backfill.
ALTER TABLE "ImportRow"
ADD COLUMN "encrypted_payload" TEXT,
ALTER COLUMN "raw_data" DROP NOT NULL;
