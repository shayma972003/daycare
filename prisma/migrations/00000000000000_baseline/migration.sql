-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Period" AS ENUM ('MORNING', 'EVENING');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'LATE', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('STUDENT', 'TEACHER');

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "max_students" INTEGER NOT NULL,
    "max_classes" INTEGER NOT NULL,
    "max_whatsapp_per_month" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMessage" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'both',
    "target_type" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "is_automated" BOOLEAN NOT NULL DEFAULT false,
    "template_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMessageRecipient" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "AdminMessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomatedAlertRule" (
    "id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "threshold_days" INTEGER,
    "message_subject" TEXT NOT NULL,
    "message_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomatedAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminActivityLog" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "performed_by" TEXT NOT NULL DEFAULT 'system',
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "logoUrl" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teacherCheckinTime" TEXT,
    "teacherCheckoutTime" TEXT,
    "studentCheckinTime" TEXT,
    "studentCheckoutTime" TEXT,
    "commercialRegistration" TEXT,
    "vatNumber" TEXT,
    "contactNumber" TEXT,
    "address" TEXT,
    "phoneNumber" TEXT,
    "twoFaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFaPhone" TEXT,
    "attendanceToken" TEXT,
    "attendanceTokenCreatedAt" TIMESTAMP(3),
    "legalName" TEXT,
    "nationalUnifiedNumber" TEXT,
    "entityType" TEXT,
    "businessActivities" TEXT,
    "schoolType" TEXT,
    "educationStages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenseNumber" TEXT,
    "branch" TEXT,
    "vatRegistered" BOOLEAN,
    "zatcaUnifiedNumber" TEXT,
    "zakatStatus" TEXT,
    "financialYear" TEXT,
    "taxPeriod" TEXT,
    "plan_id" TEXT,
    "subscription_status" TEXT NOT NULL DEFAULT 'active',
    "renewal_date" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCycle" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'بانتظار الدفع',
    "cycle_number" INTEGER NOT NULL,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "entity_name" TEXT,
    "performed_by" TEXT NOT NULL,
    "ip_address" TEXT,
    "device_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminInvoice" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "subscription_type" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'متأخر',
    "payment_method" TEXT,
    "our_company_name" TEXT,
    "our_commercial_reg" TEXT,
    "our_vat_number" TEXT,
    "our_contact_number" TEXT,
    "our_email" TEXT,
    "our_address" TEXT,
    "school_name" TEXT NOT NULL,
    "school_commercial_reg" TEXT,
    "school_vat_number" TEXT,
    "school_contact" TEXT,
    "school_email" TEXT,
    "school_address" TEXT,
    "line_items" JSONB NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFASession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "otpCodeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "bypassTokenHash" TEXT,
    "bypassExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resendCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TwoFASession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hourlyLateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyStudentFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyStudentFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reminderTemplate" TEXT NOT NULL DEFAULT 'مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <amount_due> ريال تستحق بتاريخ <due_date>. مع تحيات <school_name>',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT,
    "group" TEXT NOT NULL DEFAULT 'kg1',
    "period" "Period" NOT NULL DEFAULT 'MORNING',
    "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "imageUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "needsTeacherWarning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "period" "Period" NOT NULL DEFAULT 'MORNING',
    "idNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "email" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "joinDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrollmentEndDate" TIMESTAMP(3),
    "monthlySalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateDeductionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualification1" TEXT,
    "qualification2" TEXT,
    "qualification3" TEXT,
    "qualification4" TEXT,
    "qualification5" TEXT,
    "qualification6" TEXT,
    "qualification7" TEXT,
    "qualification8" TEXT,
    "qualification9" TEXT,
    "qualification10" TEXT,
    "attendanceHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone1" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "name_2" TEXT,
    "phone_3" TEXT,
    "phone_4" TEXT,
    "email_2" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT,
    "guardianId" TEXT,
    "healthCondition" TEXT,
    "academicStage" TEXT,
    "period" "Period" NOT NULL DEFAULT 'MORNING',
    "idNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allergies" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "enrollmentEndDate" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
    "attendanceHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attendanceType" TEXT NOT NULL DEFAULT 'دوام منتظم',
    "registration_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalFile" TEXT,
    "evaluationFileUrl" TEXT,
    "evaluationFileName" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "needsClassWarning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enrollment_date" TIMESTAMP(3),
    "payment_notified_at" TIMESTAMP(3),
    "suspension_notified_at" TIMESTAMP(3),
    "auto_status_updated_at" TIMESTAMP(3),

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT,
    "group" TEXT NOT NULL DEFAULT 'kg1',
    "period" "Period" NOT NULL DEFAULT 'MORNING',
    "childrenCount" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "activityFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "message" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityInvite" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "schoolId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAttendance" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "requiredHours" DOUBLE PRECISION,
    "compensated" BOOLEAN NOT NULL DEFAULT false,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "vat_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pdfUrl" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SENT',
    "source" TEXT NOT NULL DEFAULT 'other',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyExpense" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "rent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maintenance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materials" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "misc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialReport" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_guardians_reused" INTEGER NOT NULL DEFAULT 0,
    "column_mapping" JSONB,
    "original_headers" JSONB,
    "file_language" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "mapped_data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errors" JSONB,
    "warnings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentToken" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sent_to_phone" TEXT NOT NULL,
    "sent_to_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "otp_code_hash" TEXT,
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "otp_resend_count" INTEGER NOT NULL DEFAULT 0,
    "otp_last_sent_at" TIMESTAMP(3),
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "otp_expires_at" TIMESTAMP(3),
    "device_fingerprint" TEXT,
    "submissions_count" INTEGER NOT NULL DEFAULT 0,
    "max_submissions" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentSubmission" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "full_name" TEXT NOT NULL,
    "id_number" TEXT,
    "nationality" TEXT,
    "academic_stage" TEXT,
    "gender" TEXT,
    "period" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "health_condition" TEXT,
    "allergies" TEXT,
    "attendance_type" TEXT,
    "payment_method" TEXT,
    "guardian_name" TEXT,
    "guardian_phone_1" TEXT,
    "guardian_phone_2" TEXT,
    "guardian_email" TEXT,
    "guardian_name_2" TEXT,
    "guardian_phone_3" TEXT,
    "guardian_phone_4" TEXT,
    "guardian_email_2" TEXT,
    "enrollment_date" TIMESTAMP(3),
    "evaluation_file_url" TEXT,
    "evaluation_file_name" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "student_id" TEXT,

    CONSTRAINT "EnrollmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "School_attendanceToken_key" ON "School"("attendanceToken");

-- CreateIndex
CREATE INDEX "PaymentCycle_school_id_due_date_idx" ON "PaymentCycle"("school_id", "due_date");

-- CreateIndex
CREATE INDEX "PaymentCycle_student_id_idx" ON "PaymentCycle"("student_id");

-- CreateIndex
CREATE INDEX "ActivityLog_school_id_created_at_idx" ON "ActivityLog"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "TwoFASession_bypassTokenHash_idx" ON "TwoFASession"("bypassTokenHash");

-- CreateIndex
CREATE INDEX "TwoFASession_expiresAt_idx" ON "TwoFASession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_schoolId_key" ON "Settings"("schoolId");

-- CreateIndex
CREATE INDEX "Class_schoolId_deletedAt_idx" ON "Class"("schoolId", "deletedAt");

-- CreateIndex
CREATE INDEX "Class_teacherId_idx" ON "Class"("teacherId");

-- CreateIndex
CREATE INDEX "Teacher_schoolId_deletedAt_idx" ON "Teacher"("schoolId", "deletedAt");

-- CreateIndex
CREATE INDEX "Guardian_schoolId_deletedAt_idx" ON "Guardian"("schoolId", "deletedAt");

-- CreateIndex
CREATE INDEX "Guardian_schoolId_phone1_idx" ON "Guardian"("schoolId", "phone1");

-- CreateIndex
CREATE INDEX "Student_schoolId_deletedAt_idx" ON "Student"("schoolId", "deletedAt");

-- CreateIndex
CREATE INDEX "Student_schoolId_isActive_idx" ON "Student"("schoolId", "isActive");

-- CreateIndex
CREATE INDEX "Student_classId_idx" ON "Student"("classId");

-- CreateIndex
CREATE INDEX "Student_guardianId_idx" ON "Student"("guardianId");

-- CreateIndex
CREATE INDEX "Activity_schoolId_idx" ON "Activity"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityInvite_activityId_classId_key" ON "ActivityInvite"("activityId", "classId");

-- CreateIndex
CREATE INDEX "Attendance_schoolId_date_idx" ON "Attendance"("schoolId", "date");

-- CreateIndex
CREATE INDEX "Attendance_classId_date_idx" ON "Attendance"("classId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_studentId_date_key" ON "Attendance"("studentId", "date");

-- CreateIndex
CREATE INDEX "TeacherAttendance_schoolId_date_idx" ON "TeacherAttendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAttendance_teacherId_date_key" ON "TeacherAttendance"("teacherId", "date");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_createdAt_idx" ON "Invoice"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_studentId_idx" ON "Invoice"("studentId");

-- CreateIndex
CREATE INDEX "Invoice_teacherId_idx" ON "Invoice"("teacherId");

-- CreateIndex
CREATE INDEX "NotificationLog_schoolId_sentAt_idx" ON "NotificationLog"("schoolId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyExpense_schoolId_month_year_key" ON "MonthlyExpense"("schoolId", "month", "year");

-- CreateIndex
CREATE INDEX "Expense_school_id_is_active_idx" ON "Expense"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentToken_token_key" ON "EnrollmentToken"("token");

-- CreateIndex
CREATE INDEX "EnrollmentToken_school_id_status_idx" ON "EnrollmentToken"("school_id", "status");

-- CreateIndex
CREATE INDEX "EnrollmentToken_expires_at_idx" ON "EnrollmentToken"("expires_at");

-- CreateIndex
CREATE INDEX "EnrollmentSubmission_school_id_status_idx" ON "EnrollmentSubmission"("school_id", "status");

-- AddForeignKey
ALTER TABLE "AdminMessageRecipient" ADD CONSTRAINT "AdminMessageRecipient_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "AdminMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMessageRecipient" ADD CONSTRAINT "AdminMessageRecipient_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActivityLog" ADD CONSTRAINT "AdminActivityLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCycle" ADD CONSTRAINT "PaymentCycle_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCycle" ADD CONSTRAINT "PaymentCycle_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminInvoice" ADD CONSTRAINT "AdminInvoice_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFASession" ADD CONSTRAINT "TwoFASession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInvite" ADD CONSTRAINT "ActivityInvite_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityInvite" ADD CONSTRAINT "ActivityInvite_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyExpense" ADD CONSTRAINT "MonthlyExpense_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentSubmission" ADD CONSTRAINT "EnrollmentSubmission_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "EnrollmentToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentSubmission" ADD CONSTRAINT "EnrollmentSubmission_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
