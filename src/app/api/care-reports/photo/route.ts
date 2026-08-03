import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  storeUpload,
  isFailure,
  IMAGE_TYPES,
  IMAGE_LABEL,
  MAX_IMAGE_BYTES,
} from "@/lib/file-upload";

/**
 * The photo attached to a care report (task 2.5).
 *
 * Separate from the generic `/api/upload` for one reason that matters: the
 * object is filed against the **child**, not the report. Anonymisation deletes a
 * child's files by owner id, so a photo owned by a report id would survive the
 * erasure of the record it belongs to — a picture of a child whose data was
 * supposed to be gone.
 *
 * Uploading before the report exists is deliberate. The teacher takes the
 * picture, sees it, then decides what to write; making the photo wait for a
 * saved report would mean a second round trip after the save, on the phone
 * connection least able to afford it.
 */
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
  const schoolId = session.user.schoolId;

  const formData = await request.formData();
  const file = formData.get("file");
  const studentId = formData.get("studentId");

  if (!(file instanceof File)) {
    return Response.json({ error: "لم يتم إرسال ملف" }, { status: 400 });
  }
  if (typeof studentId !== "string" || !studentId) {
    return Response.json({ error: "معرّف الطفل مفقود" }, { status: 400 });
  }

  // Proven to be this tenant's child before a byte is stored — the id comes from
  // the client, and a photo filed against another school's child would be
  // deleted by that school's anonymisation and visible to that school's staff.
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId, deletedAt: null },
    select: { id: true, anonymizedAt: true },
  });
  if (!student) {
    return Response.json({ error: "الطفل غير موجود" }, { status: 404 });
  }
  if (student.anonymizedAt) {
    return Response.json(
      { error: "السجل مجهَّل ولا يمكن إضافة صور له" },
      { status: 409 }
    );
  }

  const stored = await storeUpload(schoolId, file, {
    allowed: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    humanLabel: IMAGE_LABEL,
    category: "care",
    ownerId: student.id,
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  return Response.json({ url: stored.url });
}
