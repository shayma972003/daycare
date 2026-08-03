/**
 * Irreversible removal of personal data from records whose retention period has
 * expired.
 *
 * The single rule this file obeys: **nothing is deleted, only de-identified.**
 * The row stays, its statistical dimensions stay, its invoices and attendance
 * stay. What leaves is every field that points at a specific child or family.
 * A sector report built on this data must keep working after a sweep; a person
 * must not be findable in it.
 *
 * That distinction is also why this is not `deleteMany`. Deleting a departed
 * child would silently rewrite last year's occupancy and revenue figures —
 * history would change every night — and would break the financial records the
 * nursery is separately obliged to keep.
 *
 * Terminology, precisely: this is **pseudonymisation**, not anonymisation in the
 * strict legal sense. `analyticsId` still sits in the same database as the row
 * it describes. Do not describe the output as "fully anonymous" in a contract.
 * See D7.2 in خطة-التنفيذ.md and docs/DATA_LIFECYCLE.md.
 */

import { prisma } from "@/lib/prisma";
import {
  getRetentionPolicy,
  monthsBetween,
  astYear,
  toNationalityCode,
  SYSTEM_SETTINGS_ID,
} from "@/lib/data-retention";
import { discardFilesOwnedBy } from "@/lib/stored-files";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Bounded per run so one invocation cannot exceed the function timeout.
 *
 * Whatever is left over is picked up tomorrow; the records are already past
 * their date, and a sweep that times out halfway is worse than one that takes
 * two nights. Same reasoning as the trash purge.
 */
const BATCH_SIZE = 200;

/**
 * Transaction budget for one record.
 *
 * Prisma's interactive transactions default to a 5-second limit, which is not
 * enough here: a child enrolled for years can carry dozens of invoices — each
 * one rewriting a base64 PDF column — plus every notification and activity-log
 * row ever written about them. Hitting the default would roll the record back
 * and leave it stuck in the queue for ever, failing again every night.
 */
const TX_OPTIONS = { timeout: 60_000, maxWait: 15_000 };

/**
 * The `name` columns are NOT NULL, so they cannot simply be cleared — every
 * screen, invoice list and export would render an empty cell with no
 * explanation. They are replaced with a label carrying a short slice of
 * `analyticsId`: still non-identifying, but stable, greppable, and enough to
 * tell two anonymised records apart in a UI.
 */
function pseudonym(prefix: string, analyticsId: string): string {
  return `${prefix}-${analyticsId.slice(0, 8)}`;
}

export interface AnonymizationResult {
  students: number;
  teachers: number;
  guardians: number;
  failures: number;
  skipped: boolean;
}

/**
 * Keys removed from `Invoice.data` when its subject is anonymised.
 *
 * The invoice itself survives untouched in every way that matters to
 * accounting — amount, VAT, dates, invoice number, the FK to the (now
 * anonymised) student row. What goes is the denormalised copy of the child's
 * and family's identity that the PDF generator wrote into the JSON.
 *
 * An explicit list, checked against a regex fallback below. A pure allow-list
 * was rejected because a new finance field added later would be silently
 * dropped from historical invoices; a pure deny-list was rejected because a new
 * PII field would be silently kept. Both run.
 */
const INVOICE_PII_KEYS = new Set([
  "studentName",
  "studentId",
  "guardianName",
  "guardianPhone",
  "guardianEmail",
  "guardianName2",
  "teacherName",
  "teacherId",
  "nationalId",
  "idNumber",
  "phone",
  "phone1",
  "phone2",
  "email",
  "address",
  "dateOfBirth",
  "nationality",
]);

/**
 * Catches PII keys the list above has not been taught yet.
 *
 * `schoolName` and `className` are exempt: they name an organisation and a room,
 * not a person, and an invoice without them is unusable as an accounting
 * document.
 */
const INVOICE_PII_PATTERN = /(name|phone|mobile|email|address|nationalid|idnumber|birth)/i;
const INVOICE_KEY_EXEMPTIONS = new Set(["schoolName", "className", "itemName", "planName"]);

function isPiiKey(key: string): boolean {
  if (INVOICE_KEY_EXEMPTIONS.has(key)) return false;
  return INVOICE_PII_KEYS.has(key) || INVOICE_PII_PATTERN.test(key);
}

/** Recursive so nested line items and detail objects are covered too. */
function scrubInvoiceData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubInvoiceData);

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isPiiKey(key)) continue;
      out[key] = scrubInvoiceData(child);
    }
    return out;
  }

  return value;
}

