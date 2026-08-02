-- Per-tenant invoice sequence.
--
-- Numbers came from `count() + 1`, which two concurrent requests resolve to the
-- same value and which reuses a number after a deletion. A tax document needs a
-- sequence that never repeats and never goes backwards.
--
-- Seeded from the invoices that already exist so tenants created before this
-- table do not re-issue numbers already in use. A gap in the sequence is
-- acceptable; a duplicate is not.

CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceCounter_schoolId_kind_key" ON "InvoiceCounter"("schoolId", "kind");

INSERT INTO "InvoiceCounter" ("id", "schoolId", "kind", "lastValue", "updatedAt")
SELECT gen_random_uuid()::TEXT, "schoolId", 'student', COUNT(*)::INT, now()
FROM "Invoice"
WHERE "type" = 'STUDENT'
GROUP BY "schoolId";

INSERT INTO "InvoiceCounter" ("id", "schoolId", "kind", "lastValue", "updatedAt")
SELECT gen_random_uuid()::TEXT, "schoolId", 'teacher', COUNT(*)::INT, now()
FROM "Invoice"
WHERE "type" = 'TEACHER'
GROUP BY "schoolId";

INSERT INTO "InvoiceCounter" ("id", "schoolId", "kind", "lastValue", "updatedAt")
SELECT gen_random_uuid()::TEXT, "school_id", 'admin', COUNT(*)::INT, now()
FROM "AdminInvoice"
GROUP BY "school_id";
