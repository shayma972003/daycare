-- Finance correctness foundation.
--
-- Existing Expense rows are templates, not proof of payment. We therefore do
-- not invent historical paid/unpaid states. Only the currently due occurrence
-- of an active legacy monthly expense is created; future occurrences are
-- generated idempotently by the existing daily cron.

CREATE TYPE "ExpenseOccurrenceStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

ALTER TABLE "PaymentCycle" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "PaymentCycle" ADD COLUMN "paid_by" TEXT;

-- PAID existed before a payment timestamp did. The due date is the only
-- defensible historical boundary; mark it as an inferred settlement date rather
-- than pretending the migration knows when cash actually arrived.
UPDATE "PaymentCycle"
SET "paid_at" = "due_date"
WHERE "status" = 'PAID' AND "paid_at" IS NULL;

DO $$
DECLARE duplicate_count bigint;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT "student_id", "due_date"
    FROM "PaymentCycle"
    GROUP BY "student_id", "due_date"
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'PaymentCycle duplicate student/due-date groups: %', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "PaymentCycle_student_id_due_date_key"
ON "PaymentCycle"("student_id", "due_date");

CREATE UNIQUE INDEX "Expense_id_school_id_key" ON "Expense"("id", "school_id");

CREATE TABLE "ExpenseOccurrence" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "ExpenseOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceProfile" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opening_balance_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseOccurrence_expense_id_due_date_key"
ON "ExpenseOccurrence"("expense_id", "due_date");
CREATE INDEX "ExpenseOccurrence_school_id_status_due_date_idx"
ON "ExpenseOccurrence"("school_id", "status", "due_date");
CREATE UNIQUE INDEX "FinanceProfile_school_id_key" ON "FinanceProfile"("school_id");

ALTER TABLE "ExpenseOccurrence"
ADD CONSTRAINT "ExpenseOccurrence_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpenseOccurrence"
ADD CONSTRAINT "ExpenseOccurrence_expense_id_school_id_fkey"
FOREIGN KEY ("expense_id", "school_id") REFERENCES "Expense"("id", "school_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceProfile"
ADD CONSTRAINT "FinanceProfile_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed only an occurrence that is already due in the current month. Historical
-- rows had no settlement field, so backfilling all past months as unpaid would
-- fabricate debt and generate a large false alert count.
-- A cancelled marker for legacy one-time templates prevents the daily sync from
-- later turning unknown historical expenses into new unpaid alerts. CANCELLED
-- is excluded from summaries and is not a claim that the expense was paid.
INSERT INTO "ExpenseOccurrence" (
  "id", "school_id", "expense_id", "due_date", "amount", "status", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  e."school_id",
  e."id",
  e."start_date"::date,
  e."amount",
  'CANCELLED'::"ExpenseOccurrenceStatus",
  CURRENT_TIMESTAMP
FROM "Expense" e
WHERE e."type" = 'one_time'
  AND e."start_date"::date <= CURRENT_DATE
ON CONFLICT ("expense_id", "due_date") DO NOTHING;

WITH legacy_due AS (
  SELECT
    e."id" AS expense_id,
    e."school_id",
    e."amount",
    make_date(
      EXTRACT(YEAR FROM CURRENT_DATE)::int,
      EXTRACT(MONTH FROM CURRENT_DATE)::int,
      LEAST(
        EXTRACT(DAY FROM e."start_date")::int,
        EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int
      )
    ) AS due_date
  FROM "Expense" e
  WHERE e."type" = 'monthly'
    AND e."is_active" = true
    AND e."start_date"::date <= CURRENT_DATE
    AND (e."end_date" IS NULL OR e."end_date"::date >= CURRENT_DATE)
    AND (e."stopped_at" IS NULL OR e."stopped_at"::date >= CURRENT_DATE)
)
INSERT INTO "ExpenseOccurrence" (
  "id", "school_id", "expense_id", "due_date", "amount", "updated_at"
)
SELECT gen_random_uuid()::text, school_id, expense_id, due_date, amount, CURRENT_TIMESTAMP
FROM legacy_due
WHERE due_date <= CURRENT_DATE
ON CONFLICT ("expense_id", "due_date") DO NOTHING;
