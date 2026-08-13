BEGIN;

DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM (
    SELECT price AS value FROM "SubscriptionPlan"
    UNION ALL SELECT amount FROM "PaymentCycle"
    UNION ALL SELECT total_amount FROM "AdminInvoice"
    UNION ALL SELECT "hourlyLateFee" FROM "Settings"
    UNION ALL SELECT "dailyStudentFee" FROM "Settings"
    UNION ALL SELECT "monthlyStudentFee" FROM "Settings"
    UNION ALL SELECT "monthlySalary" FROM "Teacher"
    UNION ALL SELECT "lateDeductionRate" FROM "Teacher"
    UNION ALL SELECT "cycleFee" FROM "Student" WHERE "cycleFee" IS NOT NULL
    UNION ALL SELECT registration_fee FROM "Student"
    UNION ALL SELECT "activityFee" FROM "Activity"
    UNION ALL SELECT "lateFee" FROM "Attendance"
    UNION ALL SELECT amount FROM "Invoice"
    UNION ALL SELECT vat_amount FROM "Invoice"
    UNION ALL SELECT amount FROM "Expense"
  ) values_to_check
  WHERE value::text IN ('NaN', 'Infinity', '-Infinity')
     OR abs(value) > 9999999999999999.99;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Financial Decimal conversion rejected % non-finite or out-of-range value(s)', conflict_count;
  END IF;
END $$;

ALTER TABLE "SubscriptionPlan" ALTER COLUMN price TYPE DECIMAL(18,2) USING round(price::numeric, 2);
ALTER TABLE "PaymentCycle" ALTER COLUMN amount TYPE DECIMAL(18,2) USING round(amount::numeric, 2);
ALTER TABLE "AdminInvoice" ALTER COLUMN total_amount TYPE DECIMAL(18,2) USING round(total_amount::numeric, 2);
ALTER TABLE "Settings" ALTER COLUMN "hourlyLateFee" TYPE DECIMAL(18,2) USING round("hourlyLateFee"::numeric, 2);
ALTER TABLE "Settings" ALTER COLUMN "dailyStudentFee" TYPE DECIMAL(18,2) USING round("dailyStudentFee"::numeric, 2);
ALTER TABLE "Settings" ALTER COLUMN "monthlyStudentFee" TYPE DECIMAL(18,2) USING round("monthlyStudentFee"::numeric, 2);
ALTER TABLE "Teacher" ALTER COLUMN "monthlySalary" TYPE DECIMAL(18,2) USING round("monthlySalary"::numeric, 2);
ALTER TABLE "Teacher" ALTER COLUMN "lateDeductionRate" TYPE DECIMAL(18,2) USING round("lateDeductionRate"::numeric, 2);
ALTER TABLE "Student" ALTER COLUMN "cycleFee" TYPE DECIMAL(18,2) USING round("cycleFee"::numeric, 2);
ALTER TABLE "Student" ALTER COLUMN registration_fee TYPE DECIMAL(18,2) USING round(registration_fee::numeric, 2);
ALTER TABLE "Activity" ALTER COLUMN "activityFee" TYPE DECIMAL(18,2) USING round("activityFee"::numeric, 2);
ALTER TABLE "Attendance" ALTER COLUMN "lateFee" TYPE DECIMAL(18,2) USING round("lateFee"::numeric, 2);
ALTER TABLE "Invoice" ALTER COLUMN amount TYPE DECIMAL(18,2) USING round(amount::numeric, 2);
ALTER TABLE "Invoice" ALTER COLUMN vat_amount TYPE DECIMAL(18,2) USING round(vat_amount::numeric, 2);
ALTER TABLE "Expense" ALTER COLUMN amount TYPE DECIMAL(18,2) USING round(amount::numeric, 2);

COMMIT;
