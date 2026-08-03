/**
 * Push notification delivery (tasks 1.10 and 1.11).
 *
 * Queued, never sent inline. The request that causes a notification — a teacher
 * tapping "record attendance" — must not wait on a third-party HTTP call, and
 * must not fail because that call did. Rows go into `PushNotification` and a
 * worker drains them.
 *
 * Two transports, because Huawei devices ship without Google Play Services.
 * FCM accepts a message for such a device and it is never delivered: no error,
 * no retry, no way to tell from the API response. That silent failure is why
 * `PushPlatform` treats HUAWEI as its own platform rather than a flavour of
 * Android.
 *
 * Both adapters no-op with a warning when their credentials are absent, matching
 * how `sendWhatsApp`/`sendEmail` behave. A developer without Firebase keys gets
 * a working app and a log line, not a crash.
 */

import { prisma } from "@/lib/prisma";
import type { PushPlatform } from "@/generated/prisma/enums";

/** Attempts before a notification is abandoned. */
const MAX_ATTEMPTS = 3;
/** Bounded per run so one invocation cannot exceed the function timeout. */
const BATCH_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  /**
   * Deep-link data only.
   *
   * Never health notes, contact details or anything else sensitive: a push
   * payload is rendered on a lock screen, sits in the provider's logs, and
   * passes through Google's or Huawei's infrastructure on the way. The
   * notification says a report exists; the app fetches its contents over an
   * authenticated call.
   */
  data?: Record<string, string>;
}

export interface PushTarget {
  schoolId: string;
  guardianAccountId?: string;
  userId?: string;
}

/**
 * Queues a notification for every device the recipient has registered.
 *
 * One row per device, not per person: a guardian with a phone and a tablet
 * expects both to buzz, and a single row could only ever reach one of them.
 */
export async function enqueuePush(
  target: PushTarget,
  payload: PushPayload
): Promise<number> {
  const devices = await prisma.deviceToken.findMany({
    where: {
      schoolId: target.schoolId,
      ...(target.guardianAccountId ? { guardianAccountId: target.guardianAccountId } : {}),
      ...(target.userId ? { userId: target.userId } : {}),
      // A token the provider has permanently rejected is not retried — the app
      // was uninstalled, and every send would fail identically for ever.
      failedAt: null,
    },
    select: { id: true },
  });

  if (devices.length === 0) return 0;

  await prisma.pushNotification.createMany({
    data: devices.map((device) => ({
      schoolId: target.schoolId,
      deviceTokenId: device.id,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    })),
  });

  return devices.length;
}

export interface SendResult {
  ok: boolean;
  /** True when the token will never work again — uninstalled, or rotated away. */
  permanentFailure?: boolean;
  error?: string;
}

/**
 * Firebase Cloud Messaging — iOS and Android.
 *
 * Uses the HTTP v1 API through a server key supplied as `FCM_SERVER_KEY`. The
 * legacy `key=` scheme is what most examples still show and is being switched
 * off by Google; this sends the modern bearer form.
 */
