import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { enqueuePush, type PushTarget } from "@/lib/push";
import { logAction } from "@/lib/activity-logger";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { lockActivityForUpdate } from "@/lib/activity-lock";
import { z } from "zod";
import { createHash } from "node:crypto";

const sendSchema = z.object({
  notifyGuardians: z.boolean().default(false),
  notifyStaff: z.boolean().default(false),
  message: z.string().max(4000),
  activityVersion: z.string().datetime(),
  idempotencyKey: z.string().min(16).max(200),
  confirmSchoolWide: z.boolean().optional(),
}).strict();

type StoredSendResult = {
  id: string;
  requestHash: string;
  guardianRecipientCount: number;
  staffRecipientCount: number;
  pushQueuedCount: number;
  pushFailureCount: number;
  pushProcessedAt: Date | null;
};

type PersistOutcome =
  | { kind: "not_found" }
  | { kind: "stale_version" }
  | { kind: "unsaved_message" }
  | { kind: "school_wide_confirmation_required" }
  | { kind: "no_recipients" }
  | { kind: "duplicate"; stored: StoredSendResult }
  | {
      kind: "created";
      messageId: string;
      activityId: string;
      activityName: string;
      guardianRecipientCount: number;
      staffRecipientCount: number;
      targets: PushTarget[];
    };

const storedResultSelect = {
  id: true,
  requestHash: true,
  guardianRecipientCount: true,
  staffRecipientCount: true,
  pushQueuedCount: true,
  pushFailureCount: true,
  pushProcessedAt: true,
} as const;

function intentHash(input: z.infer<typeof sendSchema>) {
  return createHash("sha256")
    .update(JSON.stringify({
      body: input.message,
      notifyGuardians: input.notifyGuardians,
      notifyStaff: input.notifyStaff,
      confirmSchoolWide: input.confirmSchoolWide === true,
      targetRevision: input.activityVersion,
    }))
    .digest("hex");
}

function duplicateResponse(stored: StoredSendResult, requestHash: string) {
  if (stored.requestHash !== requestHash) {
    return Response.json({ error: "Idempotency key was already used" }, { status: 409 });
  }
  return Response.json({
    success: true,
    messageId: stored.id,
    notified: stored.guardianRecipientCount + stored.staffRecipientCount,
    guardianRecipients: stored.guardianRecipientCount,
    staffRecipients: stored.staffRecipientCount,
    duplicate: true,
    pushQueued: stored.pushQueuedCount,
    pushFailures: stored.pushFailureCount,
    pushPending: stored.pushProcessedAt === null,
  });
}

