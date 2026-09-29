import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { studentClassWhere } from "@/lib/student-access-scope";
import { logAction } from "@/lib/activity-logger";
import {
  storeUpload,
  isFailure,
  DOCUMENT_TYPES,
  DOCUMENT_LABEL,
  MAX_DOCUMENT_BYTES,
} from "@/lib/file-upload";
import { discardStoredFile } from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";
import { keyFromUrl, readPrivateObject } from "@/lib/r2";
import { logSafeError } from "@/lib/safe-logger";

const unavailable = () =>
  Response.json({ error: "File is not available" }, { status: 404 });

function privateFileResponse(
  bytes: Uint8Array,
  contentType: string,
  fileName: string | null
) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const encodedName = encodeURIComponent(fileName || "evaluation-file");
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  if (!session.can("students.files")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;
  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null, ...studentClassWhere(session) },
    select: { id: true, evaluationFileUrl: true, evaluationFileName: true },
  });
  if (!student?.evaluationFileUrl) return unavailable();

  // Legacy rows may still contain a data URI. It is decoded only on the
  // server, after the same tenant/class/permission checks as stored objects.
  const legacy = /^data:([^;,]+);base64,([\s\S]+)$/.exec(student.evaluationFileUrl);
  if (legacy) {
    try {
      return privateFileResponse(
        Uint8Array.from(Buffer.from(legacy[2], "base64")),
        legacy[1],
        student.evaluationFileName
      );
    } catch {
      return unavailable();
    }
  }

  const key = keyFromUrl(student.evaluationFileUrl);
  if (!key) return unavailable();
  const stored = await prisma.storedFile.findFirst({
    where: {
      key,
      schoolId,
      ownerType: STORED_FILE_OWNER.STUDENT,
      ownerId: student.id,
      deletePendingAt: null,
    },
    select: { contentType: true },
  });
  if (!stored) return unavailable();

  try {
    const object = await readPrivateObject(key);
    return privateFileResponse(
      object.bytes,
      stored.contentType || object.contentType,
      student.evaluationFileName
    );
  } catch (error) {
    logSafeError("student-evaluation.read", error);
    return unavailable();
  }
}

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
  if (!session.can("students.files")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null, ...studentClassWhere(session) },
  });
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
    ownerType: STORED_FILE_OWNER.STUDENT,
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
    hasEvaluationFile: Boolean(updated.evaluationFileUrl),
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
  if (!session.can("students.files")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null, ...studentClassWhere(session) },
  });
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
