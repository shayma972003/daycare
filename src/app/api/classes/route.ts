import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeacherOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { assertClassCapacity, planLimitResponse } from "@/lib/plan-limits";
import { parseClassGroup } from "@/lib/enum-labels";
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
    select: {
      id: true,
      name: true,
      group: true,
      period: true,
      registrationDate: true,
      notes: true,
      teacherId: true,
      teacher: { select: { id: true, name: true } },
      imageUrl: true,
      needsTeacherWarning: true,
      // Only ids are needed for the list's student count — full student rows
      // (with base64 avatar/evaluation blobs) are never needed here.
      students: { where: { deletedAt: null }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json(classes, { status: 200 });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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

  // Unchecked, this let a class be assigned another school's teacher — and the
  // list query includes `teacher: { name }`, leaking it straight back out.
  let ownedTeacherId: string | null;
  try {
    await assertClassCapacity(schoolId);
    ownedTeacherId = await assertTeacherOwned(teacherId, schoolId);
  } catch (error) {
    const overLimit = planLimitResponse(error);
    if (overLimit) return overLimit;
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }

  const cls = await prisma.class.create({
    data: {
      schoolId,
      name,
      ...(ownedTeacherId !== null && { teacherId: ownedTeacherId }),
      ...(group !== undefined && { group: parseClassGroup(group) ?? "KG1" }),
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

  await logAction({
    school_id: schoolId,
    action: `إضافة فصل جديد: ${cls.name}`,
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(cls, { status: 201 });
}
