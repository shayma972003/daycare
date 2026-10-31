import {
  arrivalMinutesFromDates,
  arrivalNoticeMessage,
  createGuardianArrivalNotice,
} from "@/lib/arrival-notifications";
import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const arrivalRequestSchema = z.object({
  minutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15)]),
}).strict();

/** Parent action: one arrival choice and no child picker. */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "guardian" });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body-free requests remain five-minute notices so already-installed builds
  // keep working while the new choice button rolls out.
  const body = await request.json().catch(() => null);
  const parsed = arrivalRequestSchema.safeParse(body ?? { minutes: 5 });
  if (!parsed.success) {
    return Response.json({ error: "خيار وقت الوصول غير صحيح" }, { status: 422 });
  }

  const result = await createGuardianArrivalNotice({
    schoolId: context.schoolId,
    guardianAccountId: context.claims.sub,
    arrivalMinutes: parsed.data.minutes,
  });

  if (!result.created) {
    if (result.reason === "COOLDOWN") {
      return Response.json(
        {
          error: "يمكن إرسال إشعار الوصول مرة واحدة كل 5 دقائق",
          code: "ARRIVAL_COOLDOWN",
          retryAfterSeconds: result.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(result.retryAfterSeconds),
          },
        }
      );
    }
    return Response.json(
      { error: "الحساب غير متاح", code: "ACCOUNT_UNAVAILABLE" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return Response.json(
    {
      noticeId: result.noticeId,
      message: result.message,
      expectedAt: result.expectedAt,
      cooldownUntil: result.cooldownUntil,
      recipients: result.recipients,
    },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}

/** Durable staff inbox. Only accounts selected at send time receive each row. */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "staff" });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipients = await prisma.arrivalNoticeRecipient.findMany({
    where: {
      schoolId: context.schoolId,
      userId: context.claims.sub,
      readAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      readAt: true,
      notice: {
        select: {
          id: true,
          senderName: true,
          expectedAt: true,
          createdAt: true,
        },
      },
    },
  });

  return Response.json(
    {
      notices: recipients.map(({ notice, readAt }) => ({
        ...notice,
        readAt,
        message: arrivalNoticeMessage(
          notice.senderName,
          arrivalMinutesFromDates(notice.expectedAt, notice.createdAt)
        ),
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

/** Acknowledges one notice for the signed-in selected staff account only. */
export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "staff" });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { noticeId?: unknown } | null;
  const noticeId = typeof body?.noticeId === "string" ? body.noticeId.trim() : "";
  if (!noticeId) {
    return Response.json({ error: "الإشعار غير صحيح" }, { status: 422 });
  }

  const result = await prisma.arrivalNoticeRecipient.updateMany({
    where: {
      noticeId,
      schoolId: context.schoolId,
      userId: context.claims.sub,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  if (result.count === 0) {
    return Response.json({ error: "الإشعار غير موجود" }, { status: 404 });
  }

  return Response.json(
    { success: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
