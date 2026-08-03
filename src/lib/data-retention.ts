/**
 * Retention policy: how long personal data may be kept, and when the clock
 * starts.
 *
 * This module is deliberately non-destructive — it only reads the policy and
 * computes dates. The service that actually clears fields lives in
 * `src/lib/anonymization.ts`. Keeping them apart means the lifecycle maths can
 * be called from ordinary write paths (a profile edit, a bulk status change)
 * without dragging in anything that can destroy data.
 *
 * See docs/DATA_LIFECYCLE.md for the policy this implements.
 */

import { prisma } from "@/lib/prisma";
import { astDayStart, astParts } from "@/lib/datetime";
import type { StudentStatus, EmploymentStatus } from "@/generated/prisma/enums";

/** Pinned id of the single SystemSettings row. */
export const SYSTEM_SETTINGS_ID = "global";

/**
 * Bounds on the configurable period.
 *
 * The floor is not arbitrary: Saudi bookkeeping obligations mean a nursery is
 * still answerable for a child's file for years after they leave, and a
 * one-year policy would destroy the context behind invoices it must still hold.
 * The ceiling exists because "keep forever" is exactly what PDPL forbids — an
 * unbounded input here would quietly turn the whole mechanism off.
 */
export const MIN_RETENTION_YEARS = 3;
export const MAX_RETENTION_YEARS = 15;

export interface RetentionPolicy {
  studentRetentionYears: number;
  employeeRetentionYears: number;
  anonymizationEnabled: boolean;
  lastSweepAt: Date | null;
  lastSweepProcessed: number;
}

/**
 * Reads the policy, creating the singleton if it is somehow missing.
 *
 * The migration seeds the row, so the upsert is a safety net for databases
 * restored from an older dump — not the normal path. Failing closed (throwing)
 * here would take down every student edit; falling back to the documented
 * defaults keeps the app running with the same numbers the migration wrote.
 */
export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const row = await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {},
    create: { id: SYSTEM_SETTINGS_ID, updatedBy: "system" },
  });

  return {
    studentRetentionYears: row.studentRetentionYears,
    employeeRetentionYears: row.employeeRetentionYears,
    anonymizationEnabled: row.anonymizationEnabled,
    lastSweepAt: row.lastSweepAt,
    lastSweepProcessed: row.lastSweepProcessed,
  };
}

/** Rejects out-of-range periods before they reach the database. */
export function isValidRetentionYears(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_RETENTION_YEARS &&
    value <= MAX_RETENTION_YEARS
  );
}

/**
 * The instant a departed record's personal data expires.
 *
 * Anchored to the start of the AST business day so the sweep — which runs at a
 * fixed hour — treats every record on a given calendar day identically. Using
 * the raw timestamp would make a child who left at 23:00 survive a day longer
 * than one who left at 08:00 on the same date.
 *
 * `setUTCFullYear` handles the 29 February case the way the calendar does: a
 * departure on 29 Feb 2028 with a 5-year period lands on 1 March 2033 rather
 * than throwing or silently rolling back a year.
 */
export function computeRetentionUntil(leftAt: Date, years: number): Date {
  const anchor = astDayStart(leftAt);
  const expiry = new Date(anchor.getTime());
  expiry.setUTCFullYear(expiry.getUTCFullYear() + years);
  return expiry;
}

/** Calendar year of an instant, in AST — the year the analytics layer reports. */
export function astYear(at: Date): number {
  return astParts(at).year;
}

/**
 * Whole months between two dates, floored at zero.
 *
 * Months, not years: infants are the fastest-moving cohort in a nursery
 * (0-6m and 6-12m are different rooms, different ratios, different fees), and
 * rounding them all to "0 years" would erase the distinction the sector reports
 * exist to show.
 */
export function monthsBetween(from: Date, to: Date): number {
  const a = astParts(from);
  const b = astParts(to);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day < a.day) months -= 1;
  return Math.max(0, months);
}

