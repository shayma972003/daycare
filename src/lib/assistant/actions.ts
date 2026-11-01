import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ASSIGNABLE_ROLE_KEYS, grants } from "@/lib/permissions";
import {
  addDateDays,
  calendarToday,
  storedDate,
  validTimeZone,
  zonedTimeOnDate,
} from "@/lib/device-date";
import {
  AttendanceOperationError,
  checkInStudent,
  checkInTeacher,
  checkoutStudent,
  checkoutTeacher,
} from "@/lib/attendance-operations";
import { notifyGuardiansOfAttendance } from "@/lib/attendance-notifications";
import { scopedClassIds, studentClassWhere } from "@/lib/student-access-scope";
import { logSafeError } from "@/lib/safe-logger";
import { logAction } from "@/lib/activity-logger";
import { consumeAssistantApproval, issueAssistantApproval } from "@/lib/assistant/action-approval";
import { syncExpenseOccurrence } from "@/lib/expense-occurrences";
import { sendNotification } from "@/lib/notifications";
import { buildMessageVars } from "@/lib/message-variables";
import { moneyNumber } from "@/lib/money";
import { scheduleFor } from "@/lib/school-schedule";
import { rateLimit } from "@/lib/rate-limit";
import { assertClassCapacity, PlanLimitError } from "@/lib/plan-limits";
import { enqueuePush, type PushTarget } from "@/lib/push";
import { assertStudentCapacity } from "@/lib/plan-limits";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import {
  requireStudentCycleFee,
  StudentCycleFeeError,
  studentFeeSettingsSelect,
} from "@/lib/student-cycle-fee";
import { buildStudentDeparture, getRetentionPolicy } from "@/lib/data-retention";
import { renewStudentSubscription, RenewalError } from "@/lib/student-renewal";
import { normalizePhone } from "@/lib/phone-normalizer";

const attendanceProposalSchema = z.object({
  kind: z.literal("attendance"),
  subject: z.enum(["student", "staff"]),
  operation: z.enum(["checkin", "checkout"]),
  name: z.string().trim().min(2).max(120),
}).strict();

const calendarProposalSchema = z.object({
  kind: z.literal("calendar_create"),
  type: z.enum(["LESSON", "ACTIVITY", "ANNOUNCEMENT", "UNIT"]),
  title: z.string().trim().min(1).max(200),
  date: z.iso.date(),
  allDay: z.boolean(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  className: z.string().trim().min(1).max(120).optional(),
  staffName: z.string().trim().min(2).max(120).optional(),
}).strict();

const expenseCreateProposalSchema = z.object({
  kind: z.literal("expense_create"),
  title: z.string().trim().min(1).max(160),
  amount: z.number().finite().positive().max(10_000_000),
  type: z.enum(["one_time", "monthly"]),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  description: z.string().trim().max(500).optional(),
}).strict();

const expenseStatusProposalSchema = z.object({
  kind: z.literal("expense_status"),
  title: z.string().trim().min(1).max(160),
  dueDate: z.iso.date(),
  status: z.enum(["PENDING", "PAID"]),
}).strict();

const paymentReminderProposalSchema = z.object({
  kind: z.literal("payment_reminder"),
  studentName: z.string().trim().min(2).max(120),
}).strict();

const carePolicyProposalSchema = z.object({
  kind: z.literal("care_policy"),
  reviewRequired: z.boolean(),
}).strict();

const classCreateProposalSchema = z.object({
  kind: z.literal("class_create"),
  name: z.string().trim().min(1).max(120),
  period: z.enum(["MORNING", "EVENING"]),
}).strict();

const restoreProposalSchema = z.object({
  kind: z.literal("restore_record"),
  recordType: z.enum(["student", "staff", "class"]),
  name: z.string().trim().min(2).max(120),
}).strict();

const broadcastProposalSchema = z.object({
  kind: z.literal("broadcast_create"),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2_000),
  date: z.iso.date(),
  audience: z.enum(["guardians", "staff", "both"]),
}).strict();

const studentCreateProposalSchema = z.object({
  kind: z.literal("student_create"),
  name: z.string().trim().min(2).max(120),
  className: z.string().trim().min(1).max(120).optional(),
  guardianName: z.string().trim().min(2).max(120).optional(),
  guardianPhone: z.string().trim().min(7).max(20).optional(),
}).strict();

const studentRenameProposalSchema = z.object({
  kind: z.literal("student_rename"),
  currentName: z.string().trim().min(2).max(120),
  newName: z.string().trim().min(2).max(120),
}).strict();

const namedStudentFields = {
  studentName: z.string().trim().min(2).max(120),
};
const studentArchiveProposalSchema = z.object({ kind: z.literal("student_archive"), ...namedStudentFields }).strict();
const studentRenewProposalSchema = z.object({ kind: z.literal("student_subscription_renew"), ...namedStudentFields }).strict();
const studentCancelProposalSchema = z.object({ kind: z.literal("student_subscription_cancel"), ...namedStudentFields }).strict();
const studentReactivateProposalSchema = z.object({ kind: z.literal("student_reactivate"), ...namedStudentFields }).strict();

const studentMoveProposalSchema = z.object({
  kind: z.literal("student_move_class"),
  studentName: z.string().trim().min(2).max(120),
  className: z.string().trim().min(1).max(120),
}).strict();

const guardianLinkProposalSchema = z.object({
  kind: z.literal("guardian_link"),
  studentName: z.string().trim().min(2).max(120),
  guardianName: z.string().trim().min(2).max(120),
  guardianPhone: z.string().trim().min(7).max(20).optional(),
  makePrimary: z.boolean().default(false),
}).strict();

const staffCreateProposalSchema = z.object({
  kind: z.literal("staff_create"), name: z.string().trim().min(2).max(120),
  period: z.enum(["MORNING", "EVENING"]).default("MORNING"),
}).strict();
const staffRenameProposalSchema = z.object({
  kind: z.literal("staff_rename"), currentName: z.string().trim().min(2).max(120),
  newName: z.string().trim().min(2).max(120),
}).strict();
const staffArchiveProposalSchema = z.object({
  kind: z.literal("staff_archive"), staffName: z.string().trim().min(2).max(120),
}).strict();
const staffAssignClassProposalSchema = z.object({
  kind: z.literal("staff_assign_class"), staffName: z.string().trim().min(2).max(120),
  className: z.string().trim().min(1).max(120),
}).strict();
const shiftSaveProposalSchema = z.object({
  kind: z.literal("shift_save"), staffName: z.string().trim().min(2).max(120),
  date: z.iso.date(), startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  className: z.string().trim().min(1).max(120).optional(), updateExisting: z.boolean().default(false),
}).strict();
const staffAccountProposalSchema = z.object({
  kind: z.literal("staff_account"), action: z.enum(["create", "resend", "disable", "enable"]),
  staffName: z.string().trim().min(2).max(120), email: z.string().email().optional(),
  roleName: z.string().trim().min(1).max(80).optional(),
}).strict();
const classUpdateProposalSchema = z.object({
  kind: z.literal("class_update"), className: z.string().trim().min(1).max(120),
  newName: z.string().trim().min(1).max(120).optional(), capacity: z.number().int().min(0).max(500).optional(),
  stageName: z.string().trim().min(1).max(120).optional(),
}).strict().refine((value) => value.newName !== undefined || value.capacity !== undefined || value.stageName !== undefined);
const classMembershipProposalSchema = z.object({
  kind: z.literal("class_membership"), action: z.enum(["add", "remove"]), subject: z.enum(["student", "staff"]),
  name: z.string().trim().min(2).max(120), className: z.string().trim().min(1).max(120),
}).strict();
const classArchiveProposalSchema = z.object({ kind: z.literal("class_archive"), className: z.string().trim().min(1).max(120) }).strict();
const restoreAllProposalSchema = z.object({ kind: z.literal("restore_all"), recordType: z.enum(["student", "staff", "class"]) }).strict();

const calendarUpdateProposalSchema = z.object({
  kind: z.literal("calendar_update"), title: z.string().trim().min(1).max(200),
  newTitle: z.string().trim().min(1).max(200).optional(), date: z.iso.date().optional(),
  className: z.string().trim().min(1).max(120).optional(), staffName: z.string().trim().min(2).max(120).optional(),
}).strict().refine((value) => value.newTitle !== undefined || value.date !== undefined || value.className !== undefined || value.staffName !== undefined);
const calendarDeleteProposalSchema = z.object({ kind: z.literal("calendar_delete"), title: z.string().trim().min(1).max(200) }).strict();
const unitCreateProposalSchema = z.object({ kind: z.literal("unit_create"), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), className: z.string().trim().min(1).max(120).optional() }).strict();
const lessonCreateProposalSchema = z.object({ kind: z.literal("lesson_create"), unitName: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).optional() }).strict();
const activityCreateProposalSchema = z.object({ kind: z.literal("activity_create"), name: z.string().trim().min(1).max(200), startDate: z.iso.date(), endDate: z.iso.date(), className: z.string().trim().min(1).max(120).optional(), message: z.string().trim().max(2000).optional() }).strict();
const activitySendProposalSchema = z.object({ kind: z.literal("activity_send"), activityName: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(2000).optional(), audience: z.enum(["guardians", "staff", "both"]).default("both") }).strict();
const unitFileDeleteProposalSchema = z.object({ kind: z.literal("unit_file_delete"), unitName: z.string().trim().min(1).max(200), fileName: z.string().trim().min(1).max(200) }).strict();

const careReviewProposalSchema = z.object({ kind: z.literal("care_review"), studentName: z.string().trim().min(2).max(120), action: z.enum(["approve", "return"]), note: z.string().trim().max(1000).optional() }).strict();
const careEditProposalSchema = z.object({ kind: z.literal("care_edit"), studentName: z.string().trim().min(2).max(120), note: z.string().trim().min(1).max(1000) }).strict();
const careDeleteProposalSchema = z.object({ kind: z.literal("care_delete"), studentName: z.string().trim().min(2).max(120) }).strict();
const careResubmitProposalSchema = z.object({ kind: z.literal("care_resubmit"), studentName: z.string().trim().min(2).max(120) }).strict();

const invoiceCreateProposalSchema = z.object({ kind: z.literal("invoice_create"), subject: z.enum(["student", "staff"]), name: z.string().trim().min(2).max(120) }).strict();
const expenseUpdateProposalSchema = z.object({ kind: z.literal("expense_update"), title: z.string().trim().min(1).max(160), newTitle: z.string().trim().min(1).max(160).optional(), amount: z.number().finite().positive().max(10_000_000).optional(), endDate: z.iso.date().optional() }).strict().refine((value) => value.newTitle !== undefined || value.amount !== undefined || value.endDate !== undefined);
const expenseStopProposalSchema = z.object({ kind: z.literal("expense_stop"), title: z.string().trim().min(1).max(160) }).strict();
const financialReportProposalSchema = z.object({ kind: z.literal("financial_report"), type: z.enum(["monthly", "semi_annual", "annual"]), periodLabel: z.string().trim().min(1).max(120) }).strict();
const financeOpeningProposalSchema = z.object({ kind: z.literal("finance_opening"), amount: z.number().finite().min(-1_000_000_000).max(1_000_000_000), date: z.iso.date().nullable() }).strict();
const bulkRenewProposalSchema = z.object({ kind: z.literal("bulk_renew"), className: z.string().trim().min(1).max(120).optional() }).strict();
const bulkReminderProposalSchema = z.object({ kind: z.literal("bulk_reminder"), reminderKind: z.enum(["payment", "renewal"]), className: z.string().trim().min(1).max(120).optional() }).strict();

const enrollmentLinkProposalSchema = z.object({ kind: z.literal("enrollment_link"), email: z.string().email() }).strict();
const enrollmentReviewProposalSchema = z.object({ kind: z.literal("enrollment_review"), action: z.enum(["approve", "reject"]), studentName: z.string().trim().min(2).max(120), className: z.string().trim().min(1).max(120).optional() }).strict();
const importConfirmProposalSchema = z.object({ kind: z.literal("import_confirm"), sessionId: z.string().trim().min(8).max(100) }).strict();

const settingsUpdateProposalSchema = z.object({
  kind: z.literal("settings_update"), field: z.enum([
    "hourlyLateFee", "dailyStudentFee", "weeklyStudentFee", "monthlyStudentFee", "yearlyStudentFee",
    "teacherMorningCheckinTime", "teacherMorningCheckoutTime", "teacherEveningCheckinTime", "teacherEveningCheckoutTime",
    "studentMorningCheckinTime", "studentMorningCheckoutTime", "studentEveningCheckinTime", "studentEveningCheckoutTime",
  ]), value: z.union([z.number().finite().min(0).max(1_000_000), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), z.null()]),
}).strict();
const stageManageProposalSchema = z.object({ kind: z.literal("stage_manage"), action: z.enum(["create", "rename", "archive", "restore"]), name: z.string().trim().min(1).max(60), newName: z.string().trim().min(1).max(60).optional() }).strict();
const arrivalRecipientProposalSchema = z.object({ kind: z.literal("arrival_recipient"), action: z.enum(["add", "remove"]), accountName: z.string().trim().min(2).max(120) }).strict();
const schoolInfoProposalSchema = z.object({ kind: z.literal("school_info"), field: z.enum(["name", "contactNumber", "phoneNumber", "address", "commercialRegistration", "vatNumber"]), value: z.string().trim().min(1).max(300) }).strict();
const storageRefreshProposalSchema = z.object({ kind: z.literal("storage_refresh") }).strict();

export const assistantActionProposalSchema = z.discriminatedUnion("kind", [
  attendanceProposalSchema,
  calendarProposalSchema,
  expenseCreateProposalSchema,
  expenseStatusProposalSchema,
  paymentReminderProposalSchema,
  carePolicyProposalSchema,
  classCreateProposalSchema,
  restoreProposalSchema,
  broadcastProposalSchema,
  studentCreateProposalSchema,
  studentRenameProposalSchema,
  studentArchiveProposalSchema,
  studentRenewProposalSchema,
  studentCancelProposalSchema,
  studentReactivateProposalSchema,
  studentMoveProposalSchema,
  guardianLinkProposalSchema,
  staffCreateProposalSchema,
  staffRenameProposalSchema,
  staffArchiveProposalSchema,
  staffAssignClassProposalSchema,
  shiftSaveProposalSchema,
  staffAccountProposalSchema,
  classUpdateProposalSchema,
  classMembershipProposalSchema,
  classArchiveProposalSchema,
  restoreAllProposalSchema,
  calendarUpdateProposalSchema,
  calendarDeleteProposalSchema,
  unitCreateProposalSchema,
  lessonCreateProposalSchema,
  activityCreateProposalSchema,
  activitySendProposalSchema,
  unitFileDeleteProposalSchema,
  careReviewProposalSchema,
  careEditProposalSchema,
  careDeleteProposalSchema,
  careResubmitProposalSchema,
  invoiceCreateProposalSchema,
  expenseUpdateProposalSchema,
  expenseStopProposalSchema,
  financialReportProposalSchema,
  financeOpeningProposalSchema,
  bulkRenewProposalSchema,
  bulkReminderProposalSchema,
  enrollmentLinkProposalSchema,
  enrollmentReviewProposalSchema,
  importConfirmProposalSchema,
  settingsUpdateProposalSchema,
  stageManageProposalSchema,
  arrivalRecipientProposalSchema,
  schoolInfoProposalSchema,
  storageRefreshProposalSchema,
]);
export type AssistantActionProposalInput = z.infer<typeof assistantActionProposalSchema>;

