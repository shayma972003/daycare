BEGIN;

ALTER TABLE "Student"
ADD COLUMN "nfcTagHash" TEXT,
ADD COLUMN "nfcTagIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Student_nfcTagHash_key"
ON "Student"("nfcTagHash");

COMMIT;
