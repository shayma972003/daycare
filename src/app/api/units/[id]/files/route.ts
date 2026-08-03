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

/**
 * Attachments on a teaching unit (task 2.23).
 *
 * The `UnitFile` table has existed since the units feature shipped; only the
 * upload was missing, because storing a lesson plan as base64 in a column meant
 * a worksheet PDF sat inside the row and came back with every query that touched
 * the unit. With R2 the file is an object and the row holds a path.
 *
 * A separate table rather than columns on `Unit` for the same reason a unit can
 * have a dozen attachments and a list of units must stay small.
 */
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
  const schoolId = session.user.schoolId;
  const { id } = await params;

  const unit = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!unit) return Response.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "لم يتم إرسال ملف" }, { status: 400 });
  }

  const stored = await storeUpload(schoolId, file, {
    allowed: DOCUMENT_TYPES,
    maxBytes: MAX_DOCUMENT_BYTES,
    humanLabel: DOCUMENT_LABEL,
    category: "units",
    ownerId: unit.id,
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  const record = await prisma.unitFile.create({
    data: {
      unitId: unit.id,
      // The uploader's filename, kept for display only. It is never part of the
      // object key, which is a UUID — a name is not unique, may collide, and in
      // this product routinely contains a child's name.
      name: file.name.slice(0, 200),
      url: stored.url,
      mimeType: stored.mime,
      sizeBytes: stored.sizeBytes,
    },
    select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  await logAction({
    school_id: schoolId,
    action: `رفع ملف للوحدة: ${unit.name}`,
    entity_type: "unit",
    entity_id: unit.id,
    entity_name: unit.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(record, { status: 201 });
}
