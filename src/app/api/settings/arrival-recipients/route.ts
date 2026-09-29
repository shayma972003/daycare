import { activityLogData } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { z } from "zod";

const updateSchema = z
  .object({
    userIds: z.array(z.string().min(1)).max(50),
  })
  .strict();

function sessionFailure(error: unknown) {
  return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session.can("settings.manage")) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const schoolId = session.user.schoolId;
  const [accounts, selected] = await Promise.all([
    prisma.user.findMany({
      where: {
        schoolId,
        disabledAt: null,
        acceptedAt: { not: null },
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        roleRef: { select: { nameAr: true } },
      },
    }),
    prisma.arrivalRecipientSetting.findMany({
      where: { schoolId },
      select: { userId: true },
    }),
  ]);

  return withNoStore(
    Response.json({
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email,
        roleName: account.roleRef?.nameAr ?? null,
      })),
      selectedUserIds: selected.map(({ userId }) => userId),
    })
  );
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session.can("settings.manage")) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

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

  const schoolId = session.user.schoolId;
  const userIds = [...new Set(parsed.data.userIds)];
  const valid = userIds.length === 0
    ? []
    : await prisma.user.findMany({
        where: {
          id: { in: userIds },
          schoolId,
          disabledAt: null,
          acceptedAt: { not: null },
        },
        select: { id: true },
      });
  if (valid.length !== userIds.length) {
    return Response.json(
      { error: "تتضمن القائمة حساباً غير متاح", code: "INVALID_RECIPIENT" },
      { status: 422 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.arrivalRecipientSetting.deleteMany({ where: { schoolId } });
    if (userIds.length > 0) {
      await tx.arrivalRecipientSetting.createMany({
        data: userIds.map((userId) => ({ schoolId, userId })),
      });
    }
    await tx.activityLog.create({
      data: activityLogData({
        school_id: schoolId,
        action: `تم تحديث مستلمي إشعار الوصول (${userIds.length})`,
        entity_type: "arrival_notification_settings",
        performed_by: session.user.name ?? "المدير",
        request,
      }),
    });
  });

  return withNoStore(Response.json({ selectedUserIds: userIds }));
}