/**
 * Free-text nationality → stable code.
 *
 * The column accepts anything a receptionist types, so "سعودي", "سعودية",
 * "السعودية" and "Saudi" are four different strings describing one cohort. An
 * aggregate grouped on the raw column splits that cohort four ways and reports
 * nonsense. Unknown values are slugged rather than dropped: a nationality on its
 * own does not identify anyone, and discarding it would lose a real dimension.
 */
const NATIONALITY_CODES: Record<string, string> = {
  "سعودي": "SA",
  "سعودية": "SA",
  "السعودية": "SA",
  "saudi": "SA",
  "مصري": "EG",
  "مصرية": "EG",
  "مصر": "EG",
  "egyptian": "EG",
  "يمني": "YE",
  "يمنية": "YE",
  "اليمن": "YE",
  "سوري": "SY",
  "سورية": "SY",
  "سوريا": "SY",
  "أردني": "JO",
  "اردني": "JO",
  "أردنية": "JO",
  "الأردن": "JO",
  "سوداني": "SD",
  "سودانية": "SD",
  "السودان": "SD",
  "فلسطيني": "PS",
  "فلسطينية": "PS",
  "فلسطين": "PS",
  "باكستاني": "PK",
  "باكستانية": "PK",
  "هندي": "IN",
  "هندية": "IN",
  "بنغلاديشي": "BD",
  "فلبيني": "PH",
  "فلبينية": "PH",
  "لبناني": "LB",
  "لبنانية": "LB",
  "عراقي": "IQ",
  "عراقية": "IQ",
  "كويتي": "KW",
  "بحريني": "BH",
  "إماراتي": "AE",
  "اماراتي": "AE",
  "عماني": "OM",
  "قطري": "QA",
  "تونسي": "TN",
  "مغربي": "MA",
  "جزائري": "DZ",
  "صومالي": "SO",
  "إثيوبي": "ET",
  "تركي": "TR",
  "أفغاني": "AF",
  "نيجيري": "NG",
  "أخرى": "OTHER",
  "other": "OTHER",
};

export function toNationalityCode(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = NATIONALITY_CODES[trimmed] ?? NATIONALITY_CODES[trimmed.toLowerCase()];
  if (direct) return direct;

  // Already a code (two-letter ISO or the OTHER sentinel).
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  return trimmed
    .toUpperCase()
    .replace(/\s+/g, "_")
    .slice(0, 32);
}

/**
 * Field updates that move a student out of the active population.
 *
 * Returned as a plain object rather than written here so the caller can fold it
 * into the transaction it is already running — a departure is usually part of a
 * wider profile update, and splitting it into a second write would leave the
 * record classified but with no retention date if the request died in between.
 *
 * Passing `ACTIVE` reverses a departure: a child who returns must not keep an
 * expiry date ticking against them.
 */
export interface StudentDeparture {
  status: StudentStatus;
  leftAt: Date | null;
  retentionUntil: Date | null;
  leftYear: number | null;
  isActive?: boolean;
}

export function buildStudentDeparture(
  status: StudentStatus,
  leftAt: Date | null,
  retentionYears: number
): StudentDeparture {
  if (status === "ACTIVE") {
    return {
      status,
      leftAt: null,
      retentionUntil: null,
      leftYear: null,
      isActive: true,
    };
  }

  const departure = leftAt ?? new Date();
  return {
    status,
    leftAt: departure,
    retentionUntil: computeRetentionUntil(departure, retentionYears),
    leftYear: astYear(departure),
    // Leaving and being inactive are the same fact seen from two screens. Kept
    // in step so the existing roster filters keep behaving as they do today.
    isActive: false,
  };
}

export interface TeacherDeparture {
  status: EmploymentStatus;
  leftAt: Date | null;
  retentionUntil: Date | null;
  leftYear: number | null;
  isActive?: boolean;
}

export function buildTeacherDeparture(
  status: EmploymentStatus,
  leftAt: Date | null,
  retentionYears: number
): TeacherDeparture {
  if (status === "ACTIVE") {
    return {
      status,
      leftAt: null,
      retentionUntil: null,
      leftYear: null,
      isActive: true,
    };
  }

  const departure = leftAt ?? new Date();
  return {
    status,
    leftAt: departure,
    retentionUntil: computeRetentionUntil(departure, retentionYears),
    leftYear: astYear(departure),
    isActive: false,
  };
}