function addStudentGuardians(
  target: Set<string>,
  student: { guardianId: string | null; guardianLinks: { guardianId: string }[] }
) {
  if (student.guardianId) target.add(student.guardianId);
  for (const link of student.guardianLinks) target.add(link.guardianId);
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
  if (!session.can("schedule.manage")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const schoolId = session.user.schoolId;
  const { id } = await params;
  const limitedResponse = rateLimitResponse(await rateLimit({
    key: `send:activity:${schoolId}:${session.user.id}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  }));
  if (limitedResponse) return limitedResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid send request" },
      { status: 422 }
    );
  }
  if (!parsed.data.notifyGuardians && !parsed.data.notifyStaff) {
    return Response.json({ error: "Choose at least one audience" }, { status: 422 });
  }
  if (!parsed.data.message.trim()) {
    return Response.json({ error: "Message is required before sending" }, { status: 422 });
  }

  const requestHash = intentHash(parsed.data);

  let outcome: PersistOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<PersistOutcome> => {
      // All activity target writers take this tenant-scoped row lock first.
      // A waiting sender therefore reads either the complete old target or the
      // complete new target, never an Activity row from one and invites from the other.
      if (!await lockActivityForUpdate(tx, { id, schoolId })) return { kind: "not_found" };

      // Re-check idempotency after waiting for the same activity lock. Exact
      // retries use the durable result snapshot and never recalculate audience.
      const previous = await tx.activityMessage.findFirst({
        where: { schoolId, activityId: id, idempotencyKey: parsed.data.idempotencyKey },
        select: storedResultSelect,
      });
      if (previous) return { kind: "duplicate", stored: previous };

      const activity = await tx.activity.findFirst({
        where: { id, schoolId, isActive: true },
        select: {
          id: true,
          name: true,
          message: true,
          teacherId: true,
          updatedAt: true,
          activityInvites: {
            select: {
              class: {
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
              },
            },
          },
        },
      });
      if (!activity) return { kind: "not_found" };
      if (activity.updatedAt.toISOString() !== parsed.data.activityVersion) {
        return { kind: "stale_version" };
      }
      if ((activity.message ?? "") !== parsed.data.message) {
        return { kind: "unsaved_message" };
      }

      const schoolWide = activity.activityInvites.length === 0;
      if (schoolWide && parsed.data.confirmSchoolWide !== true) {
        return { kind: "school_wide_confirmation_required" };
      }
      const classes = schoolWide
        ? await tx.class.findMany({
            where: { schoolId, deletedAt: null },
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
          })
        : activity.activityInvites.map((invite) => invite.class);

      const guardianIds = new Set<string>();
      const teacherIds = new Set<string>();
      if (parsed.data.notifyGuardians) {
        for (const room of classes) {
          for (const student of room.students) addStudentGuardians(guardianIds, student);
        }
      }
      if (parsed.data.notifyStaff) {
        if (activity.teacherId) teacherIds.add(activity.teacherId);
        for (const room of classes) if (room.teacherId) teacherIds.add(room.teacherId);
      }

      const guardianAccounts = guardianIds.size > 0
        ? await tx.guardianAccount.findMany({
            where: {
              schoolId,
              guardianId: { in: [...guardianIds] },
              disabledAt: null,
              acceptedAt: { not: null },
              guardian: { is: { schoolId, deletedAt: null, anonymizedAt: null } },
            },
            select: { id: true },
          })
        : [];
      const users = teacherIds.size > 0
        ? await tx.user.findMany({
            where: {
              schoolId,
              teacherId: { in: [...teacherIds] },
              disabledAt: null,
              acceptedAt: { not: null },
            },
            select: { id: true },
          })
        : [];
      if (guardianAccounts.length === 0 && users.length === 0) return { kind: "no_recipients" };

      const stored = await tx.activityMessage.create({
        data: {
          schoolId,
          activityId: activity.id,
          body: parsed.data.message,
          idempotencyKey: parsed.data.idempotencyKey,
          requestHash,
          targetRevision: new Date(parsed.data.activityVersion),
          guardianRecipientCount: guardianAccounts.length,
          staffRecipientCount: users.length,
          createdById: session.user.id,
          recipients: {
            // schoolId is inherited from the parent through the composite message relation.
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
      const targets: PushTarget[] = stored.recipients.map((recipient) =>
        recipient.guardianAccountId
          ? { schoolId: recipient.schoolId, guardianAccountId: recipient.guardianAccountId }
          : { schoolId: recipient.schoolId, userId: recipient.userId! }
      );
      return {
        kind: "created",
        messageId: stored.id,
        activityId: activity.id,
        activityName: activity.name,
        guardianRecipientCount: guardianAccounts.length,
        staffRecipientCount: users.length,
        targets,
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    // A PostgreSQL uniqueness failure aborts its transaction. Read the winner
    // only after that transaction has ended; never continue using its tx client.
    const stored = await prisma.activityMessage.findFirst({
      where: { schoolId, activityId: id, idempotencyKey: parsed.data.idempotencyKey },
      select: storedResultSelect,
    });
    if (!stored) throw error;
    outcome = { kind: "duplicate", stored };
  }

  if (outcome.kind === "duplicate") return duplicateResponse(outcome.stored, requestHash);
  if (outcome.kind === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  if (outcome.kind === "stale_version") {
    return Response.json({ error: "Activity changed; reload before sending" }, { status: 409 });
  }
  if (outcome.kind === "unsaved_message") {
    return Response.json({ error: "Save the activity changes before sending" }, { status: 409 });
  }
  if (outcome.kind === "school_wide_confirmation_required") {
    return Response.json({ error: "Confirm sending to all classes" }, { status: 422 });
  }
  if (outcome.kind === "no_recipients") {
    return Response.json({ error: "No eligible in-app recipients" }, { status: 422 });
  }

  const { messageId, activityId, activityName, targets } = outcome;
  const results = await Promise.allSettled(targets.map((target) => enqueuePush(target, {
    title: activityName,
    body: "You have a new activity message in the app",
    data: { screen: "activity-message", activityId, messageId },
  })));
  let pushQueued = 0;
  let pushFailures = 0;
  for (const result of results) {
    if (result.status === "fulfilled") pushQueued += result.value;
    else pushFailures++;
  }

  await prisma.activityMessage.update({
    where: { id: messageId },
    data: {
      pushQueuedCount: pushQueued,
      pushFailureCount: pushFailures,
      pushProcessedAt: new Date(),
    },
  });

  await logAction({
    school_id: schoolId,
    action: `Stored an activity message for ${targets.length} recipient accounts`,
    entity_type: "activity",
    entity_id: activityId,
    entity_name: activityName,
    performed_by: session.user.name ?? "Manager",
    request,
  });

  return Response.json({
    success: true,
    messageId,
    notified: targets.length,
    guardianRecipients: outcome.guardianRecipientCount,
    staffRecipients: outcome.staffRecipientCount,
    duplicate: false,
    pushQueued,
    pushFailures,
    pushPending: false,
  }, { status: 201 });
}