/**
 * Strips identity from a subject's invoices without touching their money.
 *
 * `pdfUrl` holds a rendered document as a base64 data URI — the child's name is
 * inside those bytes, so the JSON scrub alone would leave the PII intact one
 * column over. The PDF is dropped; the figures needed to re-issue it remain in
 * `data`, and `amount`/`vat_amount` are columns the scrub never reaches.
 */
async function scrubInvoices(
  tx: Prisma.TransactionClient,
  where: { studentId: string } | { teacherId: string },
  subjectRef: string
): Promise<number> {
  const invoices = await tx.invoice.findMany({
    where,
    select: { id: true, data: true },
  });

  for (const invoice of invoices) {
    const scrubbed = scrubInvoiceData(invoice.data) as Record<string, unknown>;
    // Leaves a trail on the document itself: an auditor reading this invoice can
    // see why the name is missing, and which pseudonymous subject it belongs to.
    scrubbed.anonymized = true;
    scrubbed.subjectRef = subjectRef;

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { data: scrubbed as Prisma.InputJsonValue, pdfUrl: null },
    });
  }

  return invoices.length;
}

/** Body of a notification once its subject has been anonymised. */
const REDACTED_CONTENT = "[أُزيل المحتوى بعد انتهاء مدة الاحتفاظ]";

/**
 * Recipient placeholder. Not the subject's pseudonym: the recipient of a payment
 * reminder is the guardian, not the child, so stamping the child's handle here
 * would assert a false fact about who was contacted.
 */
const REDACTED_RECIPIENT = "[مُزال]";

/**
 * Clears the copies of a name that live in the two log tables.
 *
 * Both tables quote the person in free text — `NotificationLog.content` is the
 * message that was actually sent ("رسوم <child> مستحقة…") and
 * `ActivityLog.action` is a sentence built around the name. Clearing the profile
 * while leaving these behind would mean the record is reported as anonymised
 * while the name is still sitting one table over, readable from the audit screen.
 *
 * `action` is rewritten rather than emptied: an audit trail that loses *what
 * happened* is worse than one that loses *to whom*. The name is substituted with
 * the pseudonym, so the sentence still reads and still links to the record.
 *
 * Historical notification rows carry no subject id (see the migration note) and
 * are left alone deliberately — matching them by name would scrub a different,
 * still-enrolled family's log the moment two children share a first name.
 */
async function scrubLogs(
  tx: Prisma.TransactionClient,
  options: {
    entityType: "student" | "teacher";
    entityId: string;
    previousName: string;
    replacement: string;
  }
): Promise<void> {
  const { entityType, entityId, previousName, replacement } = options;

  await tx.notificationLog.updateMany({
    where: entityType === "student" ? { studentId: entityId } : { teacherId: entityId },
    data: { recipientName: REDACTED_RECIPIENT, content: REDACTED_CONTENT },
  });

  const entries = await tx.activityLog.findMany({
    where: { entity_type: entityType, entity_id: entityId },
    select: { id: true, action: true },
  });

  for (const entry of entries) {
    await tx.activityLog.update({
      where: { id: entry.id },
      data: {
        entity_name: replacement,
        action: previousName
          ? entry.action.split(previousName).join(replacement)
          : entry.action,
      },
    });
  }
}

/**
 * Clears one child's personal data.
 *
 * Ordering matters: every analytics dimension is derived *before* the field it
 * derives from is destroyed. Age comes from `dateOfBirth`, which is about to be
 * null — get it wrong and the most valuable column in the future sector report
 * is gone with no way to recompute it.
 *
 * Runs in a transaction so a record can never end up half-cleared: either the
 * personal fields, the invoices and the audit row all land, or none do.
 */
