import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";

/** Durable in-app messages for the authenticated account. */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owner = context.claims.kind === "guardian"
    ? { guardianAccountId: context.claims.sub }
    : { userId: context.claims.sub };
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
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
