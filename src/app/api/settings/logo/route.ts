export const runtime = "nodejs";

import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { storeUpload, isFailure, LOGO_TYPES, LOGO_LABEL } from "@/lib/file-upload";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function PUT(request: Request) {
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("logo");
  if (!(file instanceof File))
    return Response.json({ error: "No file uploaded" }, { status: 400 });

  // The type used to be read from `file.type` — a value the client chooses.
  // `storeUpload` reads it from the bytes instead, and enforces the tenant's
  // storage quota on the way.
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { logoUrl: true },
  });

  const stored = await storeUpload(schoolId, file, {
    allowed: LOGO_TYPES,
    maxBytes: MAX_BYTES,
    humanLabel: LOGO_LABEL,
    category: "school",
    ownerId: schoolId,
    previousUrl: school?.logoUrl,
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  const logoUrl = stored.url;
  await prisma.school.update({ where: { id: schoolId }, data: { logoUrl } });

  await logAction({
    school_id: schoolId,
    action: "تم تحديث شعار المنشأة",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ logoUrl }, { status: 200 });
}
