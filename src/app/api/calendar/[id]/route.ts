import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeacherOwned, assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  startAt: z.string().optional(),
  endAt: z.string().nullish(),
  allDay: z.boolean().optional(),
  teacherId: z.string().nullish(),
  location: z.string().max(200).nullish(),
  classIds: z.array(z.string()).max(60).optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await prisma.calendarEvent.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, title: true, type: true, startAt: true, endAt: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if ("description" in parsed.data) data.description = parsed.data.description ?? null;
  if ("location" in parsed.data) data.location = parsed.data.location ?? null;
  if (parsed.data.allDay !== undefined) data.allDay = parsed.data.allDay;

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : existing.startAt;
  if (Number.isNaN(startAt.getTime())) {
    return Response.json({ error: "تاريخ البداية غير صحيح" }, { status: 422 });
  }
  if (parsed.data.startAt) data.startAt = startAt;

  if ("endAt" in parsed.data) {
    if (!parsed.data.endAt) {
      data.endAt = null;
    } else {
      const endAt = new Date(parsed.data.endAt);
      if (Number.isNaN(endAt.getTime())) {
        return Response.json({ error: "تاريخ النهاية غير صحيح" }, { status: 422 });
      }
      // Compared against the new start when one was sent, not the stored one —
      // moving an event earlier must not be rejected by its old end time.
      if (endAt <= startAt) {
        return Response.json(
          { error: "وقت النهاية يجب أن يكون بعد البداية" },
          { status: 422 }
        );
      }
      data.endAt = endAt;
    }
  }

  let classIds: string[] | null = null;
  try {
    if ("teacherId" in parsed.data) {
      data.teacherId = await assertTeacherOwned(parsed.data.teacherId || null, schoolId);
    }
    if (parsed.data.classIds !== undefined) {
      const owned: string[] = [];
      for (const classId of parsed.data.classIds) {
        const resolved = await assertClassOwned(classId, schoolId);
        if (resolved) owned.push(resolved);
      }
      classIds = Array.from(new Set(owned));
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }

  // Replaced wholesale rather than diffed: the client sends the full set it
  // wants, and a diff would have to guess which omissions were deliberate.
  const event = await prisma.$transaction(async (tx) => {
    if (classIds !== null) {
      await tx.calendarEventClass.deleteMany({ where: { eventId: id } });
      if (classIds.length > 0) {
        await tx.calendarEventClass.createMany({
          data: classIds.map((classId) => ({ eventId: id, classId })),
        });
      }
    }
    return tx.calendarEvent.update({
      where: { id },
      data,
      include: { classes: { select: { classId: true } } },
    });
  });

  await logAction({
    school_id: schoolId,
    action: `تعديل حدث التقويم: ${event.title}`,
    entity_type: "calendar_event",
    entity_id: event.id,
    entity_name: event.title,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({
    ...event,
    classIds: event.classes.map((link) => link.classId),
    classes: undefined,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const existing = await prisma.calendarEvent.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  // Soft delete, consistent with the rest of the product: a removed event a
  // parent already saw should be explicable afterwards.
  await prisma.calendarEvent.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logAction({
    school_id: schoolId,
    action: `حذف حدث التقويم: ${existing.title}`,
    entity_type: "calendar_event",
    entity_id: existing.id,
    entity_name: existing.title,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