const studentAttendanceArgs = z.object({
  subjectId: z.string().min(1),
  operation: z.enum(["checkin", "checkout"]),
}).strict();

const staffAttendanceArgs = studentAttendanceArgs;

const calendarCreateArgs = z.object({
  type: z.enum(["LESSON", "ACTIVITY", "ANNOUNCEMENT", "UNIT"]),
  title: z.string().min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable(),
  allDay: z.boolean(),
  classId: z.string().nullable(),
  teacherId: z.string().nullable(),
}).strict();

const expenseCreateArgs = z.object({
  title: z.string().min(1).max(160),
  amount: z.number().finite().positive().max(10_000_000),
  type: z.enum(["one_time", "monthly"]),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  description: z.string().max(500).nullable(),
}).strict();

const expenseStatusArgs = z.object({
  occurrenceId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  status: z.enum(["PENDING", "PAID"]),
}).strict();

const paymentReminderArgs = z.object({ studentId: z.string().min(1) }).strict();
const carePolicyArgs = z.object({ reviewRequired: z.boolean() }).strict();
const classCreateArgs = z.object({
  name: z.string().min(1).max(120),
  period: z.enum(["MORNING", "EVENING"]),
}).strict();
const restoreArgs = z.object({
  recordType: z.enum(["student", "staff", "class"]),
  recordId: z.string().min(1),
}).strict();
const broadcastArgs = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2_000),
  date: z.iso.date(),
  audience: z.enum(["guardians", "staff", "both"]),
}).strict();
const studentCreateArgs = z.object({
  name: z.string().min(2).max(120),
  classId: z.string().nullable(),
  guardianName: z.string().min(2).max(120).nullable(),
  guardianPhone: z.string().max(20).nullable(),
}).strict();
const studentRenameArgs = z.object({
  studentId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  newName: z.string().min(2).max(120),
}).strict();
const studentLifecycleArgs = z.object({
  studentId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
const studentMoveArgs = z.object({
  studentId: z.string().min(1),
  classId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
const guardianLinkArgs = z.object({
  studentId: z.string().min(1),
  guardianId: z.string().nullable(),
  guardianName: z.string().min(2).max(120),
  guardianPhone: z.string().max(20).nullable(),
  makePrimary: z.boolean(),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
const staffCreateArgs = z.object({ name: z.string().min(2).max(120), period: z.enum(["MORNING", "EVENING"]) }).strict();
const namedRecordArgs = z.object({ id: z.string().min(1), name: z.string().min(1), expectedUpdatedAt: z.string().datetime().optional() }).strict();
const staffRenameArgs = namedRecordArgs.extend({ newName: z.string().min(2).max(120) }).strict();
const staffAssignClassArgs = z.object({ staffId: z.string().min(1), staffName: z.string(), classId: z.string().min(1), className: z.string(), expectedUpdatedAt: z.string().datetime() }).strict();
const shiftSaveArgs = z.object({ shiftId: z.string().nullable(), staffId: z.string(), staffName: z.string(), classId: z.string().nullable(), date: z.iso.date(), startTime: z.string(), endTime: z.string() }).strict();
const staffAccountArgs = z.object({ action: z.enum(["create", "resend", "disable", "enable"]), userId: z.string().nullable(), staffId: z.string(), staffName: z.string(), email: z.string().email().nullable(), roleId: z.string().nullable() }).strict();
const classUpdateArgs = z.object({ classId: z.string(), className: z.string(), expectedUpdatedAt: z.string().datetime(), newName: z.string().nullable(), capacity: z.number().int().min(0).max(500).nullable(), stageId: z.string().nullable(), updateStage: z.boolean() }).strict();
const classMembershipArgs = z.object({ action: z.enum(["add", "remove"]), subject: z.enum(["student", "staff"]), recordId: z.string(), recordName: z.string(), classId: z.string(), className: z.string(), expectedUpdatedAt: z.string().datetime() }).strict();
const classArchiveArgs = z.object({ classId: z.string(), className: z.string(), expectedUpdatedAt: z.string().datetime() }).strict();
const restoreAllArgs = z.object({ recordType: z.enum(["student", "staff", "class"]) }).strict();
const calendarUpdateArgs = z.object({ eventId: z.string(), oldTitle: z.string(), newTitle: z.string().nullable(), startAt: z.string().datetime().nullable(), endAt: z.string().datetime().nullable(), updateTiming: z.boolean(), classId: z.string().nullable(), teacherId: z.string().nullable() }).strict();
const namedIdArgs = z.object({ id: z.string(), name: z.string() }).strict();
const unitCreateArgs = z.object({ name: z.string(), description: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable(), classId: z.string().nullable() }).strict();
const lessonCreateArgs = z.object({ unitId: z.string(), unitName: z.string(), title: z.string(), description: z.string().nullable() }).strict();
const activityCreateArgs = z.object({ name: z.string(), startDate: z.string(), endDate: z.string(), classId: z.string().nullable(), message: z.string().nullable() }).strict();
const activitySendArgs = z.object({ activityId: z.string(), activityName: z.string(), activityVersion: z.string().datetime(), message: z.string(), audience: z.enum(["guardians", "staff", "both"]), schoolWide: z.boolean() }).strict();
const unitFileDeleteArgs = z.object({ unitId: z.string(), unitName: z.string(), fileId: z.string(), fileName: z.string() }).strict();
const careActionArgs = z.object({ reportId: z.string(), studentName: z.string(), batchId: z.string().nullable(), note: z.string().nullable(), reviewAction: z.enum(["approve", "return"]).nullable() }).strict();
const invoiceCreateArgs = z.object({ subject: z.enum(["student", "staff"]), id: z.string(), name: z.string() }).strict();
const expenseUpdateArgs = z.object({ id: z.string(), title: z.string(), newTitle: z.string().nullable(), amount: z.number().nullable(), endDate: z.string().nullable() }).strict();
const financialReportArgs = z.object({ type: z.enum(["monthly", "semi_annual", "annual"]), periodLabel: z.string() }).strict();
const financeOpeningArgs = z.object({ amount: z.number(), date: z.string().nullable() }).strict();
const bulkStudentArgs = z.object({ ids: z.array(z.string()).min(1).max(500), label: z.string(), reminderKind: z.enum(["payment", "renewal"]).nullable() }).strict();
const enrollmentLinkArgs = z.object({ email: z.string().email() }).strict();
const enrollmentReviewArgs = z.object({ submissionId: z.string(), studentName: z.string(), action: z.enum(["approve", "reject"]), classId: z.string().nullable() }).strict();
const importConfirmArgs = z.object({ sessionId: z.string() }).strict();
const settingsUpdateArgs = settingsUpdateProposalSchema.omit({ kind: true });
const stageManageArgs = z.object({ action: z.enum(["create", "rename", "archive", "restore"]), id: z.string().nullable(), name: z.string(), newName: z.string().nullable() }).strict();
const arrivalRecipientArgs = z.object({ action: z.enum(["add", "remove"]), userId: z.string(), accountName: z.string(), currentIds: z.array(z.string()) }).strict();
const schoolInfoArgs = schoolInfoProposalSchema.omit({ kind: true });

export class AssistantActionError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export interface AssistantActionProposal {
  token: string;
  expiresAt: string;
  title: string;
  summary: string;
  tool: string;
}

function attendanceVerb(operation: "checkin" | "checkout") {
  return operation === "checkin" ? "تسجيل الحضور" : "تسجيل الخروج";
}

async function exactStudent(name: string, schoolId: string, session: AuthSession, includeInactive = false) {
  const matches = await prisma.student.findMany({
    where: {
      schoolId,
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true, status: "ACTIVE" as const }),
      ...studentClassWhere(session),
    },
    select: { id: true, name: true, classId: true, updatedAt: true, anonymizedAt: true },
    take: 2,
  });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  const target = matches[0]!;
  if (target.anonymizedAt) throw new AssistantActionError("ANONYMIZED_STUDENT", 409);
  return target;
}

async function exactClass(name: string, schoolId: string) {
  const matches = await prisma.class.findMany({
    where: { schoolId, name: { equals: name, mode: "insensitive" }, deletedAt: null, archivedAt: null },
    select: { id: true, name: true, capacity: true, updatedAt: true, teacherAssignments: { select: { teacherId: true } } },
    take: 2,
  });
  if (matches.length === 0) throw new AssistantActionError("CLASS_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  return matches[0]!;
}

async function exactStaff(name: string, schoolId: string, includeInactive = false) {
  const matches = await prisma.teacher.findMany({
    where: {
      schoolId,
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true, status: "ACTIVE" as const }),
    },
    select: { id: true, name: true, updatedAt: true, anonymizedAt: true },
    take: 2,
  });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  const target = matches[0]!;
  if (target.anonymizedAt) throw new AssistantActionError("ANONYMIZED_STAFF", 409);
  return target;
}

async function exactEvent(title: string, schoolId: string) {
  const matches = await prisma.calendarEvent.findMany({
    where: { schoolId, title: { equals: title, mode: "insensitive" }, deletedAt: null },
    select: { id: true, title: true, startAt: true, endAt: true, allDay: true, teacherId: true, classes: { select: { classId: true } } },
    take: 2,
  });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  return matches[0]!;
}

async function exactUnit(name: string, schoolId: string) {
  const matches = await prisma.unit.findMany({ where: { schoolId, name: { equals: name, mode: "insensitive" }, deletedAt: null }, select: { id: true, name: true }, take: 2 });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  return matches[0]!;
}

async function exactActivity(name: string, schoolId: string) {
  const matches = await prisma.activity.findMany({ where: { schoolId, name: { equals: name, mode: "insensitive" }, isActive: true }, select: { id: true, name: true, message: true, updatedAt: true, activityInvites: { select: { classId: true } } }, take: 2 });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  return matches[0]!;
}

async function latestCareReport(studentName: string, schoolId: string, session: AuthSession) {
  const student = await exactStudent(studentName, schoolId, session, true);
  const report = await prisma.careReport.findFirst({
    where: { schoolId, studentId: student.id, deletedAt: null },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, dailyBatchId: true, reviewStatus: true, occurredAt: true },
  });
  if (!report) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  return { ...report, student };
}

async function exactExpense(title: string, schoolId: string) {
  const matches = await prisma.expense.findMany({ where: { school_id: schoolId, title: { equals: title, mode: "insensitive" }, is_active: true }, select: { id: true, title: true, type: true, amount: true, start_date: true, end_date: true }, take: 2 });
  if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
  return matches[0]!;
}

async function routeResult(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const rawCode = typeof payload.code === "string" ? payload.code : null;
    const rawError = typeof payload.error === "string" ? payload.error : null;
    const code = rawCode ?? (response.status === 404 ? "SUBJECT_NOT_FOUND" : response.status === 403 ? "FORBIDDEN" : rawError ?? "ACTION_FAILED");
    throw new AssistantActionError(code, response.status);
  }
  return payload;
}

function internalJsonRequest(request: Request, body: unknown, timeZone: string, options?: { method?: string; headers?: Record<string, string>; url?: string }): Request {
  const headers = new Headers({ "Content-Type": "application/json", "X-Time-Zone": timeZone, ...options?.headers });
  return new Request(options?.url ?? request.url, { method: options?.method ?? "POST", headers, body: JSON.stringify(body) });
}

export interface AssistantUploadTarget {
  kind: "avatar" | "evaluation" | "unit_file" | "school_logo" | "student_import";
  studentId?: string;
  studentName?: string;
  endpoint: string;
  method: "POST" | "PUT";
  formField: string;
  extraFields?: Record<string, string>;
  accept: string;
  title: string;
  summary: string;
  successMessage: string;
}

export async function prepareAssistantUpload(input: {
  kind: "avatar" | "evaluation" | "unit_file" | "school_logo" | "student_import";
  studentName?: string;
  unitName?: string;
  session: AuthSession;
}): Promise<AssistantUploadTarget> {
  const { kind, studentName, session } = input;
  if (kind === "school_logo") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    return { kind, endpoint: "/api/settings/logo", method: "PUT", formField: "logo", accept: "image/jpeg,image/png,image/webp", title: "رفع شعار المنشأة", summary: "اختاري شعار المنشأة. سيُرفع مباشرة إلى تخزين المنشأة ولن يُرسل إلى نموذج الذكاء الاصطناعي.", successMessage: "تم تحديث شعار المنشأة." };
  }
  if (kind === "student_import") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    return { kind, endpoint: "/api/import/upload", method: "POST", formField: "file", extraFields: { type: "students" }, accept: ".xlsx,.xls,.csv", title: "رفع ملف استيراد الأطفال", summary: "اختاري ملف الاستيراد. سيُرفع مباشرة إلى النظام، ثم راجعي نتيجة التحقق قبل تأكيد الإدخال.", successMessage: "تم رفع ملف الاستيراد. افتحي صفحة الاستيراد لمراجعة نتيجة التحقق قبل التأكيد." };
  }
  if (kind === "unit_file") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (!input.unitName) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    const unit = await exactUnit(input.unitName, session.user.schoolId);
    return { kind, endpoint: `/api/units/${unit.id}/files`, method: "POST", formField: "file", accept: ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png", title: "رفع ملف للوحدة", summary: `اختاري ملفًا لإضافته إلى وحدة «${unit.name}». سيُرفع مباشرة إلى تخزين المنشأة.`, successMessage: `تم رفع الملف إلى وحدة «${unit.name}».` };
  }
  if (!studentName) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
  if (kind === "avatar") {
    if (!grants(session.permissions, "students.manage")) throw new AssistantActionError("FORBIDDEN", 403);
  } else if (!grants(session.permissions, "students.files")) {
    throw new AssistantActionError("FORBIDDEN", 403);
  }
  const student = await exactStudent(studentName, session.user.schoolId, session, true);
  return kind === "avatar"
    ? {
        kind,
        studentId: student.id,
        studentName: student.name,
        endpoint: `/api/students/${student.id}/avatar`,
        method: "POST",
        formField: "file",
        accept: "image/jpeg,image/png,image/webp",
        title: "رفع صورة الطفل",
        summary: `اختاري صورة الطفل «${student.name}». ستُرفع مباشرة إلى تخزين المنشأة ولن تُرسل إلى نموذج الذكاء الاصطناعي.`,
        successMessage: "تم رفع صورة الطفل.",
      }
    : {
        kind,
        studentId: student.id,
        studentName: student.name,
        endpoint: `/api/students/${student.id}/evaluation`,
        method: "POST",
        formField: "file",
        accept: ".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
        title: "رفع ملف تقييم الطفل",
        summary: `اختاري ملف تقييم الطفل «${student.name}». سيبقى الملف خاصًا ويُفتح فقط للمستخدمين المصرح لهم.`,
        successMessage: "تم رفع ملف تقييم الطفل.",
      };
}

