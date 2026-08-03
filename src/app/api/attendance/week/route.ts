import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { astDateOnly, astParts } from "@/lib/datetime";
import {
  expectedDays,
  attendanceRatio,
  capacityState,
} from "@/lib/attendance-schedule";

/**
 * A week of attendance for one class (tasks 2.13 and 2.14).
 *
 * One request rather than seven: the grid needs every cell at once, and a
 * per-day fetch would produce a screen that fills in raggedly and seven times
 * the queries.
 *
 * Returns the *expected* days per child alongside the records, so the grid can
 * grey out cells a part-time child was never due to attend — the difference
 * between "absent" and "not enrolled today".
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const url = new URL(request.url);

  const classId = url.searchParams.get("classId");
  const startParam = url.searchParams.get("start");

  const anchor = startParam ? new Date(startParam) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  // Week starts on Sunday — the Saudi working week runs Sunday to Thursday, and
  // a Monday-first grid puts the weekend in the middle.
  const anchorDay = astDateOnly(anchor);
  const weekStart = new Date(anchorDay);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());

  const days: Date[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + offset);
    days.push(day);
  }
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const [students, records, cls] = await Promise.all([
    prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        isActive: true,
        ...(classId ? { classId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, avatarUrl: true, attendanceDays: true },
    }),
    prisma.attendance.findMany({
      where: {
        schoolId,
        date: { gte: weekStart, lt: weekEnd },
        ...(classId ? { classId } : {}),
      },
      select: {
        studentId: true,
        date: true,
        status: true,
        statusNote: true,
        checkinAt: true,
        checkoutAt: true,
      },
    }),
    classId
      ? prisma.class.findFirst({
          where: { id: classId, schoolId, deletedAt: null },
          select: {
            id: true,
            name: true,
            capacity: true,
            ageGroups: true,
            _count: { select: { students: { where: { deletedAt: null, isActive: true } } } },
          },
        })
      : Promise.resolve(null),
  ]);

  const key = (studentId: string, date: Date) => {
    const parts = astParts(date);
    return `${studentId}|${parts.year}-${parts.month}-${parts.day}`;
  };

  const byCell = new Map(records.map((record) => [key(record.studentId, record.date), record]));

  const rows = students.map((student) => {
    const expected = expectedDays(student.attendanceDays);
    const cells = days.map((day) => {
      const record = byCell.get(key(student.id, day));
      return {
        date: day.toISOString().slice(0, 10),
        weekday: day.getUTCDay(),
        // Not enrolled on this weekday — rendered greyed rather than absent.
        expected: expected.includes(day.getUTCDay()),
        // NO_RECORD is the absence of a row, never a stored value.
        status: record?.status ?? "NO_RECORD",
        statusNote: record?.statusNote ?? null,
        checkinAt: record?.checkinAt ?? null,
        checkoutAt: record?.checkoutAt ?? null,
      };
    });

    const present = records
      .filter(
        (record) =>
          record.studentId === student.id &&
          (record.status === "PRESENT" || record.status === "CHECKED_OUT")
      )
      .map((record) => record.date);

    return {
      studentId: student.id,
      name: student.name,
      avatarUrl: student.avatarUrl,
      expectedDays: expected,
      cells,
      // "3/5 أيام" — the denominator counts days this child was *expected*, not
      // days the nursery was open.
      ratio: attendanceRatio(student.attendanceDays, present, weekStart, days[6]),
    };
  });

  // "2/3 حاضر" per column.
  const dayTotals = days.map((day, index) => {
    const dueToday = rows.filter((row) => row.cells[index].expected).length;
    const presentToday = rows.filter((row) => {
      const status = row.cells[index].status;
      return status === "PRESENT" || status === "CHECKED_OUT";
    }).length;
    return {
      date: day.toISOString().slice(0, 10),
      weekday: day.getUTCDay(),
      present: presentToday,
      expected: dueToday,
    };
  });

  return Response.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    days: days.map((day) => ({
      date: day.toISOString().slice(0, 10),
      weekday: day.getUTCDay(),
    })),
    rows,
    dayTotals,
    class: cls
      ? {
          id: cls.id,
          name: cls.name,
          ageGroups: cls.ageGroups,
          capacityState: capacityState(cls._count.students, cls.capacity),
        }
      : null,
  });
}