export async function anonymizeStudent(
  studentId: string,
  executedBy = "SYSTEM"
): Promise<void> {
  const policy = await getRetentionPolicy();

  /**
   * Set inside the transaction, acted on after it commits.
   *
   * Objects cannot be deleted inside the transaction: a rollback would restore
   * the row and leave a child's record pointing at files that no longer exist.
   * Deleting after the commit can only fail the other way — a surviving object
   * with nothing referencing it, which the sweep reports as `fatal` and can
   * retry, rather than data destroyed for a record that stayed identified.
   */
  let filesOwnedBy: { schoolId: string } | null = null;

  await prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student || student.anonymizedAt) return;

    filesOwnedBy = { schoolId: student.schoolId };

    const clearedFields: string[] = [];
    const data: Prisma.StudentUpdateInput = {};

    /** Records the column name only — never the value that was in it. */
    const clear = <K extends keyof Prisma.StudentUpdateInput>(
      field: K,
      current: unknown,
      value: Prisma.StudentUpdateInput[K]
    ) => {
      if (current === null || current === undefined || current === "") return;
      data[field] = value;
      clearedFields.push(field as string);
    };

    // ---- Derive first, destroy second -------------------------------------
    const enrolledAt = student.enrollment_date ?? student.registrationDate;

    if (student.ageAtEnrollmentMonths === null && student.dateOfBirth) {
      data.ageAtEnrollmentMonths = monthsBetween(student.dateOfBirth, enrolledAt);
    }
    if (student.nationalityCode === null && student.nationality) {
      data.nationalityCode = toNationalityCode(student.nationality);
    }
    if (student.enrollmentYear === null) {
      data.enrollmentYear = astYear(enrolledAt);
    }
    if (student.leftYear === null && student.leftAt) {
      data.leftYear = astYear(student.leftAt);
    }

    // ---- Direct identifiers -----------------------------------------------
    const replacementName = pseudonym("طفل", student.analyticsId);
    data.name = replacementName;
    clearedFields.push("name");

    clear("idNumber", student.idNumber, null);
    clear("encryptedIdNumber", student.encryptedIdNumber, null);
    clear("idNumberHash", student.idNumberHash, null);
    clear("dateOfBirth", student.dateOfBirth, null);
    clear("nationality", student.nationality, null);

    // ---- Sensitive: health -------------------------------------------------
    // A special category under PDPL. Cleared unconditionally, and never carried
    // into the analytics columns in any form.
    clear("healthCondition", student.healthCondition, null);
    clear("allergies", student.allergies, null);

    // ---- Files -------------------------------------------------------------
    // Nulling the column is only half of it now that uploads live in R2: the
    // objects themselves are deleted after this transaction commits, by owner id
    // rather than by column, so a care-report photo is caught along with the
    // avatar. See the end of this function (task D3.11).
    clear("avatarUrl", student.avatarUrl, null);
    clear("evaluationFileUrl", student.evaluationFileUrl, null);
    clear("evaluationFileName", student.evaluationFileName, null);
    clear("additionalFile", student.additionalFile, null);

    data.anonymizedAt = new Date();

    await tx.student.update({ where: { id: studentId }, data });

    // Invoices keep their figures and their FK to this row, which is now a
    // pseudonymous record — exactly the "financial history without identity"
    // the policy calls for.
    await scrubInvoices(tx, { studentId }, student.analyticsId);

    await scrubLogs(tx, {
      entityType: "student",
      entityId: studentId,
      previousName: student.name,
      replacement: replacementName,
    });
    clearedFields.push("notificationLog.content", "activityLog.entity_name");

    /**
     * Daily care reports.
     *
     * `note` is free text a teacher wrote about this specific child, and the
     * medication and symptom fields are health data — a special category under
     * PDPL. The statistical shape of the day is kept: which type, when, how much
     * was eaten, how long the nap was. That is what the sector reports are built
     * from, and none of it identifies anyone once the child's record is
     * pseudonymous.
     *
     * `photoUrl` is cleared here and the object behind it is deleted after the
     * transaction commits, with the rest of this child's files.
     */
    const scrubbedReports = await tx.careReport.updateMany({
      where: { studentId },
      data: {
        note: null,
        photoUrl: null,
        medicationName: null,
        medicationDose: null,
        givenByName: null,
        symptom: null,
        actionTaken: null,
        toiletState: null,
        napQuality: null,
        supplyItem: null,
        reportedByName: "—",
      },
    });
    if (scrubbedReports.count > 0) {
      clearedFields.push("careReport.note", "careReport.health");
    }

    await tx.anonymizationLog.create({
      data: {
        entityType: "STUDENT",
        entityId: studentId,
        analyticsId: student.analyticsId,
        schoolId: student.schoolId,
        executedBy,
        clearedFieldCount: clearedFields.length,
        clearedFields,
        retentionYears: policy.studentRetentionYears,
      },
    });

    // The family record is shared with siblings, so it is handled separately and
    // only when nobody is left who still needs it.
    if (student.guardianId) {
      await anonymizeGuardianIfOrphaned(tx, student.guardianId, executedBy);
    }
  }, TX_OPTIONS);

  /**
   * The photograph, not the pointer to it (task D3.11).
   *
   * This is the step whose absence would make the whole feature a lie: a record
   * with every column blanked, and the child's face still sitting in a bucket
   * indefinitely. It reports a `fatal` if any object survives, because "mostly
   * erased" is not a state anyone should have to discover later.
   */
  if (filesOwnedBy) {
    await discardFilesOwnedBy(
      (filesOwnedBy as { schoolId: string }).schoolId,
      [studentId],
      "anonymization.student"
    );
  }
}

