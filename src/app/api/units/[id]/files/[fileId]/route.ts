import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { discardStoredFile } from "@/lib/stored-files";

/** Removes one attachment, and the object behind it. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
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
  const { id, fileId } = await params;

  // Joined through the unit rather than trusting `fileId` alone: the id comes
  // from the client, and `UnitFile` has no tenant column of its own.
  const file = await prisma.unitFile.findFirst({
    where: { id: fileId, unitId: id, unit: { schoolId, deletedAt: null } },
    select: { id: true, name: true, url: true, unit: { select: { name: true } } },
  });
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.unitFile.delete({ where: { id: file.id } });
  await discardStoredFile(file.url);

  await logAction({
    school_id: schoolId,
    action: `حذف ملف من الوحدة: ${file.unit.name}`,
    entity_type: "unit",
    entity_id: id,
    entity_name: file.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
