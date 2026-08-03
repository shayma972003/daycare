import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  storeUpload,
  isFailure,
  IMAGE_TYPES,
  IMAGE_LABEL,
  MAX_IMAGE_BYTES,
} from "@/lib/file-upload";
import { discardStoredFile } from "@/lib/stored-files";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const stored = await storeUpload(schoolId, file, {
    allowed: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    humanLabel: IMAGE_LABEL,
    category: "students",
    ownerId: student.id,
    // Replacing a photo must remove the one it replaces; keys are never reused,
    // so without this the bucket keeps every avatar a child has ever had.
    previousUrl: student.avatarUrl,
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  const updated = await prisma.student.update({
    where: { id },
    data: { avatarUrl: stored.url },
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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

  // Nulling the column stops being a deletion once the bytes are in a bucket.
  await discardStoredFile(student.avatarUrl);

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
