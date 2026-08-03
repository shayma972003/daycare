import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  storeUpload,
  isFailure,
  DOCUMENT_TYPES,
  DOCUMENT_LABEL,
  MAX_DOCUMENT_BYTES,
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
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const stored = await storeUpload(schoolId, file, {
    allowed: DOCUMENT_TYPES,
    maxBytes: MAX_DOCUMENT_BYTES,
    humanLabel: DOCUMENT_LABEL,
    category: "students",
    ownerId: student.id,
    previousUrl: student.evaluationFileUrl,
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  const updated = await prisma.student.update({
    where: { id },
    data: { evaluationFileUrl: stored.url, evaluationFileName: file.name },
  });

  await logAction({
    school_id: schoolId,
    action: `رفع ملف تقييم للطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({
    evaluationFileUrl: updated.evaluationFileUrl,
    evaluationFileName: updated.evaluationFileName,
  });
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
    data: { evaluationFileUrl: null, evaluationFileName: null },
  });

  // Nulling the column stops being a deletion once the bytes are in a bucket.
  await discardStoredFile(student.evaluationFileUrl);

  await logAction({
    school_id: schoolId,
    action: `حذف ملف تقييم الطالب: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
