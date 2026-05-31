import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  teacherId: z.string().nullish(),
  group: z.string().nullish(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  notes: z.string().nullish(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const cls = await prisma.class.findFirst({
    where: { id, schoolId },
    include: {
      teacher: true,
      students: true,
    },
  });

  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(cls, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateClassSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if ("teacherId" in data) updateData.teacherId = data.teacherId ?? null;
  if ("group" in data) updateData.group = data.group ?? null;
  if ("period" in data) updateData.period = data.period ?? null;
  if ("notes" in data) updateData.notes = data.notes ?? null;

  const existing = await prisma.class.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const cls = await prisma.class.update({
    where: { id },
    data: updateData,
    include: {
      teacher: true,
      students: true,
    },
  });

  return Response.json(cls, { status: 200 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const existing = await prisma.class.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.class.delete({ where: { id } });

  return Response.json({ success: true });
}
