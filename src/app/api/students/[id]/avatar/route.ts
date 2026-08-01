import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  validateUpload,
  isFailure,
  IMAGE_TYPES,
  IMAGE_LABEL,
  MAX_IMAGE_BYTES,
} from "@/lib/file-upload";

export async function POST(
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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "No file" }, { status: 400 });
  }

  const validated = await validateUpload(file, IMAGE_TYPES, MAX_IMAGE_BYTES, IMAGE_LABEL);
  if (isFailure(validated)) {
    return Response.json({ error: validated.error }, { status: validated.status });
  }

  const updated = await prisma.student.update({
    where: { id },
    data: { avatarUrl: validated.dataUrl },
  });

  await logAction({
    school_id: schoolId,
    action: `رفع صورة للطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, avatar_url: updated.avatarUrl });
}

export async function DELETE(
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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.student.update({
    where: { id },
    data: { avatarUrl: null },
  });

  await logAction({
    school_id: schoolId,
    action: `حذف صورة الطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
