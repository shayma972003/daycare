import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeacherOwned, assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { astDayStart } from "@/lib/datetime";
import { z } from "zod";

/**
 * Calendar events (tasks 2.18–2.21).
 *
 * The three views — day, week, month — are the same query over different
 * ranges, so the API takes a range and lets the client decide what it is
 * drawing. Building three endpoints would triple the surface for no gain.
 */

/** Guards against `?from=1900&to=2200` pulling a decade into one response. */
const MAX_RANGE_DAYS = 120;

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

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const classId = url.searchParams.get("classId");
  const teacherId = url.searchParams.get("teacherId");
  const type = url.searchParams.get("type");

  const from = fromParam ? new Date(fromParam) : astDayStart();
  const to = toParam ? new Date(toParam) : new Date(from.getTime() + 31 * 86400000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return Response.json({ error: "المدى الزمني غير صحيح" }, { status: 422 });
  }
  if ((to.getTime() - from.getTime()) / 86400000 > MAX_RANGE_DAYS) {
    return Response.json(
      { error: `المدى الأقصى ${MAX_RANGE_DAYS} يوماً` },
      { status: 422 }
    );
  }

  const events = await prisma.calendarEvent.findMany({
    where: {
      schoolId,
      deletedAt: null,
      /**
       * Overlap, not containment.
       *
       * `startAt: { gte: from }` asks "did it begin inside this window", which
       * is a different question from "is it happening during it". A unit
       * running the 1st to the 20th vanished from the week of the 12th — the
       * client renders every day an entry covers, and the row it needed was
       * never sent. Activities below have always used an overlap query; events
       * did not, so the fix that made programmes span days did nothing here.
       *
       * An entry with no end is a single instant and only matches by start.
       */
      startAt: { lt: to },
      ...(teacherId ? { teacherId } : {}),
      ...(type && ["LESSON", "ACTIVITY", "ANNOUNCEMENT", "UNIT"].includes(type)
        ? { type: type as "LESSON" | "ACTIVITY" | "ANNOUNCEMENT" | "UNIT" }
        : {}),
      /**
       * Both conditions are `OR` groups, so they go in `AND` rather than as two
       * `OR` keys — the second would simply overwrite the first in the object
       * literal, and the room filter would have silently undone the overlap.
       *
       * Filtering by room means "events this room is invited to". An event with
       * no rooms attached is school-wide and shows regardless — otherwise the
       * filter would hide the announcements that concern everybody.
       */
      AND: [
        { OR: [{ endAt: { gte: from } }, { endAt: null, startAt: { gte: from } }] },
        ...(classId
          ? [{ OR: [{ classes: { some: { classId } } }, { classes: { none: {} } }] }]
          : []),
      ],
    },
    orderBy: { startAt: "asc" },
    include: {
      classes: { select: { classId: true } },
      unit: { select: { id: true, name: true } },
      lesson: { select: { id: true, title: true } },
    },
  });

  /**
   * Activities are a table of their own, and the calendar never read it.
   *
   * That is why an activity added from the home screen appeared nowhere on the
   * calendar: `CalendarEventType.ACTIVITY` and the `Activity` model share a
   * name and nothing else. An activity carries a fee, a stage, a child count
   * and its own guardian invitations, none of which an event row can hold — so
   * it stays its own record and is *shown* here rather than copied here.
   *
   * Returned with `kind: "activity"` so the client can tell the two apart and
   * open the right editor for each.
   */
  const activities = await prisma.activity.findMany({
    where: {
      schoolId,
      isActive: true,
      // Overlap, not containment: a two-week activity is happening during a week
      // that starts after it began, and belongs on that week.
      startDate: { lt: to },
      endDate: { gte: from },
      ...(teacherId ? { teacherId } : {}),
    },
    orderBy: { startDate: "asc" },
    include: {
      activityInvites: { select: { classId: true } },
      teacher: { select: { name: true } },
      stage: { select: { id: true, nameAr: true, nameEn: true } },
    },
  });

  const activityRows = activities
    .filter((activity) => {
      if (!classId) return true;
      // Same rule as events: no rooms attached means school-wide.
      const invited = activity.activityInvites.map((invite) => invite.classId);
      return invited.length === 0 || invited.includes(classId);
    })
    .map((activity) => ({
      id: activity.id,
      kind: "activity" as const,
      type: "ACTIVITY" as const,
      title: activity.name,
      description: activity.message,
      startAt: activity.startDate.toISOString(),
      endAt: activity.endDate.toISOString(),
      allDay: true,
      teacherId: activity.teacherId,
      location: null,
      classIds: activity.activityInvites.map((invite) => invite.classId),
      unit: null,
      /**
       * The row the editor wants, carried with the calendar row.
       *
       * Fetching it separately meant a second request that returned the raw
       * table row — `activityFee`, `stageId` — while the form reads `fee` and
       * `stage`. The form opened with a blank stage and a zero fee, and saving
       * wrote those blanks back.
       */
      activity: {
        id: activity.id,
        name: activity.name,
        teacherName: activity.teacher?.name,
        stage: activity.stage,
        period: activity.period,
        childrenCount: activity.childrenCount,
        startDate: activity.startDate.toISOString(),
        endDate: activity.endDate.toISOString(),
        fee: activity.activityFee,
        imageUrl: activity.imageUrl,
        message: activity.message,
        active: activity.isActive,
      },
    }));

  return Response.json(
    events
      .map((event) => ({
        ...event,
        kind: "event" as const,
        classIds: event.classes.map((link) => link.classId),
        classes: undefined,
      }))
      .concat(activityRows as never[])
  );
}