export const STUDENT_STATUSES: StudentStatus[] = [
  "ACTIVE",
  "GRADUATED",
  "WITHDRAWN",
  "TRANSFERRED",
];

export const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "ACTIVE",
  "RESIGNED",
  "TERMINATED",
  "CONTRACT_ENDED",
];

export interface RetentionOverview {
  policy: RetentionPolicy;
  students: { active: number; archived: number; pending: number; anonymized: number };
  teachers: { active: number; archived: number; pending: number; anonymized: number };
  guardiansAnonymized: number;
  /** Earliest expiry still waiting — null when nothing is overdue or scheduled. */
  nextExpiryAt: Date | null;
  nextRunAt: Date;
}

/**
 * Counts for the admin screen.
 *
 * "Archived" is every departed record still holding personal data; "pending" is
 * the subset whose retention date has already passed and which the next sweep
 * will clear. A pending count that keeps growing is the signal that the cron has
 * stopped — which is why it is on screen rather than only in logs.
 */
export async function getRetentionOverview(now: Date = new Date()): Promise<RetentionOverview> {
  const policy = await getRetentionPolicy();

  const [
    studentsActive,
    studentsArchived,
    studentsPending,
    studentsAnonymized,
    teachersActive,
    teachersArchived,
    teachersPending,
    teachersAnonymized,
    guardiansAnonymized,
    nextStudent,
    nextTeacher,
  ] = await Promise.all([
    prisma.student.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.student.count({ where: { status: { not: "ACTIVE" }, anonymizedAt: null } }),
    prisma.student.count({
      where: { anonymizedAt: null, retentionUntil: { not: null, lte: now } },
    }),
    prisma.student.count({ where: { anonymizedAt: { not: null } } }),
    prisma.teacher.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.teacher.count({ where: { status: { not: "ACTIVE" }, anonymizedAt: null } }),
    prisma.teacher.count({
      where: { anonymizedAt: null, retentionUntil: { not: null, lte: now } },
    }),
    prisma.teacher.count({ where: { anonymizedAt: { not: null } } }),
    prisma.guardian.count({ where: { anonymizedAt: { not: null } } }),
    prisma.student.findFirst({
      where: { anonymizedAt: null, retentionUntil: { not: null } },
      orderBy: { retentionUntil: "asc" },
      select: { retentionUntil: true },
    }),
    prisma.teacher.findFirst({
      where: { anonymizedAt: null, retentionUntil: { not: null } },
      orderBy: { retentionUntil: "asc" },
      select: { retentionUntil: true },
    }),
  ]);

  const candidates = [nextStudent?.retentionUntil, nextTeacher?.retentionUntil].filter(
    (d): d is Date => Boolean(d)
  );

  return {
    policy,
    students: {
      active: studentsActive,
      archived: studentsArchived,
      pending: studentsPending,
      anonymized: studentsAnonymized,
    },
    teachers: {
      active: teachersActive,
      archived: teachersArchived,
      pending: teachersPending,
      anonymized: teachersAnonymized,
    },
    guardiansAnonymized,
    nextExpiryAt: candidates.length
      ? new Date(Math.min(...candidates.map((d) => d.getTime())))
      : null,
    nextRunAt: nextSweepAt(now),
  };
}

/**
 * When the nightly sweep next fires.
 *
 * Mirrors the `0 3 * * *` entry in vercel.json — 03:00 UTC, chosen to sit after
 * the trash purge at 02:00 so a record is never half-purged and half-anonymised
 * in the same window. Kept as a constant here rather than parsed from the cron
 * file, with the coupling called out so the two are changed together.
 */
export const SWEEP_HOUR_UTC = 3;

export function nextSweepAt(now: Date = new Date()): Date {
  const next = new Date(now.getTime());
  next.setUTCHours(SWEEP_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