/**
 * Clears a guardian only once every child linked to them has been anonymised.
 *
 * Guardians are shared across siblings in this schema, and children leave years
 * apart. Clearing on the first departure would blank the emergency contact of a
 * brother or sister still enrolled — a safety problem, not just a data one.
 */
async function anonymizeGuardianIfOrphaned(
  tx: Prisma.TransactionClient,
  guardianId: string,
  executedBy: string
): Promise<void> {
  const guardian = await tx.guardian.findUnique({ where: { id: guardianId } });
  if (!guardian || guardian.anonymizedAt) return;

  const stillIdentified = await tx.student.count({
    where: { guardianId, anonymizedAt: null },
  });
  if (stillIdentified > 0) return;

  const clearedFields = [
    "name",
    ...(["phone1", "phone2", "email", "name_2", "phone_3", "phone_4", "email_2"] as const).filter(
      (f) => guardian[f]
    ),
  ];

  await tx.guardian.update({
    where: { id: guardianId },
    data: {
      name: pseudonym("ولي أمر", guardianId),
      phone1: null,
      phone2: null,
      email: null,
      name_2: null,
      phone_3: null,
      phone_4: null,
      email_2: null,
      anonymizedAt: new Date(),
    },
  });

  await tx.anonymizationLog.create({
    data: {
      entityType: "GUARDIAN",
      entityId: guardianId,
      schoolId: guardian.schoolId,
      executedBy,
      clearedFieldCount: clearedFields.length,
      clearedFields,
    },
  });
}

/**
 * Clears one staff member's personal data.
 *
 * Qualifications are deliberately kept. They describe a category of training,
 * not a person, and workforce composition is one of the headline figures the
 * sector reports are meant to produce. They are free text, so the legal review
 * (D7.4) should confirm the columns hold no incidental identifiers before any
 * report built on them is published.
 */
export async function anonymizeTeacher(
  teacherId: string,
  executedBy = "SYSTEM"
): Promise<void> {
  const policy = await getRetentionPolicy();

  /** Acted on after the commit — see the note in `anonymizeStudent`. */
  let filesOwnedBy: { schoolId: string } | null = null;

  await prisma.$transaction(async (tx) => {
    const teacher = await tx.teacher.findUnique({ where: { id: teacherId } });
    if (!teacher || teacher.anonymizedAt) return;

    filesOwnedBy = { schoolId: teacher.schoolId };

    const clearedFields: string[] = [];
    const data: Prisma.TeacherUpdateInput = {};

    const clear = <K extends keyof Prisma.TeacherUpdateInput>(
      field: K,
      current: unknown,
      value: Prisma.TeacherUpdateInput[K]
    ) => {
      if (current === null || current === undefined || current === "") return;
      data[field] = value;
      clearedFields.push(field as string);
    };

    if (teacher.ageAtHireMonths === null && teacher.dateOfBirth) {
      data.ageAtHireMonths = monthsBetween(teacher.dateOfBirth, teacher.joinDate);
    }
    if (teacher.nationalityCode === null && teacher.nationality) {
      data.nationalityCode = toNationalityCode(teacher.nationality);
    }
    if (teacher.hireYear === null) {
      data.hireYear = astYear(teacher.joinDate);
    }
    if (teacher.leftYear === null && teacher.leftAt) {
      data.leftYear = astYear(teacher.leftAt);
    }

    const replacementName = pseudonym("موظف", teacher.analyticsId);
    data.name = replacementName;
    clearedFields.push("name");

    clear("idNumber", teacher.idNumber, null);
    clear("encryptedIdNumber", teacher.encryptedIdNumber, null);
    clear("idNumberHash", teacher.idNumberHash, null);
    clear("dateOfBirth", teacher.dateOfBirth, null);
    clear("nationality", teacher.nationality, null);
    clear("email", teacher.email, null);
    clear("phone1", teacher.phone1, null);
    clear("phone2", teacher.phone2, null);

    data.anonymizedAt = new Date();

    await tx.teacher.update({ where: { id: teacherId }, data });

    // Salary invoices stay — payroll history is an accounting record — with the
    // name removed from the JSON and the rendered PDF dropped entirely.
    await scrubInvoices(tx, { teacherId }, teacher.analyticsId);

    await scrubLogs(tx, {
      entityType: "teacher",
      entityId: teacherId,
      previousName: teacher.name,
      replacement: replacementName,
    });
    clearedFields.push("notificationLog.content", "activityLog.entity_name");

    await tx.anonymizationLog.create({
      data: {
        entityType: "TEACHER",
        entityId: teacherId,
        analyticsId: teacher.analyticsId,
        schoolId: teacher.schoolId,
        executedBy,
        clearedFieldCount: clearedFields.length,
        clearedFields,
        retentionYears: policy.employeeRetentionYears,
      },
    });
  }, TX_OPTIONS);

  // Scanned identity documents and staff photos, deleted from the bucket rather
  // than merely unlinked (task D3.11).
  if (filesOwnedBy) {
    await discardFilesOwnedBy(
      (filesOwnedBy as { schoolId: string }).schoolId,
      [teacherId],
      "anonymization.teacher"
    );
  }
}

