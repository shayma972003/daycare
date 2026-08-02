import { prisma } from "@/lib/prisma";
import { astDateOnly } from "@/lib/datetime";

export interface AttendancePerson {
  id: string;
  full_name: string;
  avatar_url: string | null;
  class_id: string | null;
  class_name: string | null;
  period: "MORNING" | "EVENING" | null;
  today_attendance: { checkin_time: string | null; checkout_time: string | null } | null;
}

export interface AttendanceClass {
  id: string;
  name: string;
  period: "MORNING" | "EVENING";
}

export async function getAttendancePageData(schoolId: string): Promise<{
  students: AttendancePerson[];
  teachers: AttendancePerson[];
  classes: AttendanceClass[];
}> {
  // `Attendance.date` is a bare calendar date, so it is matched by equality
  // against the AST business day. Host-local midnight put the board a day out
  // between 21:00 and midnight UTC.
  const today = astDateOnly();

  const [students, teachers, classes] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        classId: true,
        period: true,
        class: { select: { name: true } },
        attendances: {
          where: { date: today },
          orderBy: { date: "desc" },
          take: 1,
          select: { checkinAt: true, checkoutAt: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { schoolId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
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
          where: { date: today },
          orderBy: { date: "desc" },
          take: 1,
          select: { checkinAt: true, checkoutAt: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true, period: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    students: students.map((s) => ({
      id: s.id,
      full_name: s.name,
      avatar_url: s.avatarUrl,
      class_id: s.classId,
      class_name: s.class?.name ?? null,
      period: s.period,
      today_attendance: s.attendances[0]
        ? {
            checkin_time: s.attendances[0].checkinAt ? s.attendances[0].checkinAt.toISOString() : null,
            checkout_time: s.attendances[0].checkoutAt ? s.attendances[0].checkoutAt.toISOString() : null,
          }
        : null,
    })),
    teachers: teachers.map((t) => ({
      id: t.id,
      full_name: t.name,
      avatar_url: null,
      class_id: t.classes[0]?.id ?? null,
      class_name: t.classes[0]?.name ?? null,
      period: t.period,
      today_attendance: t.teacherAttendances[0]
        ? {
            checkin_time: t.teacherAttendances[0].checkinAt ? t.teacherAttendances[0].checkinAt.toISOString() : null,
            checkout_time: t.teacherAttendances[0].checkoutAt ? t.teacherAttendances[0].checkoutAt.toISOString() : null,
          }
        : null,
    })),
    classes,
  };
}
