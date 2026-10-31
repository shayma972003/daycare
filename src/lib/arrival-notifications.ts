import { prisma } from "@/lib/prisma";
import { enqueuePush } from "@/lib/push";
import { logSafeError } from "@/lib/safe-logger";

export const ARRIVAL_COOLDOWN_MS = 5 * 60 * 1000;
export const ARRIVAL_MINUTE_OPTIONS = [0, 5, 10, 15] as const;
export type ArrivalMinutes = (typeof ARRIVAL_MINUTE_OPTIONS)[number];

export function arrivalNoticeMessage(senderName: string, minutes: ArrivalMinutes) {
  return minutes === 0
    ? `ولي الأمر ${senderName} وصل`
    : `سيصل ${senderName} خلال ${minutes} دقائق`;
}

export function arrivalMinutesFromDates(expectedAt: Date, createdAt: Date): ArrivalMinutes {
  const minutes = Math.max(0, Math.round((expectedAt.getTime() - createdAt.getTime()) / 60_000));
  return ARRIVAL_MINUTE_OPTIONS.includes(minutes as ArrivalMinutes)
    ? minutes as ArrivalMinutes
    : 5;
}

export type ArrivalNoticeResult =
  | {
      created: true;
      noticeId: string;
      message: string;
      expectedAt: Date;
      cooldownUntil: Date;
      recipients: number;
      pushQueued: number;
    }
  | {
      created: false;
      reason: "COOLDOWN" | "ACCOUNT_UNAVAILABLE";
      retryAfterSeconds: number;
    };

/**
 * Records one parent arrival notice and snapshots the director-selected staff.
 *
 * The conditional update is the concurrency barrier: even two requests that
 * arrive together cannot both move `lastArrivalNoticeAt` inside the rolling
 * five-minute window. No child id is accepted or stored in this flow.
 */
export async function createGuardianArrivalNotice(input: {
  schoolId: string;
  guardianAccountId: string;
  arrivalMinutes?: ArrivalMinutes;
  now?: Date;
}): Promise<ArrivalNoticeResult> {
  const now = input.now ?? new Date();
  const arrivalMinutes = input.arrivalMinutes ?? 5;
  const cooldownStartedBefore = new Date(now.getTime() - ARRIVAL_COOLDOWN_MS);
  const cooldownUntil = new Date(now.getTime() + ARRIVAL_COOLDOWN_MS);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.guardianAccount.findFirst({
      where: {
        id: input.guardianAccountId,
        schoolId: input.schoolId,
        acceptedAt: { not: null },
        disabledAt: null,
        guardian: { is: { deletedAt: null, anonymizedAt: null } },
      },
      select: {
        lastArrivalNoticeAt: true,
        guardian: { select: { name: true } },
      },
    });
    if (!account) {
      return { kind: "unavailable" as const };
    }

    const claimed = await tx.guardianAccount.updateMany({
      where: {
        id: input.guardianAccountId,
        schoolId: input.schoolId,
        acceptedAt: { not: null },
        disabledAt: null,
        OR: [
          { lastArrivalNoticeAt: null },
          { lastArrivalNoticeAt: { lte: cooldownStartedBefore } },
        ],
      },
      data: { lastArrivalNoticeAt: now },
    });

    if (claimed.count !== 1) {
      const current = await tx.guardianAccount.findUnique({
        where: { id: input.guardianAccountId },
        select: { lastArrivalNoticeAt: true },
      });
      const remainingMs = Math.max(
        0,
        (current?.lastArrivalNoticeAt?.getTime() ?? now.getTime()) + ARRIVAL_COOLDOWN_MS - now.getTime()
      );
      return {
        kind: "cooldown" as const,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }

    const configured = await tx.arrivalRecipientSetting.findMany({
      where: {
        schoolId: input.schoolId,
        user: { is: { disabledAt: null, acceptedAt: { not: null }, notifyArrival: true } },
      },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });
    const senderName = account.guardian.name.trim() || "ولي الأمر";
    const expectedAt = new Date(now.getTime() + arrivalMinutes * 60_000);
    const notice = await tx.arrivalNotice.create({
      data: {
        schoolId: input.schoolId,
        guardianAccountId: input.guardianAccountId,
        senderName,
        expectedAt,
        ...(configured.length > 0
          ? {
              recipients: {
                create: configured.map(({ userId }) => ({ userId })),
              },
            }
          : {}),
      },
      select: {
        id: true,
        senderName: true,
        expectedAt: true,
        recipients: { select: { userId: true, schoolId: true } },
      },
    });

    return { kind: "created" as const, notice };
  });

  if (result.kind === "unavailable") {
    return { created: false, reason: "ACCOUNT_UNAVAILABLE", retryAfterSeconds: 0 };
  }
  if (result.kind === "cooldown") {
    return {
      created: false,
      reason: "COOLDOWN",
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  const message = arrivalNoticeMessage(result.notice.senderName, arrivalMinutes);
  const deliveries = await Promise.allSettled(
    result.notice.recipients.map((recipient) =>
      enqueuePush(
        { schoolId: recipient.schoolId, userId: recipient.userId },
        {
          title: "إشعار وصول",
          body: message,
          data: {
            screen: "arrival-notices",
            kind: "guardian_arrival",
            arrivalNoticeId: result.notice.id,
          },
        }
      )
    )
  );
  let pushQueued = 0;
  let pushFailureCount = 0;
  for (const delivery of deliveries) {
    if (delivery.status === "fulfilled") pushQueued += delivery.value;
    else pushFailureCount += 1;
  }

  try {
    await prisma.arrivalNotice.update({
      where: { id: result.notice.id },
      data: {
        pushQueuedCount: pushQueued,
        pushFailureCount,
        pushProcessedAt: new Date(),
      },
    });
  } catch (error) {
    logSafeError("arrival-notification-push-result", error);
  }

  return {
    created: true,
    noticeId: result.notice.id,
    message,
    expectedAt: result.notice.expectedAt,
    cooldownUntil,
    recipients: result.notice.recipients.length,
    pushQueued,
  };
}
