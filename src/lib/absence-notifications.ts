import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { enqueuePush, type PushTarget } from "@/lib/push";
import { logSafeError } from "@/lib/safe-logger";

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Persists one guardian inbox message per child/day when staff explicitly mark
 * the child absent. Repeating the same mark is idempotent at database level.
 */
export async function createAbsenceNotification(input: {
  schoolId: string;
  studentId: string;
  date: Date;
  createdById: string;
}): Promise<{ created: boolean; messageId: string | null; guardians: number }> {
  const key = `absence:${input.studentId}:${dateKey(input.date)}`;
  const requestHash = createHash("sha256").update(key).digest("hex");

  type Created = { messageId: string; targets: PushTarget[]; guardians: number };
  let created: Created | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: {
          id: input.studentId,
          schoolId: input.schoolId,
          deletedAt: null,
          anonymizedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          guardianId: true,
          guardianLinks: { select: { guardianId: true } },
        },
      });
      if (!student) return null;

      const guardianIds = new Set<string>();
      if (student.guardianId) guardianIds.add(student.guardianId);
      for (const link of student.guardianLinks) guardianIds.add(link.guardianId);
      const accounts = guardianIds.size === 0 ? [] : await tx.guardianAccount.findMany({
        where: {
          schoolId: input.schoolId,
          guardianId: { in: [...guardianIds] },
          acceptedAt: { not: null },
          disabledAt: null,
          guardian: { is: { deletedAt: null, anonymizedAt: null } },
        },
        select: { id: true },
      });

      const message = await tx.activityMessage.create({
        data: {
          schoolId: input.schoolId,
          studentId: input.studentId,
          absenceDate: input.date,
          body: "تم تسجيل غياب طفلك عن الحضانة لهذا اليوم.",
          idempotencyKey: key,
          requestHash,
          targetRevision: new Date(),
          guardianRecipientCount: accounts.length,
          staffRecipientCount: 0,
          createdById: input.createdById,
          // Prisma's PostgreSQL adapter cannot execute a nested create with an
          // empty array. Schools may legitimately have no activated guardian
          // accounts yet, so persist the durable message without recipients.
          ...(accounts.length > 0
            ? {
                recipients: {
                  create: accounts.map((account) => ({ guardianAccountId: account.id })),
                },
              }
            : {}),
        },
        select: {
          id: true,
          recipients: { select: { schoolId: true, guardianAccountId: true } },
        },
      });
      return {
        messageId: message.id,
        guardians: accounts.length,
        targets: message.recipients.map((recipient) => ({
          schoolId: recipient.schoolId,
          guardianAccountId: recipient.guardianAccountId!,
        })),
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await prisma.activityMessage.findFirst({
      where: {
        schoolId: input.schoolId,
        studentId: input.studentId,
        absenceDate: input.date,
      },
      select: { id: true, guardianRecipientCount: true },
    });
    return { created: false, messageId: existing?.id ?? null, guardians: existing?.guardianRecipientCount ?? 0 };
  }

  if (!created) return { created: false, messageId: null, guardians: 0 };

  const results = await Promise.allSettled(created.targets.map((target) => enqueuePush(target, {
    title: "تنبيه غياب",
    body: "تم تسجيل غياب طفلك اليوم. افتحي التطبيق للتفاصيل.",
    data: { screen: "messages", kind: "absence", messageId: created!.messageId, studentId: input.studentId },
  })));
  let pushQueuedCount = 0;
  let pushFailureCount = 0;
  for (const result of results) {
    if (result.status === "fulfilled") pushQueuedCount += result.value;
    else pushFailureCount += 1;
  }
  try {
    await prisma.activityMessage.update({
      where: { id: created.messageId },
      data: { pushQueuedCount, pushFailureCount, pushProcessedAt: new Date() },
    });
  } catch (error) {
    logSafeError("absence-notification-push-result", error);
  }
  return { created: true, messageId: created.messageId, guardians: created.guardians };
}
