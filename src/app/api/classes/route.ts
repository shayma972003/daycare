import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createClassSchema = z.object({
  name: z.string().min(1),
  teacherId: z.string().optional(),
  group: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  registrationDate: z.string().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
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
  const period = searchParams.get("period");
  const group = searchParams.get("group");

  const where: Record<string, unknown> = { schoolId, deletedAt: null };

  if (period) {
    where.period = period;
  }
  if (group) {
    where.group = group;
  }

  const classes = await prisma.class.findMany({
    where,
    include: {
      teacher: true,
      students: { where: { deletedAt: null } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json(classes, { status: 200 });
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

  const parsed = createClassSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { name, teacherId, group, period, registrationDate, notes, imageUrl } = parsed.data;

  const cls = await prisma.class.create({
    data: {
      schoolId,
      name,
      ...(teacherId !== undefined && { teacherId }),
      ...(group !== undefined && { group }),
      ...(period !== undefined && { period }),
      ...(registrationDate !== undefined && { registrationDate: new Date(registrationDate) }),
      ...(notes !== undefined && { notes }),
      ...(imageUrl !== undefined && { imageUrl }),
    },
    include: {
      teacher: { select: { id: true, name: true } },
      students: true,
    },
  });

  return Response.json(cls, { status: 201 });
}
