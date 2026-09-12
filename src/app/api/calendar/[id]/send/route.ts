import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { lockCalendarEventForUpdate } from "@/lib/calendar-event-lock";
import { enqueuePush, type PushTarget } from "@/lib/push";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const schema = z.object({
  notifyGuardians: z.boolean(),
  notifyStaff: z.boolean(),
  message: z.string().trim().min(1).max(2000),
  eventVersion: z.string().datetime(),
  idempotencyKey: z.string().min(16).max(200),
  confirmSchoolWide: z.boolean().optional(),
}).strict();

const storedSelect = {
  id: true,
  requestHash: true,
  guardianRecipientCount: true,
  staffRecipientCount: true,
  pushQueuedCount: true,
  pushFailureCount: true,
  pushProcessedAt: true,
} as const;

function hashIntent(input: z.infer<typeof schema>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function addGuardians(
  ids: Set<string>,
  student: { guardianId: string | null; guardianLinks: { guardianId: string }[] }
) {
  if (student.guardianId) ids.add(student.guardianId);
  for (const link of student.guardianLinks) ids.add(link.guardianId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("schedule.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const schoolId = session.user.schoolId;
  const { id } = await params;
  const limited = rateLimitResponse(await rateLimit({
    key: `send:calendar-announcement:${schoolId}:${session.user.id}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  }));
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid send request" }, { status: 422 });
  if (!parsed.data.notifyGuardians && !parsed.data.notifyStaff) {
    return Response.json({ error: "Choose at least one audience" }, { status: 422 });
  }
  const requestHash = hashIntent(parsed.data);

  type StoredResult = {
    id: string;
    requestHash: string;
    guardianRecipientCount: number;
    staffRecipientCount: number;
    pushQueuedCount: number;
    pushFailureCount: number;
    pushProcessedAt: Date | null;
  };
  type Outcome =
    | { kind: "not-found" }
    | { kind: "stale" }
    | { kind: "unsaved" }
    | { kind: "confirm" }
    | { kind: "empty" }
    | { kind: "duplicate"; stored: StoredResult }
    | { kind: "created"; messageId: string; title: string; targets: PushTarget[]; guardians: number; staff: number };

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      if (!await lockCalendarEventForUpdate(tx, { id, schoolId })) return { kind: "not-found" };
      const previous = await tx.activityMessage.findFirst({
        where: { schoolId, calendarEventId: id, idempotencyKey: parsed.data.idempotencyKey },
        select: storedSelect,
      });
      if (previous) return { kind: "duplicate", stored: previous };

      const event = await tx.calendarEvent.findFirst({
        where: { id, schoolId, deletedAt: null, type: "ANNOUNCEMENT" },
        select: {
          id: true,
          title: true,
          description: true,
          teacherId: true,
          updatedAt: true,
          classes: { select: { classId: true } },
        },
      });
      if (!event) return { kind: "not-found" };
      if (event.updatedAt.toISOString() !== parsed.data.eventVersion) return { kind: "stale" };
      if ((event.description ?? "").trim() !== parsed.data.message) return { kind: "unsaved" };

      const schoolWide = event.classes.length === 0;
      if (schoolWide && parsed.data.confirmSchoolWide !== true) return { kind: "confirm" };
      const rooms = await tx.class.findMany({
        where: {
          schoolId,
          deletedAt: null,
          ...(schoolWide ? {} : { id: { in: event.classes.map((item) => item.classId) } }),
        },
        select: {
          teacherId: true,
          students: {
            where: { schoolId, isActive: true, deletedAt: null },
            select: {
              guardianId: true,
              guardianLinks: { select: { guardianId: true } },
            },
          },
        },
      });

      const guardianIds = new Set<string>();
      const teacherIds = new Set<string>();
      if (parsed.data.notifyGuardians) {
        for (const room of rooms) for (const student of room.students) addGuardians(guardianIds, student);
      }
      if (parsed.data.notifyStaff) {
        if (event.teacherId) teacherIds.add(event.teacherId);
        for (const room of rooms) if (room.teacherId) teacherIds.add(room.teacherId);
      }
      const [guardianAccounts, users] = await Promise.all([
        guardianIds.size
          ? tx.guardianAccount.findMany({
              where: {
                schoolId,
                guardianId: { in: [...guardianIds] },
                disabledAt: null,
                acceptedAt: { not: null },
                guardian: { is: { schoolId, deletedAt: null, anonymizedAt: null } },
              },
              select: { id: true },
            })
          : [],
        teacherIds.size
          ? tx.user.findMany({
              where: {
                schoolId,
                teacherId: { in: [...teacherIds] },
                disabledAt: null,
                acceptedAt: { not: null },
              },
              select: { id: true },
            })
          : [],
      ]);
      if (!guardianAccounts.length && !users.length) return { kind: "empty" };

      const stored = await tx.activityMessage.create({
        data: {
          schoolId,
          calendarEventId: event.id,
          body: parsed.data.message,
          idempotencyKey: parsed.data.idempotencyKey,
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
        select: {
          id: true,
          recipients: { select: { schoolId: true, guardianAccountId: true, userId: true } },
        },
      });
      const targets = stored.recipients.map((recipient): PushTarget =>
        recipient.guardianAccountId
          ? { schoolId: recipient.schoolId, guardianAccountId: recipient.guardianAccountId }
          : { schoolId: recipient.schoolId, userId: recipient.userId! }
      );
      return {
        kind: "created",
        messageId: stored.id,
        title: event.title,
        targets,
        guardians: guardianAccounts.length,
        staff: users.length,
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const stored = await prisma.activityMessage.findFirst({
      where: { schoolId, calendarEventId: id, idempotencyKey: parsed.data.idempotencyKey },
      select: storedSelect,
    });
    if (!stored) throw error;
    outcome = { kind: "duplicate", stored };
  }

  if (outcome.kind === "not-found") return Response.json({ error: "Not found" }, { status: 404 });
  if (outcome.kind === "stale") return Response.json({ error: "Announcement changed; reload before sending" }, { status: 409 });
  if (outcome.kind === "unsaved") return Response.json({ error: "Save the announcement before sending" }, { status: 409 });
  if (outcome.kind === "confirm") return Response.json({ error: "Confirm sending to all classes" }, { status: 422 });
  if (outcome.kind === "empty") return Response.json({ error: "No eligible in-app recipients" }, { status: 422 });
  if (outcome.kind === "duplicate") {
    const stored = outcome.stored;
    if (stored.requestHash !== requestHash) return Response.json({ error: "Idempotency key was already used" }, { status: 409 });
    return Response.json({
      success: true,
      messageId: stored.id,
      guardianRecipients: stored.guardianRecipientCount,
      staffRecipients: stored.staffRecipientCount,
      duplicate: true,
      pushQueued: stored.pushQueuedCount,
      pushFailures: stored.pushFailureCount,
    });
  }

  const results = await Promise.allSettled(outcome.targets.map((target) => enqueuePush(target, {
    title: outcome.title,
    body: "لديك إعلان جديد داخل التطبيق",
    data: { screen: "announcement-message", calendarEventId: id, messageId: outcome.messageId },
  })));
  let pushQueued = 0;
  let pushFailures = 0;
  for (const result of results) {
    if (result.status === "fulfilled") pushQueued += result.value;
    else pushFailures += 1;
  }
  await prisma.activityMessage.update({
    where: { id: outcome.messageId },
    data: { pushQueuedCount: pushQueued, pushFailureCount: pushFailures, pushProcessedAt: new Date() },
  });
  return Response.json({
    success: true,
    messageId: outcome.messageId,
    guardianRecipients: outcome.guardians,
    staffRecipients: outcome.staff,
    duplicate: false,
    pushQueued,
    pushFailures,
  }, { status: 201 });
}
