-- Categorical enums, pseudonymous analytics ids, encrypted-ID columns,
-- retention markers and the export audit log.
--
-- Written by hand. `prisma migrate diff` renders the String -> enum changes as
-- DROP COLUMN + ADD COLUMN, which silently discards every existing value. Each
-- conversion below uses ALTER ... TYPE ... USING so the current data is mapped
-- across instead, including the Arabic literals that some columns hold.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "AttendanceType" AS ENUM ('REGULAR', 'PART_TIME', 'SHIFTS', 'TEMPORARY');
CREATE TYPE "AcademicStage" AS ENUM ('NURSERY', 'KG1', 'KG2', 'KG3');
CREATE TYPE "ClassGroup" AS ENUM ('NURSERY', 'KG1', 'KG2', 'KG3');
CREATE TYPE "PaymentCycleStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "AdminInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- PaymentStatus exists in the baseline but is missing PENDING, the state the
-- enrolment flow was writing as the Arabic literal 'بانتظار الدفع'.
--
-- Built as a new type and swapped rather than `ALTER TYPE ... ADD VALUE`:
-- Postgres refuses to *use* a value added in the same transaction, and issuing
-- COMMIT here to work around that would end the transaction Prisma wraps the
-- migration in — leaving it half applied and unrecoverable. The old type is
-- referenced by nothing but a column default, so the swap is safe.
CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'PAID', 'LATE', 'SUSPENDED', 'CANCELLED');

-- ─── Student.paymentStatus ───────────────────────────────────────────────────
-- Held a mix of English ('PAID', 'LATE', 'SUSPENDED', 'CANCELLED') and the
-- Arabic literal 'بانتظار الدفع'.

ALTER TABLE "Student" ALTER COLUMN "paymentStatus" DROP DEFAULT;

ALTER TABLE "Student"
  ALTER COLUMN "paymentStatus" TYPE "PaymentStatus_new"
  USING (
    CASE TRIM("paymentStatus")
      WHEN 'PAID'          THEN 'PAID'
      WHEN 'LATE'          THEN 'LATE'
      WHEN 'SUSPENDED'     THEN 'SUSPENDED'
      WHEN 'CANCELLED'     THEN 'CANCELLED'
      WHEN 'PENDING'       THEN 'PENDING'
      WHEN 'بانتظار الدفع' THEN 'PENDING'
      WHEN 'مدفوع'         THEN 'PAID'
      WHEN 'متأخر'         THEN 'LATE'
      WHEN 'موقوف'         THEN 'SUSPENDED'
      WHEN 'موقف'          THEN 'SUSPENDED'
      WHEN 'ملغي'          THEN 'CANCELLED'
      ELSE 'PENDING'
    END
  )::"PaymentStatus_new";

-- Retire the old type and take its name, so the schema keeps calling it
-- PaymentStatus. IF EXISTS because the type is only present on databases
-- created from the baseline.
DROP TYPE IF EXISTS "PaymentStatus";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";

-- Was 'PAID', which booked a brand-new child as having already paid.
ALTER TABLE "Student" ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING';

-- ─── Student.attendanceType ──────────────────────────────────────────────────

ALTER TABLE "Student" ALTER COLUMN "attendanceType" DROP DEFAULT;

ALTER TABLE "Student"
  ALTER COLUMN "attendanceType" TYPE "AttendanceType"
  USING (
    CASE TRIM("attendanceType")
      WHEN 'دوام منتظم'  THEN 'REGULAR'
      WHEN 'منتظم'       THEN 'REGULAR'
      WHEN 'دوام جزئي'   THEN 'PART_TIME'
      WHEN 'جزئي'        THEN 'PART_TIME'
      -- Present in live rows; kept distinct rather than folded into PART_TIME.
      WHEN 'شفتات'       THEN 'SHIFTS'
      WHEN 'دوام شفتات'  THEN 'SHIFTS'
      WHEN 'دوام مؤقت'   THEN 'TEMPORARY'
      WHEN 'مؤقت'        THEN 'TEMPORARY'
      WHEN 'REGULAR'     THEN 'REGULAR'
      WHEN 'PART_TIME'   THEN 'PART_TIME'
      WHEN 'SHIFTS'      THEN 'SHIFTS'
      WHEN 'TEMPORARY'   THEN 'TEMPORARY'
      ELSE 'REGULAR'
    END
  )::"AttendanceType";

ALTER TABLE "Student" ALTER COLUMN "attendanceType" SET DEFAULT 'REGULAR';

-- ─── Student.academicStage ───────────────────────────────────────────────────
-- Free text, so live rows hold several spellings of the same stage
-- ('كي جي 1', 'كيجي 2', 'الحضانة', 'الروضة'). All are mapped; anything still
-- unrecognised becomes NULL rather than a wrong guess.

ALTER TABLE "Student"
  ALTER COLUMN "academicStage" TYPE "AcademicStage"
  USING (
    CASE LOWER(TRIM(COALESCE("academicStage", '')))
      WHEN 'nursery'     THEN 'NURSERY'
      WHEN 'حضانة'       THEN 'NURSERY'
      WHEN 'الحضانة'     THEN 'NURSERY'
      WHEN 'kg1'         THEN 'KG1'
      WHEN 'كي جي 1'     THEN 'KG1'
      WHEN 'كيجي 1'      THEN 'KG1'
      WHEN 'روضة أولى'   THEN 'KG1'
      WHEN 'الروضة'      THEN 'KG1'
      WHEN 'kg2'         THEN 'KG2'
      WHEN 'كي جي 2'     THEN 'KG2'
      WHEN 'كيجي 2'      THEN 'KG2'
      WHEN 'روضة ثانية'  THEN 'KG2'
      WHEN 'kg3'         THEN 'KG3'
      WHEN 'كي جي 3'     THEN 'KG3'
      WHEN 'كيجي 3'      THEN 'KG3'
      WHEN 'تمهيدي'      THEN 'KG3'
      ELSE NULL
    END
  )::"AcademicStage";

