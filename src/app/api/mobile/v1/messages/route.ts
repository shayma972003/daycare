import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({ recipientId: z.string().min(1).optional() }).strict();

function recipientOwner(context: Awaited<ReturnType<typeof requireMobileAuth>>) {
  return context.claims.kind === "guardian"
    ? { guardianAccountId: context.claims.sub }
    : { userId: context.claims.sub };
}

/** Durable in-app messages for the authenticated account. */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owner = recipientOwner(context);
  const recipients = await prisma.activityMessageRecipient.findMany({
    where: { schoolId: context.schoolId, ...owner },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      readAt: true,
      message: {
        select: {
          id: true,
          body: true,
          createdAt: true,
          activity: { select: { id: true, name: true } },
          calendarEvent: { select: { id: true, title: true, type: true } },
          student: { select: { id: true, name: true } },
          absenceDate: true,
        },
      },
    },
  });

  return Response.json({
    messages: recipients.map((recipient) => ({
      recipientId: recipient.id,
      readAt: recipient.readAt,
      id: recipient.message.id,
      body: recipient.message.body,
      createdAt: recipient.message.createdAt,
      activity: recipient.message.activity,
      calendarEvent: recipient.message.calendarEvent,
      student: recipient.message.student,
      absenceDate: recipient.message.absenceDate,
      kind: recipient.message.student && recipient.message.absenceDate
        ? "absence"
        : recipient.message.calendarEvent
          ? "calendar"
          : "activity",
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Marks one of the caller's messages, or all of them, as read. */
export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const result = await prisma.activityMessageRecipient.updateMany({
    where: {
      schoolId: context.schoolId,
      ...recipientOwner(context),
      readAt: null,
      ...(parsed.data.recipientId ? { id: parsed.data.recipientId } : {}),
    },
    data: { readAt: new Date() },
  });

  return Response.json(
    { success: true, updated: result.count },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