async function sendViaFcm(
  token: string,
  payload: PushPayload
): Promise<SendResult> {
  const key = process.env.FCM_SERVER_KEY;
  const projectId = process.env.FCM_PROJECT_ID;

  if (!key || !projectId) {
    console.warn("[push] FCM credentials missing — notification not sent");
    return { ok: false, error: "FCM_NOT_CONFIGURED" };
  }

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data ?? {},
          },
        }),
      }
    );

    if (response.ok) return { ok: true };

    const text = await response.text();
    // 404 / UNREGISTERED means the app is gone from that device. Retrying is
    // pointless and the row should stop being a target.
    const permanent =
      response.status === 404 ||
      text.includes("UNREGISTERED") ||
      text.includes("INVALID_ARGUMENT");
    return { ok: false, permanentFailure: permanent, error: text.slice(0, 300) };
  } catch (error) {
    // Network-level: retryable, so no permanent flag.
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

/**
 * Huawei Mobile Services — AppGallery devices.
 *
 * A separate credential set and a separate endpoint. Nothing about an FCM
 * integration carries over, which is the whole reason this exists: without it,
 * every Huawei user would appear to be receiving notifications and would in fact
 * receive none.
 */
async function sendViaHms(
  token: string,
  payload: PushPayload
): Promise<SendResult> {
  const appId = process.env.HMS_APP_ID;
  const accessToken = process.env.HMS_ACCESS_TOKEN;

  if (!appId || !accessToken) {
    console.warn("[push] HMS credentials missing — notification not sent");
    return { ok: false, error: "HMS_NOT_CONFIGURED" };
  }

  try {
    const response = await fetch(
      `https://push-api.cloud.huawei.com/v1/${appId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: [token],
            notification: { title: payload.title, body: payload.body },
            android: {
              notification: { title: payload.title, body: payload.body },
            },
            data: JSON.stringify(payload.data ?? {}),
          },
        }),
      }
    );

    const text = await response.text();
    if (response.ok && !text.includes('"code":"80')) return { ok: true };

    // 80300007 / 80300008 are Huawei's "token no longer valid" codes.
    const permanent = text.includes("80300007") || text.includes("80300008");
    return { ok: false, permanentFailure: permanent, error: text.slice(0, 300) };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

function transportFor(platform: PushPlatform) {
  return platform === "HUAWEI" ? sendViaHms : sendViaFcm;
}

export interface DrainResult {
  sent: number;
  failed: number;
  abandoned: number;
  retiredTokens: number;
}

/**
 * Delivers queued notifications.
 *
 * Each row is isolated: one bad token must not stop the queue, which is how the
 * trash-cleanup job silently did nothing for months before task 0.24. Attempts
 * are counted and capped — a notification nobody can receive should stop
 * consuming the batch rather than blocking it for ever.
 */
export async function drainPushQueue(limit = BATCH_SIZE): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, abandoned: 0, retiredTokens: 0 };

  const pending = await prisma.pushNotification.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: new Date() },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });

  for (const notification of pending) {
    if (!notification.deviceTokenId) {
      await prisma.pushNotification.update({
        where: { id: notification.id },
        data: { status: "FAILED", lastError: "NO_DEVICE" },
      });
      result.abandoned++;
      continue;
    }

    const device = await prisma.deviceToken.findUnique({
      where: { id: notification.deviceTokenId },
      select: { token: true, platform: true, failedAt: true },
    });

    if (!device || device.failedAt) {
      await prisma.pushNotification.update({
        where: { id: notification.id },
        data: { status: "FAILED", lastError: "DEVICE_RETIRED" },
      });
      result.abandoned++;
      continue;
    }

    const payload: PushPayload = {
      title: notification.title,
      body: notification.body,
      data: (notification.data as Record<string, string> | null) ?? undefined,
    };

    let outcome: SendResult;
    try {
      outcome = await transportFor(device.platform)(device.token, payload);
    } catch (error) {
      outcome = { ok: false, error: String(error).slice(0, 300) };
    }

    if (outcome.ok) {
      await prisma.pushNotification.update({
        where: { id: notification.id },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
      result.sent++;
      continue;
    }

    if (outcome.permanentFailure) {
      // Retire the device so nothing else is queued for it, and stop retrying
      // this one.
      await prisma.$transaction([
        prisma.deviceToken.update({
          where: { id: notification.deviceTokenId },
          data: { failedAt: new Date() },
        }),
        prisma.pushNotification.update({
          where: { id: notification.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            lastError: outcome.error ?? "PERMANENT",
          },
        }),
      ]);
      result.retiredTokens++;
      result.abandoned++;
      continue;
    }

    const attempts = notification.attempts + 1;
    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: {
        attempts,
        lastError: outcome.error ?? "UNKNOWN",
        // Stays PENDING while retries remain; backs off so a provider outage is
        // not hammered by the same batch every minute.
        ...(attempts >= MAX_ATTEMPTS
          ? { status: "FAILED" as const }
          : { scheduledAt: new Date(Date.now() + attempts * 5 * 60 * 1000) }),
      },
    });

    if (attempts >= MAX_ATTEMPTS) result.abandoned++;
    else result.failed++;
  }

  console.log("[push] drain:", result);
  return result;
}