/**
 * The nightly pass: find everything past its retention date and clear it.
 *
 * Each record is isolated in its own try/catch. One malformed row — a legacy
 * invoice with unexpected JSON, say — must not abort the run and leave the rest
 * of the queue sitting past its legal expiry, which is exactly how the trash
 * purge silently did nothing for months.
 */
export async function runAnonymizationSweep(
  options: { now?: Date; executedBy?: string; limit?: number } = {}
): Promise<AnonymizationResult> {
  const now = options.now ?? new Date();
  const executedBy = options.executedBy ?? "SYSTEM";
  const limit = options.limit ?? BATCH_SIZE;

  const policy = await getRetentionPolicy();
  const result: AnonymizationResult = {
    students: 0,
    teachers: 0,
    guardians: 0,
    failures: 0,
    skipped: false,
  };

  // The kill switch is honoured here rather than at the route, so a manual run
  // cannot bypass a legal hold either.
  if (!policy.anonymizationEnabled) {
    console.warn("[anonymization] disabled by SystemSettings — nothing swept");
    return { ...result, skipped: true };
  }

  const dueStudents = await prisma.student.findMany({
    where: { anonymizedAt: null, retentionUntil: { not: null, lte: now } },
    select: { id: true },
    orderBy: { retentionUntil: "asc" },
    take: limit,
  });

  for (const student of dueStudents) {
    try {
      await anonymizeStudent(student.id, executedBy);
      result.students++;
    } catch (error) {
      result.failures++;
      console.error(`[anonymization] student ${student.id} failed:`, error);
    }
  }

  const dueTeachers = await prisma.teacher.findMany({
    where: { anonymizedAt: null, retentionUntil: { not: null, lte: now } },
    select: { id: true },
    orderBy: { retentionUntil: "asc" },
    take: limit,
  });

  for (const teacher of dueTeachers) {
    try {
      await anonymizeTeacher(teacher.id, executedBy);
      result.teachers++;
    } catch (error) {
      result.failures++;
      console.error(`[anonymization] teacher ${teacher.id} failed:`, error);
    }
  }

  // Guardians are cleared as a side effect of their last child, but a family
  // whose children were anonymised before this feature existed — or by a run
  // that failed after the student update — would never be reached. This pass
  // closes that gap.
  const orphanedGuardians = await prisma.guardian.findMany({
    where: {
      anonymizedAt: null,
      students: { some: {}, every: { anonymizedAt: { not: null } } },
    },
    select: { id: true },
    take: limit,
  });

  for (const guardian of orphanedGuardians) {
    try {
      await prisma.$transaction((tx) =>
        anonymizeGuardianIfOrphaned(tx, guardian.id, executedBy)
      );
      result.guardians++;
    } catch (error) {
      result.failures++;
      console.error(`[anonymization] guardian ${guardian.id} failed:`, error);
    }
  }

  await prisma.systemSettings.update({
    where: { id: SYSTEM_SETTINGS_ID },
    data: {
      lastSweepAt: now,
      lastSweepProcessed: result.students + result.teachers + result.guardians,
    },
  });

  console.log("[anonymization] done:", result);
  return result;
}
