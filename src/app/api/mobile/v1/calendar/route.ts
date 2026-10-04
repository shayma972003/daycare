import {
  addDateDays,
  deviceWeekStart,
  requestTimeZone,
  storedDate,
  zonedTimeOnDate,
} from "@/lib/device-date";
import { guardianCalendarAudience } from "@/lib/mobile-calendar-scope";
import { guardianChildIds, mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function validDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  return storedDate(value).toISOString().slice(0, 10) === value;
}

/** Read-only calendar for the signed-in guardian or member of staff. */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return Response.json({ error: "المنطقة الزمنية غير صحيحة" }, { status: 422 });
  }

  const url = new URL(request.url);
  const currentWeek = deviceWeekStart(new Date(), timeZone).toISOString().slice(0, 10);
  const fromKey = url.searchParams.get("from") ?? currentWeek;
  const toKey = url.searchParams.get("to") ?? addDateDays(fromKey, 13);

  if (!validDateKey(fromKey) || !validDateKey(toKey)) {
    return Response.json({ error: "نطاق التاريخ غير صحيح" }, { status: 422 });
  }

  const from = zonedTimeOnDate(fromKey, "00:00", timeZone);
  const through = storedDate(toKey);
  const firstDay = storedDate(fromKey);
  const dayCount = Math.round((through.getTime() - firstDay.getTime()) / 86_400_000);
  if (dayCount < 0 || dayCount > MAX_RANGE_DAYS) {
    return Response.json({ error: "نطاق التاريخ غير صحيح" }, { status: 422 });
  }
  const until = zonedTimeOnDate(addDateDays(toKey, 1), "00:00", timeZone);
  if (!from || !until) {
    return Response.json({ error: "تعذّر تحديد حدود التاريخ" }, { status: 422 });
  }

  let classIds: string[] | null;
  let guardianTeacherIds: string[] = [];
  if (context.claims.kind === "guardian") {
    const childIds = await guardianChildIds(context.claims.sub);
    const children = childIds.length
      ? await prisma.student.findMany({
          where: { schoolId: context.schoolId, id: { in: childIds }, deletedAt: null },
          select: {
            classId: true,
            class: {
              select: {
                teacherId: true,
                teacherAssignments: { select: { teacherId: true } },
              },
            },
          },
        })
      : [];
    classIds = Array.from(
      new Set(children.map((child) => child.classId).filter((id): id is string => Boolean(id)))
    );
    guardianTeacherIds = Array.from(
      new Set(
        children.flatMap((child) => {
          const assigned = child.class?.teacherAssignments.map((item) => item.teacherId) ?? [];
          // `teacherId` is the compatibility primary teacher. Use it only when
          // a legacy class has not yet acquired rows in ClassTeacher.
          if (assigned.length > 0) return assigned;
          return child.class?.teacherId ? [child.class.teacherId] : [];
        })
      )
    );
  } else {
    // Staff calendar visibility is teacher-based below. Child records remain
    // class-scoped in their own routes; the calendar itself contains no child
    // records.
    classIds = null;
  }

  const audienceScope = context.claims.kind === "guardian"
    ? guardianCalendarAudience(classIds ?? [], guardianTeacherIds)
    : context.teacherId
      ? { OR: [{ teacherId: null }, { teacherId: context.teacherId }] }
      : { teacherId: null };

  const events = await prisma.calendarEvent.findMany({
    where: {
      schoolId: context.schoolId,
      deletedAt: null,
      AND: [
        { startAt: { lt: until } },
        {
          OR: [
            { endAt: { gt: from } },
            { endAt: null, startAt: { gte: from } },
          ],
        },
      ],
      ...audienceScope,
    },
    orderBy: [{ startAt: "asc" }, { title: "asc" }],
    take: 250,
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      startAt: true,
      endAt: true,
      allDay: true,
      location: true,
      classes: { select: { classId: true } },
    },
  });

  const eventClassIds = Array.from(
    new Set(events.flatMap((event) => event.classes.map((link) => link.classId)))
  );
  const classes = eventClassIds.length
    ? await prisma.class.findMany({
        where: { schoolId: context.schoolId, id: { in: eventClassIds } },
        select: { id: true, name: true },
      })
    : [];
  const classNameById = new Map(classes.map((classroom) => [classroom.id, classroom.name]));

  return Response.json(
    {
      from: fromKey,
      to: toKey,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        description: event.description,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt?.toISOString() ?? null,
        allDay: event.allDay,
        location: event.location,
        classNames: event.classes
          .map((link) => classNameById.get(link.classId))
          .filter((name): name is string => Boolean(name)),
        schoolWide: event.classes.length === 0,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
