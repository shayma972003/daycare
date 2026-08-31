import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";
import { stampFileUrl } from "@/lib/file-token";

export interface AttendancePerson {
  id: string;
  full_name: string;
  avatar_url: string | null;
  class_id: string | null;
  class_name: string | null;
  period: "MORNING" | "EVENING" | null;
  today_attendance: { checkin_time: string | null; checkout_time: string | null } | null;
  open_attendance?: {
    date: string;
    checkin_time: string;
    checkout_time: null;
  } | null;
  /** Legacy overlapping open rows are surfaced for manual review. They are
   * never auto-closed or silently merged. */
  has_overlapping_open_attendance?: boolean;
  /** Whether a new check-in may be recorded today. Historical attendance is
   * still returned when this is false so a later suspension/expiry cannot
   * erase a check-in that already happened. */
  eligible_for_attendance?: boolean;
}

export interface AttendanceClass {
  id: string;
  name: string;
  period: "MORNING" | "EVENING";
}

export interface AttendancePageData {
  /** Null means the caller was not authorized to receive this section. */
  students: AttendancePerson[] | null;
  teachers: AttendancePerson[] | null;
  classes: AttendanceClass[];
}

export interface AttendancePageVisibility {
  students: boolean;
  teachers: boolean;
}

export async function getAttendancePageData(
  schoolId: string,
  visibility: AttendancePageVisibility = { students: true, teachers: true },
  today: Date = astDateOnly()
): Promise<AttendancePageData> {
  // `Attendance.date` is a bare calendar date, so it is matched by equality
  // against the AST business day. Host-local midnight put the board a day out
  // between 21:00 and midnight UTC.

  const [students, teachers, classes] = await Promise.all([
    visibility.students
      ? prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        OR: [
          {
            isActive: true,
            status: "ACTIVE",
            OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: today } }],
          },
          // Keep a historical check-in visible even if the roster changed
          // after the check-in was recorded.
          {
            attendances: {
              some: {
                schoolId,
                checkinAt: { not: null },
                OR: [{ date: today }, { checkoutAt: null }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        classId: true,
        enrollmentEndDate: true,
        isActive: true,
        status: true,
        period: true,
        class: { select: { name: true } },
        attendances: {
          where: {
            schoolId,
            OR: [{ date: today }, { checkinAt: { not: null }, checkoutAt: null }],
          },
          orderBy: [{ date: "desc" }, { checkinAt: "desc" }],
          select: { date: true, checkinAt: true, checkoutAt: true },
        },
      },
      orderBy: { name: "asc" },
        })
      : Promise.resolve(null),
    visibility.teachers
      ? prisma.teacher.findMany({
      where: {
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        OR: [
          { isActive: true, status: "ACTIVE" },
          {
            teacherAttendances: {
              some: {
                schoolId,
                checkinAt: { not: null },
                OR: [{ date: today }, { checkoutAt: null }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        status: true,
        period: true,
        // A deleted class still showed as the teacher's class here, unlike the
        // sibling class query below which filters it. `orderBy` makes the pick
        // deterministic when a teacher owns several.
        classes: {
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 1,
        },
        teacherAttendances: {
          where: {
            schoolId,
            OR: [{ date: today }, { checkinAt: { not: null }, checkoutAt: null }],
          },
          orderBy: [{ date: "desc" }, { checkinAt: "desc" }],
          select: { date: true, checkinAt: true, checkoutAt: true },
        },
      },
      orderBy: { name: "asc" },
        })
      : Promise.resolve(null),
    visibility.students || visibility.teachers
      ? prisma.class.findMany({
          where: { schoolId, deletedAt: null },
          select: { id: true, name: true, period: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const attendanceView = (records: Array<{ date: Date; checkinAt: Date | null; checkoutAt: Date | null }>) => {
    const todayRecord = records.find((record) => record.date.getTime() === today.getTime()) ?? null;
    const openRecords = records.filter((record) => record.checkinAt && !record.checkoutAt);
    const openRecord = openRecords[0] ?? null;
    return {
      today_attendance: todayRecord
        ? {
            checkin_time: todayRecord.checkinAt?.toISOString() ?? null,
            checkout_time: todayRecord.checkoutAt?.toISOString() ?? null,
          }
        : null,
      open_attendance: openRecord?.checkinAt
        ? {
            date: openRecord.date.toISOString().slice(0, 10),
            checkin_time: openRecord.checkinAt.toISOString(),
            checkout_time: null,
          }
        : null,
      has_overlapping_open_attendance: openRecords.length > 1,
    };
  };

  return {
    students: students?.map((s) => ({
      id: s.id,
      full_name: s.name,
      // Stamped so an <img> can fetch a private object without a header it
      // cannot send. The board is session-checked now that the kiosk is gone,
      // so the cookie would also serve — the grant is kept because it is what
      // the mobile client will need. See src/lib/file-token.ts.
      avatar_url: stampFileUrl(s.avatarUrl),
      class_id: s.classId,
      class_name: s.class?.name ?? null,
      period: s.period,
      ...attendanceView(s.attendances),
      eligible_for_attendance:
        s.isActive && s.status === "ACTIVE" && (!s.enrollmentEndDate || s.enrollmentEndDate >= today),
    })) ?? null,
    teachers: teachers?.map((t) => ({
      id: t.id,
      full_name: t.name,
      avatar_url: null,
      class_id: t.classes[0]?.id ?? null,
      class_name: t.classes[0]?.name ?? null,
      period: t.period,
      ...attendanceView(t.teacherAttendances),
      eligible_for_attendance: t.isActive && t.status === "ACTIVE",
    })) ?? null,
    classes,
  };
}
