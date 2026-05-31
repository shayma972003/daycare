import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createActivitySchema = z.object({
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  teacherId: z.string().optional(),
  group: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  childrenCount: z.number().int().optional(),
  activityFee: z.number().optional(),
  fee: z.number().optional(),
  imageUrl: z.string().optional(),
  message: z.string().optional(),
  classIds: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const { searchParams } = new URL(request.url);
  const dateFilter = searchParams.get("dateFilter");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = { schoolId };
  // Auto-archive by date: current = endDate >= today, past = endDate < today
  if (dateFilter === "current") where.endDate = { gte: today };
  if (dateFilter === "past") where.endDate = { lt: today };

  const activities = await prisma.activity.findMany({
    where,
    include: { teacher: true },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(activities, { status: 200 });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createActivitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    name,
    startDate,
    endDate,
    teacherId,
    group,
    period,
    childrenCount,
    activityFee,
    fee,
    imageUrl,
    message,
    classIds,
  } = parsed.data;

  const resolvedFee = fee ?? activityFee;

  const activity = await prisma.activity.create({
    data: {
      schoolId,
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      ...(teacherId !== undefined && { teacherId }),
      ...(group !== undefined && { group }),
      ...(period !== undefined && { period }),
      ...(childrenCount !== undefined && { childrenCount }),
      ...(resolvedFee !== undefined && { activityFee: resolvedFee }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(message !== undefined && { message }),
      ...(classIds && classIds.length > 0 && {
        activityInvites: {
          create: classIds.map((classId) => ({ classId })),
        },
      }),
    },
    include: { teacher: true, activityInvites: { include: { class: true } } },
  });

  return Response.json(activity, { status: 201 });
}