-- ─── Class.group and Activity.group ──────────────────────────────────────────

ALTER TABLE "Class" ALTER COLUMN "group" DROP DEFAULT;
ALTER TABLE "Class"
  ALTER COLUMN "group" TYPE "ClassGroup"
  USING (
    CASE LOWER(TRIM("group"))
      WHEN 'nursery' THEN 'NURSERY'
      WHEN 'حضانة'   THEN 'NURSERY'
      WHEN 'kg1'     THEN 'KG1'
      WHEN 'kg2'     THEN 'KG2'
      WHEN 'kg3'     THEN 'KG3'
      ELSE 'KG1'
    END
  )::"ClassGroup";
ALTER TABLE "Class" ALTER COLUMN "group" SET DEFAULT 'KG1';

ALTER TABLE "Activity" ALTER COLUMN "group" DROP DEFAULT;
ALTER TABLE "Activity"
  ALTER COLUMN "group" TYPE "ClassGroup"
  USING (
    CASE LOWER(TRIM("group"))
      WHEN 'nursery' THEN 'NURSERY'
      WHEN 'حضانة'   THEN 'NURSERY'
      WHEN 'kg1'     THEN 'KG1'
      WHEN 'kg2'     THEN 'KG2'
      WHEN 'kg3'     THEN 'KG3'
      ELSE 'KG1'
    END
  )::"ClassGroup";
ALTER TABLE "Activity" ALTER COLUMN "group" SET DEFAULT 'KG1';

-- ─── PaymentCycle.status ─────────────────────────────────────────────────────
-- 'موقف' is preserved as SUSPENDED rather than folded into OVERDUE: the two
-- mean different things to the collection figures.

ALTER TABLE "PaymentCycle" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "PaymentCycle"
  ALTER COLUMN "status" TYPE "PaymentCycleStatus"
  USING (
    CASE TRIM("status")
      WHEN 'بانتظار الدفع' THEN 'PENDING'
      WHEN 'مدفوع'         THEN 'PAID'
      WHEN 'متأخر'         THEN 'OVERDUE'
      WHEN 'موقف'          THEN 'SUSPENDED'
      WHEN 'موقوف'         THEN 'SUSPENDED'
      WHEN 'ملغي'          THEN 'CANCELLED'
      ELSE 'PENDING'
    END
  )::"PaymentCycleStatus";

ALTER TABLE "PaymentCycle" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─── AdminInvoice.status ─────────────────────────────────────────────────────

ALTER TABLE "AdminInvoice" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "AdminInvoice"
  ALTER COLUMN "status" TYPE "AdminInvoiceStatus"
  USING (
    CASE TRIM("status")
      WHEN 'بانتظار الدفع' THEN 'PENDING'
      WHEN 'مدفوع'         THEN 'PAID'
      WHEN 'متأخر'         THEN 'OVERDUE'
      WHEN 'ملغي'          THEN 'CANCELLED'
      ELSE 'PENDING'
    END
  )::"AdminInvoiceStatus";

ALTER TABLE "AdminInvoice" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─── Pseudonymous analytics identifiers ──────────────────────────────────────
-- Added WITH a default so existing rows are backfilled in place; without it the
-- NOT NULL constraint would fail on every current row.

ALTER TABLE "School"  ADD COLUMN "analyticsId" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT;
ALTER TABLE "Student" ADD COLUMN "analyticsId" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT;
ALTER TABLE "Teacher" ADD COLUMN "analyticsId" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT;

CREATE UNIQUE INDEX "School_analyticsId_key"  ON "School"("analyticsId");
CREATE UNIQUE INDEX "Student_analyticsId_key" ON "Student"("analyticsId");
CREATE UNIQUE INDEX "Teacher_analyticsId_key" ON "Teacher"("analyticsId");

-- ─── Encrypted national ID ───────────────────────────────────────────────────
-- The plaintext `idNumber` column stays for now so the application can migrate
-- values in the background; it is dropped in a later migration once empty.

ALTER TABLE "Student" ADD COLUMN "encryptedIdNumber" TEXT;
ALTER TABLE "Student" ADD COLUMN "idNumberHash" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "encryptedIdNumber" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "idNumberHash" TEXT;

CREATE INDEX "Student_schoolId_idNumberHash_idx" ON "Student"("schoolId", "idNumberHash");
CREATE INDEX "Teacher_schoolId_idNumberHash_idx" ON "Teacher"("schoolId", "idNumberHash");

-- ─── Retention markers ───────────────────────────────────────────────────────

ALTER TABLE "Student" ADD COLUMN "retentionUntil" TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

CREATE INDEX "Student_retentionUntil_idx" ON "Student"("retentionUntil");

-- ─── Export audit log ────────────────────────────────────────────────────────

CREATE TABLE "ExportAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "exportedEntity" TEXT NOT NULL,
    "exportFormat" TEXT NOT NULL DEFAULT 'excel',
    "filters" JSONB,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExportAuditLog_schoolId_exportedAt_idx" ON "ExportAuditLog"("schoolId", "exportedAt");
CREATE INDEX "ExportAuditLog_exportedEntity_idx" ON "ExportAuditLog"("exportedEntity");

ALTER TABLE "ExportAuditLog"
  ADD CONSTRAINT "ExportAuditLog_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