export async function prepareAssistantAction(input: {
  proposal: AssistantActionProposalInput;
  session: AuthSession;
  timeZone: string;
}): Promise<AssistantActionProposal> {
  const { proposal, session, timeZone } = input;
  const schoolId = session.user.schoolId;

  if (proposal.kind === "attendance") {
    if (proposal.subject === "student") {
      if (!grants(session.permissions, "attendance.students")) {
        throw new AssistantActionError("FORBIDDEN", 403);
      }
      const matches = await prisma.student.findMany({
        where: {
          schoolId,
          name: { equals: proposal.name, mode: "insensitive" },
          deletedAt: null,
          isActive: true,
          status: "ACTIVE",
          ...studentClassWhere(session),
        },
        select: { id: true, name: true },
        take: 2,
      });
      if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
      const target = matches[0]!;
      const approval = await issueAssistantApproval({
        schoolId,
        userId: session.user.id,
        tool: "student_attendance",
        args: { subjectId: target.id, operation: proposal.operation },
      });
      return {
        token: approval.token,
        expiresAt: approval.expiresAt.toISOString(),
        title: attendanceVerb(proposal.operation),
        summary: `${attendanceVerb(proposal.operation)} للطفل ${target.name}. سيصل إشعار لولي الأمر عند نجاح العملية.`,
        tool: "student_attendance",
      };
    }

    if (!grants(session.permissions, "attendance.staff")) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const matches = await prisma.teacher.findMany({
      where: {
        schoolId,
        name: { equals: proposal.name, mode: "insensitive" },
        deletedAt: null,
        isActive: true,
        status: "ACTIVE",
      },
      select: { id: true, name: true },
      take: 2,
    });
    if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const target = matches[0]!;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "staff_attendance",
      args: { subjectId: target.id, operation: proposal.operation },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: attendanceVerb(proposal.operation),
      summary: `${attendanceVerb(proposal.operation)} للموظف ${target.name}.`,
      tool: "staff_attendance",
    };
  }

  if (proposal.kind === "student_create") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    try {
      await assertStudentCapacity(schoolId);
    } catch (error) {
      if (error instanceof PlanLimitError) throw new AssistantActionError("PLAN_LIMIT", 409);
      throw error;
    }
    const duplicate = await prisma.student.findFirst({
      where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "student_create",
      args: {
        name: proposal.name,
        classId: room?.id ?? null,
        guardianName: proposal.guardianName ?? null,
        guardianPhone: proposal.guardianPhone ? normalizePhone(proposal.guardianPhone) : null,
      },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "إضافة طفل",
      summary: `إضافة الطفل «${proposal.name}»${room ? ` إلى فصل «${room.name}»` : " دون فصل"}${proposal.guardianName ? ` وربطه بولي الأمر «${proposal.guardianName}»` : ""}. ستُستخدم رسوم الاشتراك الشهرية المعتمدة في الإعدادات.`,
      tool: "student_create",
    };
  }

  if (proposal.kind === "student_rename") {
    if (!grants(session.permissions, "students.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const target = await exactStudent(proposal.currentName, schoolId, session, true);
    const duplicate = await prisma.student.findFirst({
      where: { schoolId, name: { equals: proposal.newName, mode: "insensitive" }, deletedAt: null, id: { not: target.id } },
      select: { id: true },
    });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "student_rename",
      args: { studentId: target.id, expectedUpdatedAt: target.updatedAt.toISOString(), newName: proposal.newName },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "تعديل اسم طفل",
      summary: `تغيير اسم الطفل «${target.name}» إلى «${proposal.newName}».`,
      tool: "student_rename",
    };
  }

  if (proposal.kind === "student_move_class") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const [target, room] = await Promise.all([
      exactStudent(proposal.studentName, schoolId, session, true),
      exactClass(proposal.className, schoolId),
    ]);
    if (target.classId === room.id) throw new AssistantActionError("NO_CHANGE", 409);
    const current = await prisma.student.count({ where: { schoolId, classId: room.id, deletedAt: null } });
    const overCapacity = room.capacity !== null && current + 1 > room.capacity;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "student_move_class",
      args: { studentId: target.id, classId: room.id, expectedUpdatedAt: target.updatedAt.toISOString() },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "تعيين الطفل لفصل",
      summary: `نقل الطفل «${target.name}» إلى فصل «${room.name}».${overCapacity ? ` تنبيه: سيصبح عدد الأطفال ${current + 1} بينما السعة المحددة ${room.capacity}.` : ""}`,
      tool: "student_move_class",
    };
  }

  if (proposal.kind === "guardian_link") {
    if (!grants(session.permissions, "students.guardians") && !grants(session.permissions, "students.manage")) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const target = await exactStudent(proposal.studentName, schoolId, session, true);
    const normalizedPhone = proposal.guardianPhone ? normalizePhone(proposal.guardianPhone) : null;
    const guardians = await prisma.guardian.findMany({
      where: {
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        ...(normalizedPhone
          ? { OR: [{ phone1: normalizedPhone }, { name: { equals: proposal.guardianName, mode: "insensitive" } }] }
          : { name: { equals: proposal.guardianName, mode: "insensitive" } }),
      },
      select: { id: true, name: true, phone1: true },
      take: 2,
    });
    if (!normalizedPhone && guardians.length === 0) throw new AssistantActionError("GUARDIAN_PHONE_REQUIRED", 422);
    if (!normalizedPhone && guardians.length > 1) throw new AssistantActionError("AMBIGUOUS_GUARDIAN", 409);
    const existing = guardians.find((guardian) => guardian.phone1 === normalizedPhone) ?? (guardians.length === 1 ? guardians[0] : null);
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "guardian_link",
      args: {
        studentId: target.id,
        guardianId: existing?.id ?? null,
        guardianName: existing?.name ?? proposal.guardianName,
        guardianPhone: existing?.phone1 ?? normalizedPhone,
        makePrimary: proposal.makePrimary,
        expectedUpdatedAt: target.updatedAt.toISOString(),
      },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: existing ? "ربط ولي أمر موجود" : "إضافة وربط ولي أمر",
      summary: `${existing ? "ربط" : "إضافة وربط"} ولي الأمر «${existing?.name ?? proposal.guardianName}» بالطفل «${target.name}»${proposal.makePrimary ? " كولي أمر رئيسي" : ""}.`,
      tool: "guardian_link",
    };
  }

  if (
    proposal.kind === "student_archive" ||
    proposal.kind === "student_subscription_renew" ||
    proposal.kind === "student_subscription_cancel" ||
    proposal.kind === "student_reactivate"
  ) {
    const target = await exactStudent(proposal.studentName, schoolId, session, true);
    const permission = proposal.kind === "student_archive" ? "students.archive" : "students.manage";
    if (!grants(session.permissions, permission)) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.kind === "student_subscription_renew" && !grants(session.permissions, "finance.manage")) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const titles = {
      student_archive: "أرشفة طفل",
      student_subscription_renew: "تجديد اشتراك طفل",
      student_subscription_cancel: "إلغاء اشتراك طفل",
      student_reactivate: "إعادة تفعيل طفل",
    } as const;
    const summaries = {
      student_archive: `نقل الطفل «${target.name}» إلى سلة المحذوفات. يمكن استعادته لاحقًا وفق سياسة السلة.`,
      student_subscription_renew: `تجديد اشتراك الطفل «${target.name}» تلقائيًا حسب دورة الاشتراك الحالية.`,
      student_subscription_cancel: `إلغاء اشتراك الطفل «${target.name}» وتصنيفه كمنسحب مع بدء مدة الاحتفاظ النظامية.`,
      student_reactivate: `إعادة تفعيل الطفل «${target.name}» وإلغاء تاريخ المغادرة ومدة الإتلاف المرتبطة به.`,
    } as const;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: proposal.kind,
      args: { studentId: target.id, expectedUpdatedAt: target.updatedAt.toISOString() },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: titles[proposal.kind],
      summary: summaries[proposal.kind],
      tool: proposal.kind,
    };
  }

  if (proposal.kind === "staff_create") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const duplicate = await prisma.teacher.findFirst({ where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "staff_create", args: { name: proposal.name, period: proposal.period } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إضافة معلم", summary: `إضافة المعلم «${proposal.name}» للفترة ${proposal.period === "MORNING" ? "الصباحية" : "المسائية"}.`, tool: "staff_create" };
  }

  if (proposal.kind === "staff_rename") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const target = await exactStaff(proposal.currentName, schoolId, true);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "staff_rename", args: { id: target.id, name: target.name, expectedUpdatedAt: target.updatedAt.toISOString(), newName: proposal.newName } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل اسم معلم", summary: `تغيير اسم المعلم «${target.name}» إلى «${proposal.newName}».`, tool: "staff_rename" };
  }

  if (proposal.kind === "staff_archive") {
    if (!grants(session.permissions, "staff.archive")) throw new AssistantActionError("FORBIDDEN", 403);
    const target = await exactStaff(proposal.staffName, schoolId, true);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "staff_archive", args: { id: target.id, name: target.name, expectedUpdatedAt: target.updatedAt.toISOString() } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "أرشفة معلم", summary: `نقل المعلم «${target.name}» إلى سلة المحذوفات وإزالته من الفصول المرتبطة.`, tool: "staff_archive" };
  }

  if (proposal.kind === "staff_assign_class") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const [staff, room] = await Promise.all([exactStaff(proposal.staffName, schoolId), exactClass(proposal.className, schoolId)]);
    if (room.teacherAssignments.some((item) => item.teacherId === staff.id)) throw new AssistantActionError("NO_CHANGE", 409);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "staff_assign_class", args: { staffId: staff.id, staffName: staff.name, classId: room.id, className: room.name, expectedUpdatedAt: room.updatedAt.toISOString() } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعيين معلم لفصل", summary: `إضافة المعلم «${staff.name}» إلى فصل «${room.name}» مع إبقاء المعلمين الحاليين.`, tool: "staff_assign_class" };
  }

  if (proposal.kind === "shift_save") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.endTime <= proposal.startTime) throw new AssistantActionError("INVALID_END_TIME", 422);
    const staff = await exactStaff(proposal.staffName, schoolId);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const shifts = proposal.updateExisting ? await prisma.shift.findMany({
      where: { schoolId, teacherId: staff.id, date: storedDate(proposal.date) }, select: { id: true }, take: 2,
    }) : [];
    if (proposal.updateExisting && shifts.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (shifts.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "shift_save", args: { shiftId: shifts[0]?.id ?? null, staffId: staff.id, staffName: staff.name, classId: room?.id ?? null, date: proposal.date, startTime: proposal.startTime, endTime: proposal.endTime } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: proposal.updateExisting ? "تعديل مناوبة" : "إنشاء مناوبة", summary: `${proposal.updateExisting ? "تعديل" : "إنشاء"} مناوبة ${staff.name} بتاريخ ${proposal.date} من ${proposal.startTime} إلى ${proposal.endTime}${room ? ` في فصل ${room.name}` : ""}.`, tool: "shift_save" };
  }

  if (proposal.kind === "staff_account") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const staff = await exactStaff(proposal.staffName, schoolId, true);
    const accounts = await prisma.user.findMany({ where: { schoolId, OR: [{ teacherId: staff.id }, { name: { equals: staff.name, mode: "insensitive" } }] }, select: { id: true, disabledAt: true }, take: 2 });
    if (proposal.action === "create" && accounts.length) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    if (proposal.action !== "create" && accounts.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (accounts.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    if (proposal.action === "create" && !proposal.email) throw new AssistantActionError("EMAIL_REQUIRED", 422);
    let roleId: string | null = null;
    if (proposal.action === "create") {
      const role = await prisma.role.findFirst({
        where: {
          schoolId,
          key: { in: [...ASSIGNABLE_ROLE_KEYS] },
          ...(proposal.roleName
            ? {
                OR: [
                  { nameAr: { equals: proposal.roleName, mode: "insensitive" } },
                  { key: { equals: proposal.roleName, mode: "insensitive" } },
                ],
              }
            : { key: "teacher" }),
        },
        select: { id: true },
      });
      if (!role) throw new AssistantActionError("ROLE_NOT_FOUND", 404);
      roleId = role.id;
    }
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "staff_account", args: { action: proposal.action, userId: accounts[0]?.id ?? null, staffId: staff.id, staffName: staff.name, email: proposal.email?.toLowerCase() ?? null, roleId } });
    const labels = { create: "إنشاء حساب وإرسال دعوة", resend: "إعادة إرسال الدعوة", disable: "تعطيل الحساب", enable: "تفعيل الحساب" } as const;
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: labels[proposal.action], summary: `${labels[proposal.action]} للموظف «${staff.name}».`, tool: "staff_account" };
  }

  if (proposal.kind === "class_update") {
    if (!grants(session.permissions, "classes.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const room = await exactClass(proposal.className, schoolId);
    let stageId: string | null = null;
    if (proposal.stageName) {
      const stages = await prisma.academicStageOption.findMany({ where: { schoolId, OR: [{ nameAr: { equals: proposal.stageName, mode: "insensitive" } }, { nameEn: { equals: proposal.stageName, mode: "insensitive" } }] }, select: { id: true }, take: 2 });
      if (stages.length === 0) throw new AssistantActionError("STAGE_NOT_FOUND", 404);
      if (stages.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
      stageId = stages[0]!.id;
    }
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "class_update", args: { classId: room.id, className: room.name, expectedUpdatedAt: room.updatedAt.toISOString(), newName: proposal.newName ?? null, capacity: proposal.capacity ?? null, stageId, updateStage: proposal.stageName !== undefined } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل الفصل", summary: `تعديل فصل «${room.name}»${proposal.newName ? `، الاسم الجديد «${proposal.newName}»` : ""}${proposal.capacity !== undefined ? `، السعة ${proposal.capacity}` : ""}${proposal.stageName ? `، المرحلة ${proposal.stageName}` : ""}.`, tool: "class_update" };
  }

  if (proposal.kind === "class_membership") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const room = await exactClass(proposal.className, schoolId);
    let record: { id: string; name: string; updatedAt: Date };
    if (proposal.subject === "student") {
      const student = await exactStudent(proposal.name, schoolId, session, true);
      if (proposal.action === "add" && student.classId === room.id) throw new AssistantActionError("NO_CHANGE", 409);
      if (proposal.action === "remove" && student.classId !== room.id) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      record = student;
    } else {
      const staff = await exactStaff(proposal.name, schoolId, true);
      const assigned = room.teacherAssignments.some((item) => item.teacherId === staff.id);
      if ((proposal.action === "add" && assigned) || (proposal.action === "remove" && !assigned)) throw new AssistantActionError("NO_CHANGE", 409);
      record = staff;
    }
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "class_membership", args: { action: proposal.action, subject: proposal.subject, recordId: record.id, recordName: record.name, classId: room.id, className: room.name, expectedUpdatedAt: record.updatedAt.toISOString() } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: `${proposal.action === "add" ? "إضافة" : "إزالة"} ${proposal.subject === "student" ? "طفل" : "معلم"} ${proposal.action === "add" ? "إلى" : "من"} فصل`, summary: `${proposal.action === "add" ? "إضافة" : "إزالة"} «${record.name}» ${proposal.action === "add" ? "إلى" : "من"} فصل «${room.name}».`, tool: "class_membership" };
  }

  if (proposal.kind === "class_archive") {
    if (!grants(session.permissions, "classes.archive") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const room = await exactClass(proposal.className, schoolId);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "class_archive", args: { classId: room.id, className: room.name, expectedUpdatedAt: room.updatedAt.toISOString() } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "أرشفة فصل", summary: `أرشفة فصل «${room.name}». سيبقى السجل وتاريخه محفوظين ولن يظهر في القوائم النشطة.`, tool: "class_archive" };
  }

  if (proposal.kind === "restore_all") {
    const permission = proposal.recordType === "student" ? "students.archive" : proposal.recordType === "staff" ? "staff.archive" : "classes.archive";
    if (!grants(session.permissions, permission) || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const count = proposal.recordType === "student" ? await prisma.student.count({ where: { schoolId, deletedAt: { not: null } } }) : proposal.recordType === "staff" ? await prisma.teacher.count({ where: { schoolId, deletedAt: { not: null } } }) : await prisma.class.count({ where: { schoolId, deletedAt: { not: null } } });
    if (count === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "restore_all", args: { recordType: proposal.recordType } });
    const label = proposal.recordType === "student" ? "الأطفال" : proposal.recordType === "staff" ? "المعلمين" : "الفصول";
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: `استعادة جميع ${label}`, summary: `استعادة ${count} من سجلات ${label} الموجودة في سلة المحذوفات.`, tool: "restore_all" };
  }

  if (proposal.kind === "calendar_update") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const event = await exactEvent(proposal.title, schoolId);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const staff = proposal.staffName ? await exactStaff(proposal.staffName, schoolId) : null;
    let startAt: string | null = null;
    let endAt: string | null = null;
    if (proposal.date) {
      const time = event.allDay ? "00:00" : new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(event.startAt);
      const moved = zonedTimeOnDate(proposal.date, time, timeZone);
      if (!moved) throw new AssistantActionError("INVALID_DATE", 422);
      startAt = moved.toISOString();
      if (event.endAt) endAt = new Date(moved.getTime() + (event.endAt.getTime() - event.startAt.getTime())).toISOString();
    }
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "calendar_update", args: { eventId: event.id, oldTitle: event.title, newTitle: proposal.newTitle ?? null, startAt, endAt, updateTiming: proposal.date !== undefined, classId: room?.id ?? null, teacherId: staff?.id ?? null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل حدث", summary: `تعديل حدث «${event.title}»${proposal.newTitle ? ` إلى «${proposal.newTitle}»` : ""}${proposal.date ? ` ونقله إلى ${proposal.date}` : ""}${room ? ` وربطه بفصل «${room.name}»` : ""}${staff ? ` وربطه بالمعلم «${staff.name}»` : ""}.`, tool: "calendar_update" };
  }

  if (proposal.kind === "calendar_delete") {
    if (!grants(session.permissions, "schedule.delete")) throw new AssistantActionError("FORBIDDEN", 403);
    const event = await exactEvent(proposal.title, schoolId);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "calendar_delete", args: { id: event.id, name: event.title } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "حذف حدث", summary: `حذف حدث «${event.title}» من التقويم مع الاحتفاظ بسجل الحذف.`, tool: "calendar_delete" };
  }

  if (proposal.kind === "unit_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.endDate && proposal.startDate && proposal.endDate < proposal.startDate) throw new AssistantActionError("INVALID_END_DATE", 422);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "unit_create", args: { name: proposal.name, description: proposal.description ?? null, startDate: proposal.startDate ?? null, endDate: proposal.endDate ?? null, classId: room?.id ?? null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إنشاء وحدة تعليمية", summary: `إنشاء وحدة «${proposal.name}»${room ? ` لفصل «${room.name}»` : ""}.`, tool: "unit_create" };
  }

  if (proposal.kind === "lesson_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const unit = await exactUnit(proposal.unitName, schoolId);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "lesson_create", args: { unitId: unit.id, unitName: unit.name, title: proposal.title, description: proposal.description ?? null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إنشاء درس", summary: `إضافة درس «${proposal.title}» إلى وحدة «${unit.name}».`, tool: "lesson_create" };
  }

  if (proposal.kind === "activity_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.endDate < proposal.startDate) throw new AssistantActionError("INVALID_END_DATE", 422);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "activity_create", args: { name: proposal.name, startDate: proposal.startDate, endDate: proposal.endDate, classId: room?.id ?? null, message: proposal.message ?? null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إنشاء نشاط", summary: `إنشاء نشاط «${proposal.name}» من ${proposal.startDate} إلى ${proposal.endDate}${room ? ` لفصل «${room.name}»` : " لجميع المنشأة"}.`, tool: "activity_create" };
  }

  if (proposal.kind === "activity_send") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const activity = await exactActivity(proposal.activityName, schoolId);
    const message = proposal.message ?? activity.message ?? activity.name;
    const schoolWide = activity.activityInvites.length === 0;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "activity_send", args: { activityId: activity.id, activityName: activity.name, activityVersion: activity.updatedAt.toISOString(), message, audience: proposal.audience, schoolWide } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إرسال النشاط", summary: `إرسال نشاط «${activity.name}» إلى ${proposal.audience === "guardians" ? "أولياء الأمور" : proposal.audience === "staff" ? "المعلمين" : "أولياء الأمور والمعلمين"}${schoolWide ? " على مستوى المنشأة" : " للفصول المرتبطة"}.`, tool: "activity_send" };
  }

  if (proposal.kind === "unit_file_delete") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const unit = await exactUnit(proposal.unitName, schoolId);
    const files = await prisma.unitFile.findMany({ where: { unitId: unit.id, name: { equals: proposal.fileName, mode: "insensitive" } }, select: { id: true, name: true }, take: 2 });
    if (files.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (files.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const file = files[0]!;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "unit_file_delete", args: { unitId: unit.id, unitName: unit.name, fileId: file.id, fileName: file.name } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "حذف ملف وحدة", summary: `حذف الملف «${file.name}» من وحدة «${unit.name}».`, tool: "unit_file_delete" };
  }

  if (proposal.kind === "care_review" || proposal.kind === "care_edit" || proposal.kind === "care_delete" || proposal.kind === "care_resubmit") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const target = await latestCareReport(proposal.studentName, schoolId, session);
    if (proposal.kind === "care_review" && proposal.action === "return" && !proposal.note) throw new AssistantActionError("NOTE_REQUIRED", 422);
    if (proposal.kind === "care_resubmit" && target.reviewStatus !== "REJECTED") throw new AssistantActionError("NO_CHANGE", 409);
    if (proposal.kind === "care_resubmit" && target.dailyBatchId) throw new AssistantActionError("TEACHER_RESUBMISSION_REQUIRED", 409);
    const tool = proposal.kind;
    const note = "note" in proposal ? proposal.note ?? null : null;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool, args: { reportId: target.id, studentName: target.student.name, batchId: target.dailyBatchId, note, reviewAction: proposal.kind === "care_review" ? proposal.action : null } });
    const title = proposal.kind === "care_review" ? (proposal.action === "approve" ? "اعتماد تقرير الرعاية" : "إرجاع تقرير الرعاية") : proposal.kind === "care_edit" ? "تعديل تقرير الرعاية" : proposal.kind === "care_delete" ? "حذف تقرير الرعاية" : "إعادة إرسال تقرير الرعاية";
    const summary = `${title} الأحدث للطفل «${target.student.name}» بتاريخ ${target.occurredAt.toISOString().slice(0, 10)}${note ? ` مع الملاحظة: ${note}` : ""}.`;
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title, summary, tool };
  }

  if (proposal.kind === "invoice_create") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const target = proposal.subject === "student" ? await exactStudent(proposal.name, schoolId, session) : await exactStaff(proposal.name, schoolId);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "invoice_create", args: { subject: proposal.subject, id: target.id, name: target.name } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: proposal.subject === "student" ? "إنشاء فاتورة طفل" : "إنشاء فاتورة راتب", summary: `إنشاء فاتورة هذا الشهر لـ«${target.name}». سيمنع النظام تكرار فاتورة الشهر نفسه.`, tool: "invoice_create" };
  }

  if (proposal.kind === "expense_update" || proposal.kind === "expense_stop") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const expense = await exactExpense(proposal.title, schoolId);
    if (proposal.kind === "expense_stop" && expense.type !== "monthly") throw new AssistantActionError("NOT_MONTHLY_EXPENSE", 422);
    const tool = proposal.kind;
    const args = proposal.kind === "expense_update" ? { id: expense.id, title: expense.title, newTitle: proposal.newTitle ?? null, amount: proposal.amount ?? null, endDate: proposal.endDate ?? null } : { id: expense.id, name: expense.title };
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool, args });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: proposal.kind === "expense_stop" ? "إيقاف مصروف شهري" : "تعديل مصروف", summary: proposal.kind === "expense_stop" ? `إيقاف تكرار المصروف الشهري «${expense.title}» دون حذف الاستحقاقات السابقة.` : `تعديل المصروف «${expense.title}»${proposal.newTitle ? ` إلى «${proposal.newTitle}»` : ""}${proposal.amount ? ` بمبلغ ${proposal.amount}` : ""}.`, tool };
  }

  if (proposal.kind === "financial_report") {
    if (!grants(session.permissions, "finance.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "financial_report", args: { type: proposal.type, periodLabel: proposal.periodLabel } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إنشاء تقرير مالي", summary: `إنشاء تقرير مالي ${proposal.type === "monthly" ? "شهري" : proposal.type === "semi_annual" ? "نصف سنوي" : "سنوي"} للفترة «${proposal.periodLabel}».`, tool: "financial_report" };
  }

  if (proposal.kind === "finance_opening") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.amount !== 0 && !proposal.date) throw new AssistantActionError("DATE_REQUIRED", 422);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "finance_opening", args: { amount: proposal.amount, date: proposal.date } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل الرصيد الافتتاحي", summary: `تعيين الرصيد الافتتاحي إلى ${proposal.amount.toFixed(2)} ر.س${proposal.date ? ` بتاريخ ${proposal.date}` : ""}.`, tool: "finance_opening" };
  }

  if (proposal.kind === "bulk_renew" || proposal.kind === "bulk_reminder") {
    if (!grants(session.permissions, "finance.manage") || !grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const reminderToday = calendarToday(new Date(), timeZone);
    const reminderHorizon = new Date(reminderToday.getTime() + 30 * 86400000);
    const students = await prisma.student.findMany({ where: { schoolId, deletedAt: null, isActive: true, status: "ACTIVE", ...(room ? { classId: room.id } : {}), ...(proposal.kind === "bulk_reminder" && proposal.reminderKind === "payment" ? { paymentStatus: { in: ["PENDING", "LATE"] } } : {}), ...(proposal.kind === "bulk_reminder" && proposal.reminderKind === "renewal" ? { enrollmentEndDate: { gte: reminderToday, lte: reminderHorizon } } : {}) }, select: { id: true }, take: proposal.kind === "bulk_reminder" ? 200 : 500 });
    if (students.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    const label = room ? `فصل ${room.name}` : "جميع الأطفال النشطين";
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: proposal.kind, args: { ids: students.map((item) => item.id), label, reminderKind: proposal.kind === "bulk_reminder" ? proposal.reminderKind : null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: proposal.kind === "bulk_renew" ? "تجديد جماعي" : "إرسال تذكيرات جماعية", summary: `${proposal.kind === "bulk_renew" ? "تجديد اشتراكات" : `إرسال تذكيرات ${proposal.reminderKind === "payment" ? "دفع" : "تجديد"} إلى`} ${students.length} طفل في ${label}.`, tool: proposal.kind };
  }

  if (proposal.kind === "enrollment_link") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "enrollment_link", args: { email: proposal.email.toLowerCase() } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "إنشاء رابط تسجيل", summary: `إنشاء رابط تسجيل جديد وإرساله إلى ${proposal.email}.`, tool: "enrollment_link" };
  }

  if (proposal.kind === "enrollment_review") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const matches = await prisma.enrollmentSubmission.findMany({ where: { school_id: schoolId, status: "pending_review", full_name: { equals: proposal.studentName, mode: "insensitive" } }, select: { id: true, full_name: true }, take: 2 });
    if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
    const target = matches[0]!;
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "enrollment_review", args: { submissionId: target.id, studentName: target.full_name, action: proposal.action, classId: room?.id ?? null } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: proposal.action === "approve" ? "قبول طلب التسجيل" : "رفض طلب التسجيل", summary: `${proposal.action === "approve" ? "قبول" : "رفض"} طلب تسجيل «${target.full_name}»${room ? ` وإضافته إلى فصل «${room.name}»` : ""}.`, tool: "enrollment_review" };
  }

  if (proposal.kind === "import_confirm") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const importSession = await prisma.importSession.findFirst({ where: { id: proposal.sessionId, school_id: schoolId, status: "validated", expires_at: { gt: new Date() } }, select: { id: true, type: true, total_rows: true, valid_rows: true, error_rows: true } });
    if (!importSession) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (importSession.error_rows > 0) throw new AssistantActionError("IMPORT_HAS_ERRORS", 409);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "import_confirm", args: { sessionId: importSession.id } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تأكيد الاستيراد", summary: `استيراد ${importSession.valid_rows} من سجلات ${importSession.type === "students" ? "الأطفال" : "المعلمين"} بعد نجاح التحقق دون أخطاء.`, tool: "import_confirm" };
  }

  if (proposal.kind === "settings_update") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "settings_update", args: { field: proposal.field, value: proposal.value } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل إعدادات المنشأة", summary: `تحديث «${proposal.field}» إلى «${proposal.value ?? "غير محدد"}».`, tool: "settings_update" };
  }

  if (proposal.kind === "stage_manage") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const stages = proposal.action === "create" ? [] : await prisma.academicStageOption.findMany({ where: { schoolId, nameAr: { equals: proposal.name, mode: "insensitive" } }, select: { id: true, nameAr: true, archivedAt: true }, take: 2 });
    if (proposal.action !== "create" && stages.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (stages.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    if (proposal.action === "rename" && !proposal.newName) throw new AssistantActionError("NAME_REQUIRED", 422);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "stage_manage", args: { action: proposal.action, id: stages[0]?.id ?? null, name: stages[0]?.nameAr ?? proposal.name, newName: proposal.newName ?? null } });
    const labels = { create: "إضافة مرحلة", rename: "تعديل مرحلة", archive: "أرشفة مرحلة", restore: "استعادة مرحلة" } as const;
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: labels[proposal.action], summary: `${labels[proposal.action]} «${proposal.name}»${proposal.newName ? ` إلى «${proposal.newName}»` : ""}.`, tool: "stage_manage" };
  }

  if (proposal.kind === "arrival_recipient") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const accounts = await prisma.user.findMany({ where: { schoolId, name: { equals: proposal.accountName, mode: "insensitive" }, disabledAt: null, acceptedAt: { not: null } }, select: { id: true, name: true }, take: 2 });
    if (accounts.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (accounts.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const current = await prisma.arrivalRecipientSetting.findMany({ where: { schoolId }, select: { userId: true } });
    const target = accounts[0]!;
    const selected = current.some((item) => item.userId === target.id);
    if ((proposal.action === "add" && selected) || (proposal.action === "remove" && !selected)) throw new AssistantActionError("NO_CHANGE", 409);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "arrival_recipient", args: { action: proposal.action, userId: target.id, accountName: target.name, currentIds: current.map((item) => item.userId) } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل مستلمي إشعار الوصول", summary: `${proposal.action === "add" ? "إضافة" : "إزالة"} «${target.name}» ${proposal.action === "add" ? "إلى" : "من"} مستلمي إشعار الوصول.`, tool: "arrival_recipient" };
  }

  if (proposal.kind === "school_info") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "school_info", args: { field: proposal.field, value: proposal.value } });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تعديل معلومات المنشأة", summary: `تحديث حقل ${proposal.field} إلى «${proposal.value}».`, tool: "school_info" };
  }

  if (proposal.kind === "storage_refresh") {
    if (!grants(session.permissions, "settings.storage")) throw new AssistantActionError("FORBIDDEN", 403);
    const approval = await issueAssistantApproval({ schoolId, userId: session.user.id, tool: "storage_refresh", args: {} });
    return { token: approval.token, expiresAt: approval.expiresAt.toISOString(), title: "تحديث حساب التخزين", summary: "إعادة حساب مساحة التخزين المستخدمة فعليًا للمنشأة وتحديث القيمة المخبأة.", tool: "storage_refresh" };
  }

  if (proposal.kind === "expense_create") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    if (proposal.endDate && proposal.endDate < proposal.startDate) {
      throw new AssistantActionError("INVALID_END_DATE", 422);
    }
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "expense_create",
      args: {
        title: proposal.title,
        amount: proposal.amount,
        type: proposal.type,
        startDate: proposal.startDate,
        endDate: proposal.endDate ?? null,
        description: proposal.description || null,
      },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "إضافة مصروف",
      summary: `إضافة مصروف «${proposal.title}» بمبلغ ${proposal.amount.toFixed(2)} ر.س، ${proposal.type === "monthly" ? "شهري" : "لمرة واحدة"}، يبدأ في ${proposal.startDate}.`,
      tool: "expense_create",
    };
  }

  if (proposal.kind === "expense_status") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const dueDate = storedDate(proposal.dueDate);
    const matches = await prisma.expenseOccurrence.findMany({
      where: {
        school_id: schoolId,
        due_date: dueDate,
        expense: { title: { equals: proposal.title, mode: "insensitive" } },
      },
      select: {
        id: true,
        amount: true,
        updated_at: true,
        expense: { select: { title: true } },
      },
      take: 2,
    });
    if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const target = matches[0]!;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "expense_status",
      args: {
        occurrenceId: target.id,
        expectedUpdatedAt: target.updated_at.toISOString(),
        status: proposal.status,
      },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: proposal.status === "PAID" ? "تحديد المصروف كمدفوع" : "إعادة المصروف إلى غير مدفوع",
      summary: `${proposal.status === "PAID" ? "تحديد" : "إعادة"} استحقاق «${target.expense.title}» بتاريخ ${proposal.dueDate} ومبلغ ${moneyNumber(target.amount).toFixed(2)} ر.س ${proposal.status === "PAID" ? "كمدفوع" : "إلى غير مدفوع"}.`,
      tool: "expense_status",
    };
  }

  if (proposal.kind === "payment_reminder") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const matches = await prisma.student.findMany({
      where: {
        schoolId,
        name: { equals: proposal.studentName, mode: "insensitive" },
        deletedAt: null,
        ...studentClassWhere(session),
      },
      select: { id: true, name: true, guardian: { select: { email: true } } },
      take: 2,
    });
    if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const target = matches[0]!;
    if (!target.guardian?.email) throw new AssistantActionError("NO_GUARDIAN_EMAIL", 422);
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "payment_reminder",
      args: { studentId: target.id },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "إرسال تذكير دفع",
      summary: `إرسال تذكير الدفع المعتمد إلى ولي أمر الطفل ${target.name}. لن يظهر البريد الإلكتروني للمساعد أو في المعاينة.`,
      tool: "payment_reminder",
    };
  }

  if (proposal.kind === "care_policy") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "care_policy",
      args: { reviewRequired: proposal.reviewRequired },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "تغيير طريقة إرسال تقارير الرعاية",
      summary: proposal.reviewRequired
        ? "التقارير الجديدة ستنتظر مراجعة الإدارة قبل وصولها إلى أولياء الأمور. التقارير السابقة لن تتغير."
        : "التقارير الجديدة ستصل مباشرة إلى أولياء الأمور دون مراجعة الإدارة. التقارير السابقة لن تتغير.",
      tool: "care_policy",
    };
  }

  if (proposal.kind === "class_create") {
    if (!grants(session.permissions, "classes.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const duplicate = await prisma.class.findFirst({
      where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    try {
      await assertClassCapacity(schoolId);
    } catch (error) {
      if (error instanceof PlanLimitError) throw new AssistantActionError("PLAN_LIMIT", 409);
      throw error;
    }
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "class_create",
      args: { name: proposal.name, period: proposal.period },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "إنشاء فصل",
      summary: `إنشاء فصل «${proposal.name}» للفترة ${proposal.period === "MORNING" ? "الصباحية" : "المسائية"} دون تعيين معلم أو أطفال.`,
      tool: "class_create",
    };
  }

  if (proposal.kind === "restore_record") {
    const permission = proposal.recordType === "student"
      ? "students.archive"
      : proposal.recordType === "staff"
        ? "staff.archive"
        : "classes.archive";
    if (!grants(session.permissions, permission)) throw new AssistantActionError("FORBIDDEN", 403);

    const matches = proposal.recordType === "student"
      ? await prisma.student.findMany({
          where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: { not: null }, ...studentClassWhere(session) },
          select: { id: true, name: true },
          take: 2,
        })
      : proposal.recordType === "staff"
        ? await prisma.teacher.findMany({
            where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: { not: null } },
            select: { id: true, name: true },
            take: 2,
          })
        : await prisma.class.findMany({
            where: { schoolId, name: { equals: proposal.name, mode: "insensitive" }, deletedAt: { not: null } },
            select: { id: true, name: true },
            take: 2,
          });
    if (matches.length === 0) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (matches.length > 1) throw new AssistantActionError("AMBIGUOUS_SUBJECT", 409);
    const target = matches[0]!;
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "restore_record",
      args: { recordType: proposal.recordType, recordId: target.id },
    });
    const label = proposal.recordType === "student" ? "الطفل" : proposal.recordType === "staff" ? "المعلم" : "الفصل";
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "استعادة من سلة المحذوفات",
      summary: `استعادة ${label} «${target.name}» من سلة المحذوفات.`,
      tool: "restore_record",
    };
  }

  if (proposal.kind === "broadcast_create") {
    if (!grants(session.permissions, "schedule.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const notifyGuardians = proposal.audience !== "staff";
    const notifyStaff = proposal.audience !== "guardians";
    const [guardians, staff] = await Promise.all([
      notifyGuardians
        ? prisma.guardianAccount.count({
            where: {
              schoolId,
              disabledAt: null,
              acceptedAt: { not: null },
              notifyCalendar: true,
              guardian: { is: { schoolId, deletedAt: null, anonymizedAt: null } },
            },
          })
        : Promise.resolve(0),
      notifyStaff
        ? prisma.user.count({
            where: { schoolId, disabledAt: null, acceptedAt: { not: null }, notifyCalendar: true },
          })
        : Promise.resolve(0),
    ]);
    if (guardians + staff === 0) throw new AssistantActionError("NO_ELIGIBLE_RECIPIENTS", 422);
    const approval = await issueAssistantApproval({
      schoolId,
      userId: session.user.id,
      tool: "broadcast_create",
      args: {
        title: proposal.title,
        message: proposal.message,
        date: proposal.date,
        audience: proposal.audience,
      },
    });
    return {
      token: approval.token,
      expiresAt: approval.expiresAt.toISOString(),
      title: "إنشاء وإرسال إعلان عام",
      summary: `إنشاء إعلان «${proposal.title}» بتاريخ ${proposal.date} وإرساله داخل التطبيق إلى ${guardians} من أولياء الأمور و${staff} من الموظفين المؤهلين.`,
      tool: "broadcast_create",
    };
  }

  if (!grants(session.permissions, "schedule.manage")) {
    throw new AssistantActionError("FORBIDDEN", 403);
  }
  if (!validTimeZone(timeZone)) throw new AssistantActionError("INVALID_TIME_ZONE", 422);

  let startAt: Date;
  let endAt: Date | null;
  if (proposal.allDay) {
    startAt = storedDate(proposal.date);
    endAt = proposal.type === "ANNOUNCEMENT" ? null : storedDate(addDateDays(proposal.date, 1));
  } else {
    if (!proposal.startTime) throw new AssistantActionError("START_TIME_REQUIRED", 422);
    startAt = zonedTimeOnDate(proposal.date, proposal.startTime, timeZone) ?? new Date(Number.NaN);
    endAt = proposal.type === "ANNOUNCEMENT"
      ? null
      : proposal.endTime
        ? zonedTimeOnDate(proposal.date, proposal.endTime, timeZone)
        : null;
    if (Number.isNaN(startAt.getTime())) throw new AssistantActionError("INVALID_START_TIME", 422);
    if (!endAt || endAt <= startAt) throw new AssistantActionError("INVALID_END_TIME", 422);
  }

  const room = proposal.className ? await exactClass(proposal.className, schoolId) : null;
  const staff = proposal.staffName ? await exactStaff(proposal.staffName, schoolId) : null;
  const approval = await issueAssistantApproval({
    schoolId,
    userId: session.user.id,
    tool: "calendar_create",
    args: {
      type: proposal.type,
      title: proposal.title,
      startAt: startAt.toISOString(),
      endAt: endAt?.toISOString() ?? null,
      allDay: proposal.allDay,
      classId: room?.id ?? null,
      teacherId: staff?.id ?? null,
    },
  });
  return {
    token: approval.token,
    expiresAt: approval.expiresAt.toISOString(),
    title: "إنشاء حدث في التقويم",
    summary: `إنشاء «${proposal.title}» بتاريخ ${proposal.date}${proposal.allDay ? " طوال اليوم" : ` الساعة ${proposal.startTime}`}${room ? ` لفصل «${room.name}»` : staff ? ` للمعلم «${staff.name}»` : " لجميع المنشأة"}.`,
    tool: "calendar_create",
  };
}

export async function confirmAssistantAction(input: {
  token: string;
  session: AuthSession;
  timeZone: string;
  request: Request;
}): Promise<{ message: string; tool: string }> {
  const { session, timeZone, request } = input;
  const approval = await consumeAssistantApproval({
    token: input.token,
    schoolId: session.user.schoolId,
    userId: session.user.id,
  });
  if (!approval) throw new AssistantActionError("INVALID_OR_USED_APPROVAL", 409);

  const schoolId = session.user.schoolId;
  const now = new Date();
  if (approval.tool === "student_attendance") {
    if (!grants(session.permissions, "attendance.students")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = studentAttendanceArgs.parse(approval.args);
    try {
      const result = args.operation === "checkin"
        ? await checkInStudent({
            studentId: args.subjectId,
            schoolId,
            classIds: scopedClassIds(session),
            date: calendarToday(now, timeZone),
            now,
          })
        : await checkoutStudent({
            studentId: args.subjectId,
            schoolId,
            classIds: scopedClassIds(session),
            now,
            timeZone,
          });
      await notifyGuardiansOfAttendance({
        schoolId,
        studentId: args.subjectId,
        studentName: result.personName,
        event: args.operation,
      }).catch((error) => logSafeError("assistant-attendance-notification", error));
      await logAction({
        school_id: schoolId,
        action: `${attendanceVerb(args.operation)} عبر المساعد`,
        entity_type: "student_attendance",
        entity_id: args.subjectId,
        entity_name: result.personName,
        performed_by: session.user.name ?? "المدير",
        request,
      });
      return { message: `تم ${attendanceVerb(args.operation)} للطفل ${result.personName}.`, tool: approval.tool };
    } catch (error) {
      if (error instanceof AttendanceOperationError) throw new AssistantActionError(error.code, error.status);
      throw error;
    }
  }

  if (approval.tool === "staff_attendance") {
    if (!grants(session.permissions, "attendance.staff")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = staffAttendanceArgs.parse(approval.args);
    try {
      const result = args.operation === "checkin"
        ? await checkInTeacher({
            teacherId: args.subjectId,
            schoolId,
            date: calendarToday(now, timeZone),
            now,
            timeZone,
          })
        : await checkoutTeacher({ teacherId: args.subjectId, schoolId, now, timeZone });
      await logAction({
        school_id: schoolId,
        action: `${attendanceVerb(args.operation)} عبر المساعد`,
        entity_type: "staff_attendance",
        entity_id: args.subjectId,
        entity_name: result.personName,
        performed_by: session.user.name ?? "المدير",
        request,
      });
      return { message: `تم ${attendanceVerb(args.operation)} للموظف ${result.personName}.`, tool: approval.tool };
    } catch (error) {
      if (error instanceof AttendanceOperationError) throw new AssistantActionError(error.code, error.status);
      throw error;
    }
  }

  if (approval.tool === "student_create") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = studentCreateArgs.parse(approval.args);
    try {
      await assertStudentCapacity(schoolId);
    } catch (error) {
      if (error instanceof PlanLimitError) throw new AssistantActionError("PLAN_LIMIT", 409);
      throw error;
    }
    if (args.classId) {
      const room = await prisma.class.findFirst({
        where: { id: args.classId, schoolId, deletedAt: null, archivedAt: null },
        select: { id: true },
      });
      if (!room) throw new AssistantActionError("CLASS_NOT_FOUND", 404);
    }
    const duplicate = await prisma.student.findFirst({
      where: { schoolId, name: { equals: args.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    let created: { id: string; name: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        const settings = await tx.settings.findUnique({ where: { schoolId }, select: studentFeeSettingsSelect });
        const cycleFee = requireStudentCycleFee("MONTHLY", settings);
        let guardianId: string | null = null;
        if (args.guardianName) {
          const existingGuardian = args.guardianPhone
            ? await tx.guardian.findFirst({
                where: { schoolId, phone1: args.guardianPhone, deletedAt: null, anonymizedAt: null },
                select: { id: true },
              })
            : null;
          guardianId = existingGuardian?.id ?? (await tx.guardian.create({
            data: { schoolId, name: args.guardianName, phone1: args.guardianPhone },
            select: { id: true },
          })).id;
        }
        const student = await tx.student.create({
          data: {
            schoolId,
            name: args.name,
            classId: args.classId,
            guardianId,
            billingCycle: "MONTHLY",
            cycleFee,
            needsClassWarning: args.classId === null,
          },
          select: { id: true, name: true },
        });
        if (guardianId) {
          await tx.studentGuardian.upsert({
            where: { studentId_guardianId: { studentId: student.id, guardianId } },
            create: { schoolId, studentId: student.id, guardianId, isPrimary: true, canPickup: true },
            update: { isPrimary: true },
          });
        }
        await generatePaymentCycles(student.id, tx);
        return student;
      });
    } catch (error) {
      if (error instanceof StudentCycleFeeError) {
        throw new AssistantActionError("SUBSCRIPTION_FEE_NOT_CONFIGURED", 422);
      }
      throw error;
    }
    await logAction({
      school_id: schoolId,
      action: `إضافة طفل عبر المساعد: ${created.name}`,
      entity_type: "student",
      entity_id: created.id,
      entity_name: created.name,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تمت إضافة الطفل «${created.name}».`, tool: approval.tool };
  }

  if (approval.tool === "student_rename") {
    if (!grants(session.permissions, "students.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = studentRenameArgs.parse(approval.args);
    const updated = await prisma.student.updateMany({
      where: {
        id: args.studentId,
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        updatedAt: new Date(args.expectedUpdatedAt),
        ...studentClassWhere(session),
      },
      data: { name: args.newName },
    });
    if (updated.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    await logAction({
      school_id: schoolId,
      action: `تعديل اسم طفل عبر المساعد: ${args.newName}`,
      entity_type: "student",
      entity_id: args.studentId,
      entity_name: args.newName,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تم تغيير اسم الطفل إلى «${args.newName}».`, tool: approval.tool };
  }

  if (approval.tool === "student_move_class") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = studentMoveArgs.parse(approval.args);
    const room = await prisma.class.findFirst({
      where: { id: args.classId, schoolId, deletedAt: null, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!room) throw new AssistantActionError("CLASS_NOT_FOUND", 404);
    const updated = await prisma.student.updateMany({
      where: {
        id: args.studentId,
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        updatedAt: new Date(args.expectedUpdatedAt),
      },
      data: { classId: room.id, needsClassWarning: false },
    });
    if (updated.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    const student = await prisma.student.findFirstOrThrow({
      where: { id: args.studentId, schoolId },
      select: { name: true },
    });
    await logAction({
      school_id: schoolId,
      action: `نقل طفل عبر المساعد إلى الفصل: ${room.name}`,
      entity_type: "student",
      entity_id: args.studentId,
      entity_name: student.name,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تم نقل الطفل «${student.name}» إلى فصل «${room.name}».`, tool: approval.tool };
  }

  if (approval.tool === "guardian_link") {
    if (!grants(session.permissions, "students.guardians") && !grants(session.permissions, "students.manage")) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = guardianLinkArgs.parse(approval.args);
    const student = await prisma.student.findFirst({
      where: {
        id: args.studentId,
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        updatedAt: new Date(args.expectedUpdatedAt),
        ...studentClassWhere(session),
      },
      select: { id: true, name: true, guardianId: true },
    });
    if (!student) throw new AssistantActionError("STALE_RECORD", 409);
    const outcome = await prisma.$transaction(async (tx) => {
      let guardianId = args.guardianId;
      let guardianName = args.guardianName;
      if (guardianId) {
        const owned = await tx.guardian.findFirst({
          where: { id: guardianId, schoolId, deletedAt: null, anonymizedAt: null },
          select: { id: true, name: true },
        });
        if (!owned) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
        guardianName = owned.name;
      } else {
        const existing = args.guardianPhone
          ? await tx.guardian.findFirst({
              where: { schoolId, phone1: args.guardianPhone, deletedAt: null, anonymizedAt: null },
              select: { id: true, name: true },
            })
          : null;
        if (existing) {
          guardianId = existing.id;
          guardianName = existing.name;
        } else {
          const createdGuardian = await tx.guardian.create({
            data: { schoolId, name: args.guardianName, phone1: args.guardianPhone },
            select: { id: true, name: true },
          });
          guardianId = createdGuardian.id;
          guardianName = createdGuardian.name;
        }
      }
      const makePrimary = args.makePrimary || student.guardianId === null;
      if (makePrimary) {
        await tx.studentGuardian.updateMany({ where: { studentId: student.id }, data: { isPrimary: false } });
        await tx.student.update({ where: { id: student.id }, data: { guardianId } });
      }
      await tx.studentGuardian.upsert({
        where: { studentId_guardianId: { studentId: student.id, guardianId } },
        create: { schoolId, studentId: student.id, guardianId, isPrimary: makePrimary, canPickup: true },
        update: { ...(makePrimary ? { isPrimary: true } : {}) },
      });
      return { guardianId, guardianName, makePrimary };
    });
    await logAction({
      school_id: schoolId,
      action: `ربط ولي أمر عبر المساعد بالطفل: ${student.name}`,
      entity_type: "student",
      entity_id: student.id,
      entity_name: student.name,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return {
      message: `تم ربط ولي الأمر «${outcome.guardianName}» بالطفل «${student.name}»${outcome.makePrimary ? " كولي أمر رئيسي" : ""}.`,
      tool: approval.tool,
    };
  }

  if (approval.tool === "student_archive") {
    if (!grants(session.permissions, "students.archive")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = studentLifecycleArgs.parse(approval.args);
    const student = await prisma.student.findFirst({
      where: { id: args.studentId, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt), ...studentClassWhere(session) },
      select: { id: true, name: true },
    });
    if (!student) throw new AssistantActionError("STALE_RECORD", 409);
    const result = await prisma.student.updateMany({
      where: { id: student.id, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt) },
      data: { deletedAt: now },
    });
    if (result.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    await logAction({ school_id: schoolId, action: `أرشفة طفل عبر المساعد: ${student.name}`, entity_type: "student", entity_id: student.id, entity_name: student.name, performed_by: session.user.name ?? "المدير", request });
    return { message: `تم نقل الطفل «${student.name}» إلى سلة المحذوفات.`, tool: approval.tool };
  }

  if (approval.tool === "student_subscription_cancel" || approval.tool === "student_reactivate") {
    if (!grants(session.permissions, "students.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = studentLifecycleArgs.parse(approval.args);
    const student = await prisma.student.findFirst({
      where: { id: args.studentId, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt), ...studentClassWhere(session) },
      select: { id: true, name: true, anonymizedAt: true },
    });
    if (!student) throw new AssistantActionError("STALE_RECORD", 409);
    if (student.anonymizedAt) throw new AssistantActionError("ANONYMIZED_STUDENT", 409);
    const data = approval.tool === "student_reactivate"
      ? buildStudentDeparture("ACTIVE", null, 0)
      : buildStudentDeparture("WITHDRAWN", null, (await getRetentionPolicy()).studentRetentionYears);
    const updated = await prisma.student.updateMany({
      where: { id: student.id, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt) },
      data,
    });
    if (updated.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    const reactivated = approval.tool === "student_reactivate";
    await logAction({ school_id: schoolId, action: `${reactivated ? "إعادة تفعيل" : "إلغاء اشتراك"} طفل عبر المساعد: ${student.name}`, entity_type: "student", entity_id: student.id, entity_name: student.name, performed_by: session.user.name ?? "المدير", request });
    return { message: reactivated ? `تمت إعادة تفعيل الطفل «${student.name}».` : `تم إلغاء اشتراك الطفل «${student.name}».`, tool: approval.tool };
  }

  if (approval.tool === "student_subscription_renew") {
    if (!grants(session.permissions, "students.manage") || !grants(session.permissions, "finance.manage")) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = studentLifecycleArgs.parse(approval.args);
    const current = await prisma.student.findFirst({
      where: { id: args.studentId, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt), ...studentClassWhere(session) },
      select: { id: true },
    });
    if (!current) throw new AssistantActionError("STALE_RECORD", 409);
    try {
      const renewed = await renewStudentSubscription({ mode: "automatic" }, {
        id: args.studentId,
        schoolId,
        actor: session.user.name ?? "المدير",
        request,
        classIds: scopedClassIds(session),
      });
      return { message: `تم تجديد اشتراك الطفل «${renewed.name}».`, tool: approval.tool };
    } catch (error) {
      if (error instanceof RenewalError) throw new AssistantActionError(error.code, error.status);
      throw error;
    }
  }

  if (approval.tool === "staff_create") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = staffCreateArgs.parse(approval.args);
    const { POST } = await import("@/app/api/teachers/route");
    const payload = await routeResult(await POST(internalJsonRequest(request, { name: args.name, period: args.period }, timeZone)));
    const name = typeof payload.name === "string" ? payload.name : args.name;
    return { message: `تمت إضافة المعلم «${name}».`, tool: approval.tool };
  }

  if (approval.tool === "staff_rename") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = staffRenameArgs.parse(approval.args);
    const { PUT } = await import("@/app/api/teachers/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, { expectedUpdatedAt: args.expectedUpdatedAt, name: args.newName }, timeZone), { params: Promise.resolve({ id: args.id }) }));
    return { message: `تم تغيير اسم المعلم إلى «${args.newName}».`, tool: approval.tool };
  }

  if (approval.tool === "staff_archive") {
    if (!grants(session.permissions, "staff.archive")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = namedRecordArgs.parse(approval.args);
    const fresh = await prisma.teacher.findFirst({ where: { id: args.id, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt!) }, select: { id: true } });
    if (!fresh) throw new AssistantActionError("STALE_RECORD", 409);
    const { DELETE } = await import("@/app/api/teachers/[id]/route");
    await routeResult(await DELETE(internalJsonRequest(request, {}, timeZone), { params: Promise.resolve({ id: args.id }) }));
    return { message: `تم نقل المعلم «${args.name}» إلى سلة المحذوفات.`, tool: approval.tool };
  }

  if (approval.tool === "staff_assign_class") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = staffAssignClassArgs.parse(approval.args);
    const room = await prisma.class.findFirst({ where: { id: args.classId, schoolId, deletedAt: null, archivedAt: null, updatedAt: new Date(args.expectedUpdatedAt) }, select: { teacherAssignments: { select: { teacherId: true } } } });
    if (!room) throw new AssistantActionError("STALE_RECORD", 409);
    const teacherIds = Array.from(new Set([...room.teacherAssignments.map((item) => item.teacherId), args.staffId]));
    const { PUT } = await import("@/app/api/classes/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, { expectedUpdatedAt: args.expectedUpdatedAt, teacherIds }, timeZone), { params: Promise.resolve({ id: args.classId }) }));
    return { message: `تم تعيين المعلم «${args.staffName}» لفصل «${args.className}».`, tool: approval.tool };
  }

  if (approval.tool === "shift_save") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = shiftSaveArgs.parse(approval.args);
    const shifts = await import("@/app/api/shifts/route");
    const body = { teacherId: args.staffId, classId: args.classId, date: args.date, startTime: args.startTime, endTime: args.endTime, ...(args.shiftId ? { shiftId: args.shiftId } : {}) };
    await routeResult(args.shiftId ? await shifts.PATCH(internalJsonRequest(request, body, timeZone)) : await shifts.POST(internalJsonRequest(request, body, timeZone)));
    return { message: `تم ${args.shiftId ? "تعديل" : "إنشاء"} مناوبة «${args.staffName}».`, tool: approval.tool };
  }

  if (approval.tool === "staff_account") {
    if (!grants(session.permissions, "staff.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = staffAccountArgs.parse(approval.args);
    if (args.action === "create") {
      if (!args.email || !args.roleId) throw new AssistantActionError("INVALID_ACTION", 422);
      const { POST } = await import("@/app/api/staff-accounts/route");
      const result = await routeResult(await POST(internalJsonRequest(request, { name: args.staffName, email: args.email, roleId: args.roleId, teacherId: args.staffId }, timeZone)));
      const sent = result.invitationSent === true;
      return { message: sent ? `تم إنشاء حساب «${args.staffName}» وإرسال الدعوة.` : `تم إنشاء حساب «${args.staffName}»، لكن تعذر تسليم الدعوة ويمكن إعادة إرسالها لاحقًا.`, tool: approval.tool };
    }
    if (!args.userId) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (args.action === "resend") {
      const { POST } = await import("@/app/api/staff-accounts/[id]/invite/route");
      const result = await routeResult(await POST(internalJsonRequest(request, {}, timeZone), { params: Promise.resolve({ id: args.userId }) }));
      return { message: result.sent === true ? `تمت إعادة إرسال دعوة «${args.staffName}».` : `تم تحديث الدعوة لكن تعذر تسليم البريد.`, tool: approval.tool };
    }
    const { PUT } = await import("@/app/api/staff-accounts/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, { disabled: args.action === "disable" }, timeZone), { params: Promise.resolve({ id: args.userId }) }));
    return { message: `تم ${args.action === "disable" ? "تعطيل" : "تفعيل"} حساب «${args.staffName}».`, tool: approval.tool };
  }

  if (approval.tool === "class_update") {
    if (!grants(session.permissions, "classes.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = classUpdateArgs.parse(approval.args);
    const body = {
      expectedUpdatedAt: args.expectedUpdatedAt,
      ...(args.newName !== null ? { name: args.newName } : {}),
      ...(args.capacity !== null ? { capacity: args.capacity } : {}),
      ...(args.updateStage ? { stageId: args.stageId } : {}),
    };
    const { PUT } = await import("@/app/api/classes/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, body, timeZone), { params: Promise.resolve({ id: args.classId }) }));
    return { message: `تم تعديل فصل «${args.className}».`, tool: approval.tool };
  }

  if (approval.tool === "class_membership") {
    if (!grants(session.permissions, "classes.assign") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = classMembershipArgs.parse(approval.args);
    if (args.subject === "student") {
      const updated = await prisma.student.updateMany({
        where: { id: args.recordId, schoolId, deletedAt: null, updatedAt: new Date(args.expectedUpdatedAt) },
        data: args.action === "add" ? { classId: args.classId, needsClassWarning: false } : { classId: null, needsClassWarning: true },
      });
      if (updated.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    } else {
      const room = await prisma.class.findFirst({ where: { id: args.classId, schoolId, deletedAt: null }, select: { updatedAt: true, teacherAssignments: { select: { teacherId: true } } } });
      if (!room) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      const teacherIds = args.action === "add" ? Array.from(new Set([...room.teacherAssignments.map((item) => item.teacherId), args.recordId])) : room.teacherAssignments.map((item) => item.teacherId).filter((id) => id !== args.recordId);
      const { PUT } = await import("@/app/api/classes/[id]/route");
      await routeResult(await PUT(internalJsonRequest(request, { expectedUpdatedAt: room.updatedAt.toISOString(), teacherIds }, timeZone), { params: Promise.resolve({ id: args.classId }) }));
    }
    await logAction({ school_id: schoolId, action: `${args.action === "add" ? "إضافة" : "إزالة"} ${args.subject === "student" ? "طفل" : "معلم"} ${args.action === "add" ? "إلى" : "من"} فصل عبر المساعد`, entity_type: args.subject, entity_id: args.recordId, entity_name: args.recordName, performed_by: session.user.name ?? "المدير", request });
    return { message: `تمت ${args.action === "add" ? "إضافة" : "إزالة"} «${args.recordName}» ${args.action === "add" ? "إلى" : "من"} فصل «${args.className}».`, tool: approval.tool };
  }

  if (approval.tool === "class_archive") {
    if (!grants(session.permissions, "classes.archive") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = classArchiveArgs.parse(approval.args);
    const { PUT } = await import("@/app/api/classes/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, { expectedUpdatedAt: args.expectedUpdatedAt, archived: true }, timeZone), { params: Promise.resolve({ id: args.classId }) }));
    return { message: `تمت أرشفة فصل «${args.className}».`, tool: approval.tool };
  }

  if (approval.tool === "restore_all") {
    const args = restoreAllArgs.parse(approval.args);
    const permission = args.recordType === "student" ? "students.archive" : args.recordType === "staff" ? "staff.archive" : "classes.archive";
    if (!grants(session.permissions, permission) || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const response = args.recordType === "student"
      ? await (await import("@/app/api/trash/restore-all/students/route")).POST(internalJsonRequest(request, {}, timeZone))
      : args.recordType === "staff"
        ? await (await import("@/app/api/trash/restore-all/teachers/route")).POST(internalJsonRequest(request, {}, timeZone))
        : await (await import("@/app/api/trash/restore-all/classes/route")).POST(internalJsonRequest(request, {}, timeZone));
    const result = await routeResult(response);
    return { message: `تمت استعادة ${typeof result.restored === "number" ? result.restored : "جميع"} من السجلات.`, tool: approval.tool };
  }

  if (approval.tool === "calendar_update") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = calendarUpdateArgs.parse(approval.args);
    const body = { ...(args.newTitle ? { title: args.newTitle } : {}), ...(args.startAt ? { startAt: args.startAt } : {}), ...(args.updateTiming ? { endAt: args.endAt } : {}), ...(args.classId ? { classIds: [args.classId] } : {}), ...(args.teacherId ? { teacherId: args.teacherId } : {}) };
    const { PUT } = await import("@/app/api/calendar/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, body, timeZone, { method: "PUT" }), { params: Promise.resolve({ id: args.eventId }) }));
    return { message: `تم تعديل حدث «${args.oldTitle}».`, tool: approval.tool };
  }

  if (approval.tool === "calendar_delete") {
    if (!grants(session.permissions, "schedule.delete")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = namedIdArgs.parse(approval.args);
    const { DELETE } = await import("@/app/api/calendar/[id]/route");
    await routeResult(await DELETE(internalJsonRequest(request, {}, timeZone, { method: "DELETE" }), { params: Promise.resolve({ id: args.id }) }));
    return { message: `تم حذف حدث «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "unit_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = unitCreateArgs.parse(approval.args);
    const { POST } = await import("@/app/api/units/route");
    await routeResult(await POST(internalJsonRequest(request, { name: args.name, description: args.description, startDate: args.startDate, endDate: args.endDate, classIds: args.classId ? [args.classId] : [] }, timeZone)));
    return { message: `تم إنشاء وحدة «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "lesson_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = lessonCreateArgs.parse(approval.args);
    const { POST } = await import("@/app/api/units/[id]/lessons/route");
    await routeResult(await POST(internalJsonRequest(request, { title: args.title, description: args.description }, timeZone), { params: Promise.resolve({ id: args.unitId }) }));
    return { message: `تمت إضافة درس «${args.title}» إلى وحدة «${args.unitName}».`, tool: approval.tool };
  }

  if (approval.tool === "activity_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = activityCreateArgs.parse(approval.args);
    const { POST } = await import("@/app/api/activities/route");
    await routeResult(await POST(internalJsonRequest(request, { name: args.name, startDate: `${args.startDate}T00:00:00.000Z`, endDate: `${args.endDate}T23:59:59.999Z`, allDay: true, message: args.message ?? undefined, classIds: args.classId ? [args.classId] : [] }, timeZone)));
    return { message: `تم إنشاء نشاط «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "activity_send") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = activitySendArgs.parse(approval.args);
    const { POST } = await import("@/app/api/activities/[id]/send/route");
    await routeResult(await POST(internalJsonRequest(request, { activityVersion: args.activityVersion, message: args.message, notifyGuardians: args.audience !== "staff", notifyStaff: args.audience !== "guardians", confirmSchoolWide: args.schoolWide, idempotencyKey: randomUUID() }, timeZone), { params: Promise.resolve({ id: args.activityId }) }));
    return { message: `تم إرسال نشاط «${args.activityName}».`, tool: approval.tool };
  }

  if (approval.tool === "unit_file_delete") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = unitFileDeleteArgs.parse(approval.args);
    const { DELETE } = await import("@/app/api/units/[id]/files/[fileId]/route");
    await routeResult(await DELETE(internalJsonRequest(request, {}, timeZone, { method: "DELETE" }), { params: Promise.resolve({ id: args.unitId, fileId: args.fileId }) }));
    return { message: `تم حذف الملف «${args.fileName}» من وحدة «${args.unitName}».`, tool: approval.tool };
  }

  if (approval.tool === "care_review") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = careActionArgs.parse(approval.args);
    if (!args.reviewAction) throw new AssistantActionError("INVALID_ACTION", 422);
    const { POST } = await import("@/app/api/care-reports/[id]/review/route");
    await routeResult(await POST(internalJsonRequest(request, { action: args.reviewAction === "approve" ? "APPROVE" : "REJECT", note: args.note ?? undefined }, timeZone), { params: Promise.resolve({ id: args.reportId }) }));
    return { message: args.reviewAction === "approve" ? `تم اعتماد تقرير «${args.studentName}» وإرساله.` : `تم إرجاع تقرير «${args.studentName}» للمعلمة.`, tool: approval.tool };
  }

  if (approval.tool === "care_edit" || approval.tool === "care_resubmit") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = careActionArgs.parse(approval.args);
    if (args.batchId) throw new AssistantActionError("TEACHER_RESUBMISSION_REQUIRED", 409);
    const current = await prisma.careReport.findFirst({ where: { id: args.reportId, schoolId, deletedAt: null }, select: { id: true, reviewStatus: true } });
    if (!current) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (current.reviewStatus === "APPROVED") throw new AssistantActionError("APPROVED_REPORT_IMMUTABLE", 409);
    await prisma.careReport.update({ where: { id: args.reportId }, data: { ...(args.note ? { note: args.note } : {}), reviewStatus: "PENDING_REVIEW", reviewedAt: null, reviewedById: null, reviewedByName: null, reviewNote: null, guardianNotifiedAt: null } });
    await logAction({ school_id: schoolId, action: `${approval.tool === "care_edit" ? "تعديل" : "إعادة إرسال"} تقرير رعاية عبر المساعد`, entity_type: "care_report", entity_id: args.reportId, entity_name: args.studentName, performed_by: session.user.name ?? "المدير", request });
    return { message: `تم ${approval.tool === "care_edit" ? "تعديل" : "إعادة إرسال"} تقرير «${args.studentName}».`, tool: approval.tool };
  }

  if (approval.tool === "care_delete") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = careActionArgs.parse(approval.args);
    const { DELETE } = await import("@/app/api/care-reports/[id]/route");
    await routeResult(await DELETE(internalJsonRequest(request, {}, timeZone, { method: "DELETE" }), { params: Promise.resolve({ id: args.reportId }) }));
    return { message: `تم حذف تقرير الرعاية للطفل «${args.studentName}».`, tool: approval.tool };
  }

  if (approval.tool === "invoice_create") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = invoiceCreateArgs.parse(approval.args);
    const invoiceRequest = internalJsonRequest(request, {}, timeZone, { headers: { "Idempotency-Key": `assistant-${randomUUID()}` } });
    const response = args.subject === "student"
      ? await (await import("@/app/api/students/[id]/invoice/route")).POST(invoiceRequest, { params: Promise.resolve({ id: args.id }) })
      : await (await import("@/app/api/teachers/[id]/invoice/route")).POST(invoiceRequest, { params: Promise.resolve({ id: args.id }) });
    await routeResult(response);
    return { message: `تم إنشاء فاتورة «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "expense_update") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = expenseUpdateArgs.parse(approval.args);
    const body = { ...(args.newTitle ? { title: args.newTitle } : {}), ...(args.amount !== null ? { amount: args.amount } : {}), ...(args.endDate ? { end_date: args.endDate } : {}) };
    const { PUT } = await import("@/app/api/expenses/[id]/route");
    await routeResult(await PUT(internalJsonRequest(request, body, timeZone, { method: "PUT" }), { params: Promise.resolve({ id: args.id }) }));
    return { message: `تم تعديل المصروف «${args.title}».`, tool: approval.tool };
  }

  if (approval.tool === "expense_stop") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = namedIdArgs.parse(approval.args);
    const { PUT } = await import("@/app/api/expenses/[id]/stop/route");
    await routeResult(await PUT(internalJsonRequest(request, {}, timeZone, { method: "PUT" }), { params: Promise.resolve({ id: args.id }) }));
    return { message: `تم إيقاف المصروف الشهري «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "financial_report") {
    if (!grants(session.permissions, "finance.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = financialReportArgs.parse(approval.args);
    const { POST } = await import("@/app/api/financial-reports/generate/route");
    await routeResult(await POST(internalJsonRequest(request, { type: args.type, period_label: args.periodLabel }, timeZone)));
    return { message: `تم إنشاء التقرير المالي «${args.periodLabel}» وحفظه في قسم التقارير المالية.`, tool: approval.tool };
  }

  if (approval.tool === "finance_opening") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = financeOpeningArgs.parse(approval.args);
    const { PUT } = await import("@/app/api/finance/settings/route");
    await routeResult(await PUT(internalJsonRequest(request, { openingBalance: args.amount, openingBalanceDate: args.date }, timeZone, { method: "PUT" })));
    return { message: "تم تحديث الرصيد الافتتاحي.", tool: approval.tool };
  }

  if (approval.tool === "bulk_renew") {
    if (!grants(session.permissions, "finance.manage") || !grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = bulkStudentArgs.parse(approval.args);
    const { POST } = await import("@/app/api/students/bulk-extend/route");
    const result = await routeResult(await POST(internalJsonRequest(request, { ids: args.ids, mode: "automatic" }, timeZone)));
    return { message: `اكتمل التجديد الجماعي لـ${typeof result.succeeded === "number" ? result.succeeded : args.ids.length} طفل في ${args.label}.`, tool: approval.tool };
  }

  if (approval.tool === "bulk_reminder") {
    if (!grants(session.permissions, "finance.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = bulkStudentArgs.parse(approval.args);
    if (!args.reminderKind) throw new AssistantActionError("INVALID_ACTION", 422);
    const { POST } = await import("@/app/api/reminders/route");
    const result = await routeResult(await POST(internalJsonRequest(request, { kind: args.reminderKind, studentIds: args.ids }, timeZone)));
    return { message: `اكتمل إرسال التذكيرات: نجح ${typeof result.sent === "number" ? result.sent : 0}، وتعذر أو تخطى ${Number(result.failed ?? 0) + Number(result.skipped ?? 0)}.`, tool: approval.tool };
  }

  if (approval.tool === "enrollment_link") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = enrollmentLinkArgs.parse(approval.args);
    const { POST } = await import("@/app/api/enrollment/create-token/route");
    await routeResult(await POST(internalJsonRequest(request, { email: args.email }, timeZone)));
    return { message: `تم إنشاء رابط التسجيل وإرساله إلى ${args.email}.`, tool: approval.tool };
  }

  if (approval.tool === "enrollment_review") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = enrollmentReviewArgs.parse(approval.args);
    const response = args.action === "approve"
      ? await (await import("@/app/api/enrollment/approve/[submission_id]/route")).POST(internalJsonRequest(request, { ...(args.classId ? { class_id: args.classId } : {}) }, timeZone), { params: Promise.resolve({ submission_id: args.submissionId }) })
      : await (await import("@/app/api/enrollment/reject/[submission_id]/route")).POST(internalJsonRequest(request, {}, timeZone), { params: Promise.resolve({ submission_id: args.submissionId }) });
    await routeResult(response);
    return { message: `تم ${args.action === "approve" ? "قبول" : "رفض"} طلب تسجيل «${args.studentName}».`, tool: approval.tool };
  }

  if (approval.tool === "import_confirm") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) throw new AssistantActionError("FORBIDDEN", 403);
    const args = importConfirmArgs.parse(approval.args);
    const { POST } = await import("@/app/api/import/[session_id]/confirm/route");
    const result = await routeResult(await POST(internalJsonRequest(request, {}, timeZone), { params: Promise.resolve({ session_id: args.sessionId }) }));
    return { message: `اكتمل الاستيراد: ${typeof result.imported === "number" ? result.imported : "تمت معالجة"} سجل.`, tool: approval.tool };
  }

  if (approval.tool === "settings_update") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = settingsUpdateArgs.parse(approval.args);
    const { PUT } = await import("@/app/api/settings/route");
    await routeResult(await PUT(internalJsonRequest(request, { [args.field]: args.value }, timeZone, { method: "PUT" })));
    return { message: "تم تحديث إعدادات المنشأة.", tool: approval.tool };
  }

  if (approval.tool === "stage_manage") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = stageManageArgs.parse(approval.args);
    if (args.action === "create") {
      const { POST } = await import("@/app/api/academic-stages/route");
      await routeResult(await POST(internalJsonRequest(request, { nameAr: args.name }, timeZone)));
    } else {
      if (!args.id) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      const { PUT } = await import("@/app/api/academic-stages/[id]/route");
      const body = args.action === "rename" ? { nameAr: args.newName } : { archived: args.action === "archive" };
      await routeResult(await PUT(internalJsonRequest(request, body, timeZone, { method: "PUT" }), { params: Promise.resolve({ id: args.id }) }));
    }
    return { message: `تم ${args.action === "create" ? "إضافة" : args.action === "rename" ? "تعديل" : args.action === "archive" ? "أرشفة" : "استعادة"} المرحلة «${args.name}».`, tool: approval.tool };
  }

  if (approval.tool === "arrival_recipient") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = arrivalRecipientArgs.parse(approval.args);
    const current = await prisma.arrivalRecipientSetting.findMany({ where: { schoolId }, select: { userId: true } });
    const currentIds = current.map((item) => item.userId);
    const selected = currentIds.includes(args.userId);
    if ((args.action === "add" && selected) || (args.action === "remove" && !selected)) throw new AssistantActionError("NO_CHANGE", 409);
    const userIds = args.action === "add" ? Array.from(new Set([...currentIds, args.userId])) : currentIds.filter((id) => id !== args.userId);
    const { PUT } = await import("@/app/api/settings/arrival-recipients/route");
    await routeResult(await PUT(internalJsonRequest(request, { userIds }, timeZone, { method: "PUT" })));
    return { message: `تمت ${args.action === "add" ? "إضافة" : "إزالة"} «${args.accountName}» ${args.action === "add" ? "إلى" : "من"} مستلمي إشعار الوصول.`, tool: approval.tool };
  }

  if (approval.tool === "school_info") {
    if (!grants(session.permissions, "settings.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = schoolInfoArgs.parse(approval.args);
    const data = args.field === "name" ? { name: args.value } : args.field === "contactNumber" ? { contactNumber: args.value } : args.field === "phoneNumber" ? { phoneNumber: args.value } : args.field === "address" ? { address: args.value } : args.field === "commercialRegistration" ? { commercialRegistration: args.value } : { vatNumber: args.value };
    await prisma.school.update({ where: { id: schoolId }, data });
    await logAction({ school_id: schoolId, action: `تحديث معلومات المنشأة عبر المساعد: ${args.field}`, entity_type: "settings", performed_by: session.user.name ?? "المدير", request });
    return { message: "تم تحديث معلومات المنشأة.", tool: approval.tool };
  }

  if (approval.tool === "storage_refresh") {
    if (!grants(session.permissions, "settings.storage")) throw new AssistantActionError("FORBIDDEN", 403);
    const { refreshStorageUsage } = await import("@/lib/storage-usage");
    await refreshStorageUsage(schoolId);
    await logAction({ school_id: schoolId, action: "تحديث حساب مساحة التخزين عبر المساعد", entity_type: "storage", performed_by: session.user.name ?? "المدير", request });
    return { message: "تم تحديث حساب مساحة التخزين.", tool: approval.tool };
  }

  if (approval.tool === "calendar_create") {
    if (!grants(session.permissions, "schedule.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = calendarCreateArgs.parse(approval.args);
    const event = await prisma.calendarEvent.create({
      data: {
        schoolId,
        type: args.type,
        title: args.title,
        startAt: new Date(args.startAt),
        endAt: args.endAt ? new Date(args.endAt) : null,
        allDay: args.allDay,
        teacherId: args.teacherId,
        createdByName: session.user.name ?? "المدير",
        ...(args.classId ? { classes: { create: [{ classId: args.classId }] } } : {}),
      },
    });
    await logAction({
      school_id: schoolId,
      action: `إضافة حدث للتقويم عبر المساعد: ${event.title}`,
      entity_type: "calendar_event",
      entity_id: event.id,
      entity_name: event.title,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تم إنشاء حدث «${event.title}» في التقويم.`, tool: approval.tool };
  }

  if (approval.tool === "expense_create") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = expenseCreateArgs.parse(approval.args);
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          school_id: schoolId,
          title: args.title,
          description: args.description,
          amount: args.amount,
          type: args.type,
          start_date: storedDate(args.startDate),
          end_date: args.endDate ? storedDate(args.endDate) : null,
        },
      });
      await syncExpenseOccurrence(created.id, tx, now);
      return created;
    });
    await logAction({
      school_id: schoolId,
      action: `إضافة مصروف عبر المساعد: ${expense.title}`,
      entity_type: "expense",
      entity_id: expense.id,
      entity_name: expense.title,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تمت إضافة مصروف «${expense.title}».`, tool: approval.tool };
  }

  if (approval.tool === "expense_status") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = expenseStatusArgs.parse(approval.args);
    const updated = await prisma.expenseOccurrence.updateMany({
      where: {
        id: args.occurrenceId,
        school_id: schoolId,
        updated_at: new Date(args.expectedUpdatedAt),
      },
      data: args.status === "PAID"
        ? { status: "PAID", paid_at: now, paid_by: session.user.name ?? session.user.id }
        : { status: "PENDING", paid_at: null, paid_by: null },
    });
    if (updated.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
    const occurrence = await prisma.expenseOccurrence.findFirstOrThrow({
      where: { id: args.occurrenceId, school_id: schoolId },
      select: { expense: { select: { title: true } } },
    });
    await logAction({
      school_id: schoolId,
      action: args.status === "PAID" ? "تحديد استحقاق مصروف كمدفوع عبر المساعد" : "إعادة استحقاق مصروف إلى غير مدفوع عبر المساعد",
      entity_type: "expense_occurrence",
      entity_id: args.occurrenceId,
      entity_name: occurrence.expense.title,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return {
      message: args.status === "PAID" ? "تم تحديد استحقاق المصروف كمدفوع." : "تمت إعادة استحقاق المصروف إلى غير مدفوع.",
      tool: approval.tool,
    };
  }

  if (approval.tool === "payment_reminder") {
    if (!grants(session.permissions, "finance.manage")) throw new AssistantActionError("FORBIDDEN", 403);
    const args = paymentReminderArgs.parse(approval.args);
    const limiter = await rateLimit({
      key: `assistant:payment-reminder:${schoolId}:${session.user.id}`,
      limit: 20,
      windowMs: 60 * 60_000,
    });
    if (limiter.status !== "allowed") throw new AssistantActionError("RATE_LIMITED", limiter.status === "limited" ? 429 : 503);
    const student = await prisma.student.findFirst({
      where: { id: args.studentId, schoolId, deletedAt: null, ...studentClassWhere(session) },
      include: { guardian: true },
    });
    if (!student) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
    if (!student.guardian?.email) throw new AssistantActionError("NO_GUARDIAN_EMAIL", 422);
    const [settings, school] = await Promise.all([
      prisma.settings.findUnique({ where: { schoolId } }),
      prisma.school.findUnique({ where: { id: schoolId } }),
    ]);
    const template = settings?.reminderTemplate
      ?? "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <subscription_fee> تستحق بتاريخ <due_date>. مع تحيات <school_name>";
    const schedule = school ? scheduleFor(school, "student", student.period ?? "MORNING") : null;
    const variables = buildMessageVars({
      student: {
        name: student.name,
        registration_fee: moneyNumber(student.registration_fee),
        cycleFee: student.cycleFee == null ? null : moneyNumber(student.cycleFee),
        enrollmentEndDate: student.enrollmentEndDate,
      },
      guardian: { name: student.guardian.name, name_2: student.guardian.name_2 },
      school: { name: school?.name, checkinTime: schedule?.checkin, checkoutTime: schedule?.checkout },
    });
    const delivery = await sendNotification(
      schoolId,
      student.guardian.name ?? student.name,
      student.guardian.email,
      template,
      variables,
      school?.name ?? "المنشأة",
      "reminder",
      { studentId: student.id },
      school?.email
    );
    if (delivery.status === "no_email") throw new AssistantActionError("NO_GUARDIAN_EMAIL", 422);
    if (delivery.status === "failed") throw new AssistantActionError("DELIVERY_FAILED", 502);
    await logAction({
      school_id: schoolId,
      action: `إرسال تذكير دفع عبر المساعد للطالب: ${student.name}`,
      entity_type: "student",
      entity_id: student.id,
      entity_name: student.name,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تم إرسال تذكير الدفع لولي أمر ${student.name}.`, tool: approval.tool };
  }

  if (approval.tool === "care_policy") {
    if (!grants(session.permissions, "students.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = carePolicyArgs.parse(approval.args);
    const saved = await prisma.settings.upsert({
      where: { schoolId },
      create: { schoolId, careReportReviewRequired: args.reviewRequired },
      update: { careReportReviewRequired: args.reviewRequired },
      select: { careReportReviewRequired: true },
    });
    await logAction({
      school_id: schoolId,
      action: saved.careReportReviewRequired
        ? "تفعيل مراجعة تقارير الرعاية عبر المساعد"
        : "تفعيل الإرسال المباشر لتقارير الرعاية عبر المساعد",
      entity_type: "settings",
      performed_by: session.user.name ?? "الإدارة",
      request,
    });
    return {
      message: saved.careReportReviewRequired
        ? "تم تفعيل مراجعة تقارير الرعاية قبل الإرسال."
        : "تم تفعيل الإرسال المباشر لتقارير الرعاية.",
      tool: approval.tool,
    };
  }

  if (approval.tool === "class_create") {
    if (!grants(session.permissions, "classes.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = classCreateArgs.parse(approval.args);
    const duplicate = await prisma.class.findFirst({
      where: { schoolId, name: { equals: args.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw new AssistantActionError("DUPLICATE_RECORD", 409);
    try {
      await assertClassCapacity(schoolId);
    } catch (error) {
      if (error instanceof PlanLimitError) throw new AssistantActionError("PLAN_LIMIT", 409);
      throw error;
    }
    const created = await prisma.class.create({
      data: {
        schoolId,
        name: args.name,
        period: args.period,
        needsTeacherWarning: true,
      },
    });
    await logAction({
      school_id: schoolId,
      action: `إضافة فصل جديد عبر المساعد: ${created.name}`,
      entity_type: "class",
      entity_id: created.id,
      entity_name: created.name,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return { message: `تم إنشاء فصل «${created.name}».`, tool: approval.tool };
  }

  if (approval.tool === "restore_record") {
    const args = restoreArgs.parse(approval.args);
    const permission = args.recordType === "student"
      ? "students.archive"
      : args.recordType === "staff"
        ? "staff.archive"
        : "classes.archive";
    if (!grants(session.permissions, permission)) throw new AssistantActionError("FORBIDDEN", 403);

    let restoredName: string;
    let needsReassignment = false;
    if (args.recordType === "student") {
      const record = await prisma.student.findFirst({
        where: { id: args.recordId, schoolId, deletedAt: { not: null }, ...studentClassWhere(session) },
        select: { id: true, name: true, classId: true },
      });
      if (!record) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      const updateData: { deletedAt: null; classId?: null; needsClassWarning?: boolean } = { deletedAt: null };
      if (record.classId) {
        const room = await prisma.class.findFirst({ where: { id: record.classId, schoolId }, select: { deletedAt: true } });
        if (!room || room.deletedAt) {
          updateData.classId = null;
          updateData.needsClassWarning = true;
          needsReassignment = true;
        }
      }
      const restored = await prisma.student.updateMany({ where: { id: record.id, schoolId, deletedAt: { not: null } }, data: updateData });
      if (restored.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
      restoredName = record.name;
    } else if (args.recordType === "staff") {
      const record = await prisma.teacher.findFirst({
        where: { id: args.recordId, schoolId, deletedAt: { not: null } },
        select: { id: true, name: true },
      });
      if (!record) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      const restored = await prisma.teacher.updateMany({ where: { id: record.id, schoolId, deletedAt: { not: null } }, data: { deletedAt: null } });
      if (restored.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
      restoredName = record.name;
    } else {
      const record = await prisma.class.findFirst({
        where: { id: args.recordId, schoolId, deletedAt: { not: null } },
        select: { id: true, name: true },
      });
      if (!record) throw new AssistantActionError("SUBJECT_NOT_FOUND", 404);
      const restored = await prisma.class.updateMany({ where: { id: record.id, schoolId, deletedAt: { not: null } }, data: { deletedAt: null } });
      if (restored.count !== 1) throw new AssistantActionError("STALE_RECORD", 409);
      restoredName = record.name;
    }
    await logAction({
      school_id: schoolId,
      action: `استعادة من سلة المحذوفات عبر المساعد: ${restoredName}`,
      entity_type: args.recordType,
      entity_id: args.recordId,
      entity_name: restoredName,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return {
      message: `تمت استعادة «${restoredName}» من سلة المحذوفات${needsReassignment ? "، ويحتاج إلى إعادة تعيين فصل" : ""}.`,
      tool: approval.tool,
    };
  }

  if (approval.tool === "broadcast_create") {
    if (!grants(session.permissions, "schedule.manage") || scopedClassIds(session) !== null) {
      throw new AssistantActionError("FORBIDDEN", 403);
    }
    const args = broadcastArgs.parse(approval.args);
    const limiter = await rateLimit({
      key: `assistant:broadcast:${schoolId}:${session.user.id}`,
      limit: 5,
      windowMs: 60 * 60_000,
    });
    if (limiter.status !== "allowed") throw new AssistantActionError("RATE_LIMITED", limiter.status === "limited" ? 429 : 503);
    const notifyGuardians = args.audience !== "staff";
    const notifyStaff = args.audience !== "guardians";
    const requestHash = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const idempotencyKey = randomUUID();
    const outcome = await prisma.$transaction(async (tx) => {
      const [guardianAccounts, users] = await Promise.all([
        notifyGuardians
          ? tx.guardianAccount.findMany({
              where: {
                schoolId,
                disabledAt: null,
                acceptedAt: { not: null },
                notifyCalendar: true,
                guardian: { is: { schoolId, deletedAt: null, anonymizedAt: null } },
              },
              select: { id: true },
            })
          : [],
        notifyStaff
          ? tx.user.findMany({
              where: { schoolId, disabledAt: null, acceptedAt: { not: null }, notifyCalendar: true },
              select: { id: true },
            })
          : [],
      ]);
      if (guardianAccounts.length + users.length === 0) {
        throw new AssistantActionError("NO_ELIGIBLE_RECIPIENTS", 422);
      }
      const event = await tx.calendarEvent.create({
        data: {
          schoolId,
          type: "ANNOUNCEMENT",
          title: args.title,
          description: args.message,
          startAt: storedDate(args.date),
          endAt: null,
          allDay: true,
          createdByName: session.user.name ?? "المدير",
        },
      });
      const message = await tx.activityMessage.create({
        data: {
          schoolId,
          calendarEventId: event.id,
          body: args.message,
          idempotencyKey,
          requestHash,
          targetRevision: event.updatedAt,
          guardianRecipientCount: guardianAccounts.length,
          staffRecipientCount: users.length,
          createdById: session.user.id,
          recipients: {
            create: [
              ...guardianAccounts.map((account) => ({ guardianAccountId: account.id })),
              ...users.map((user) => ({ userId: user.id })),
            ],
          },
        },
        select: { id: true },
      });
      const targets: PushTarget[] = [
        ...guardianAccounts.map((account) => ({ schoolId, guardianAccountId: account.id })),
        ...users.map((user) => ({ schoolId, userId: user.id })),
      ];
      return { event, messageId: message.id, targets, guardians: guardianAccounts.length, staff: users.length };
    });
    const pushes = await Promise.allSettled(outcome.targets.map((target) => enqueuePush(target, {
      title: outcome.event.title,
      body: "لديك إعلان جديد داخل التطبيق",
      data: {
        screen: "announcement-message",
        calendarEventId: outcome.event.id,
        messageId: outcome.messageId,
      },
    })));
    let pushQueued = 0;
    let pushFailures = 0;
    for (const result of pushes) {
      if (result.status === "fulfilled") pushQueued += result.value;
      else pushFailures += 1;
    }
    await prisma.activityMessage.update({
      where: { id: outcome.messageId },
      data: { pushQueuedCount: pushQueued, pushFailureCount: pushFailures, pushProcessedAt: new Date() },
    });
    await logAction({
      school_id: schoolId,
      action: `إنشاء وإرسال إعلان عام عبر المساعد: ${outcome.event.title}`,
      entity_type: "calendar_event",
      entity_id: outcome.event.id,
      entity_name: outcome.event.title,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return {
      message: `تم إرسال الإعلان إلى ${outcome.guardians} من أولياء الأمور و${outcome.staff} من الموظفين. أُضيف ${pushQueued} إشعار جهاز إلى قائمة الإرسال${pushFailures ? ` وتعذر تجهيز ${pushFailures}` : ""}.`,
      tool: approval.tool,
    };
  }

  throw new AssistantActionError("TOOL_NOT_AVAILABLE", 404);
}