const createSchema = z.object({
  type: z.enum(["LESSON", "ACTIVITY", "ANNOUNCEMENT", "UNIT"]),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  startAt: z.string().min(1),
  endAt: z.string().nullish(),
  allDay: z.boolean().optional(),
  teacherId: z.string().nullish(),
  unitId: z.string().nullish(),
  lessonId: z.string().nullish(),
  location: z.string().max(200).nullish(),
  classIds: z.array(z.string()).max(60).optional(),
});

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const startAt = new Date(parsed.data.startAt);
  if (Number.isNaN(startAt.getTime())) {
    return Response.json({ error: "تاريخ البداية غير صحيح" }, { status: 422 });
  }

  let endAt: Date | null = null;
  if (parsed.data.endAt) {
    endAt = new Date(parsed.data.endAt);
    if (Number.isNaN(endAt.getTime())) {
      return Response.json({ error: "تاريخ النهاية غير صحيح" }, { status: 422 });
    }
    // An event that ends before it starts renders as a negative block and
    // breaks every layout that assumes duration is positive.
    if (endAt <= startAt) {
      return Response.json(
        { error: "وقت النهاية يجب أن يكون بعد البداية" },
        { status: 422 }
      );
    }
  }

  // Every client-supplied id proven to belong to this school before it is
  // written — the same rule as everywhere else.
  let teacherId: string | null = null;
  let classIds: string[] = [];
  try {
    teacherId = await assertTeacherOwned(parsed.data.teacherId || null, schoolId);
    for (const classId of parsed.data.classIds ?? []) {
      const owned = await assertClassOwned(classId, schoolId);
      if (owned) classIds.push(owned);
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }
  classIds = Array.from(new Set(classIds));

  // Units and lessons carry no tenant column of their own on the lesson side, so
  // ownership is established through the unit.
  let unitId: string | null = null;
  let lessonId: string | null = null;
  if (parsed.data.unitId) {
    const unit = await prisma.unit.findFirst({
      where: { id: parsed.data.unitId, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!unit) return Response.json({ error: "الوحدة غير موجودة" }, { status: 404 });
    unitId = unit.id;
  }
  if (parsed.data.lessonId) {
    const lesson = await prisma.lesson.findFirst({
      where: { id: parsed.data.lessonId, unit: { schoolId, deletedAt: null } },
      select: { id: true, unitId: true },
    });
    if (!lesson) return Response.json({ error: "الدرس غير موجود" }, { status: 404 });
    lessonId = lesson.id;
    // A lesson implies its unit; taking it from the lesson stops the two
    // disagreeing when a client sends both.
    unitId = lesson.unitId;
  }

  const event = await prisma.calendarEvent.create({
    data: {
      schoolId,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      startAt,
      // An announcement has no duration by definition; a stray end time sent by
      // a shared form is dropped rather than stored.
      endAt: parsed.data.type === "ANNOUNCEMENT" ? null : endAt,
      allDay: parsed.data.allDay ?? false,
      teacherId,
      unitId,
      lessonId,
      location: parsed.data.location ?? null,
      createdByName: session.user.name ?? "المدير",
      ...(classIds.length > 0
        ? { classes: { create: classIds.map((classId) => ({ classId })) } }
        : {}),
    },
    include: { classes: { select: { classId: true } } },
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة حدث للتقويم: ${event.title}`,
    entity_type: "calendar_event",
    entity_id: event.id,
    entity_name: event.title,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(
    { ...event, classIds: event.classes.map((link) => link.classId), classes: undefined },
    { status: 201 }
  );
}
