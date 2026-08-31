import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { withNoStore } from "@/lib/auth-response";
import { logAction } from "@/lib/activity-logger";

export async function GET(
  _request: Request,
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

  const cls = await prisma.class.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const students = await prisma.student.findMany({
    where: { classId: id, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });

  return withNoStore(Response.json({ count: students.length, students }, { status: 200 }));
}

/** Remove a child from this class without deleting any child or history. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("classes.assign")) return Response.json({ error: "Forbidden" }, { status: 403 });
  const schoolId = session.user.schoolId;
  const { id: classId } = await params;
  const studentId = new URL(request.url).searchParams.get("studentId");
  if (!studentId) return Response.json({ error: "studentId is required" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const cls = await tx.class.findFirst({ where: { id: classId, schoolId, deletedAt: null }, select: { id: true, name: true } });
    if (!cls) return { kind: "not_found" as const };
    // CAS: the child must still belong to this exact class. A stale page cannot
    // detach a child that has since moved to another class.
    const removed = await tx.student.updateMany({
      where: { id: studentId, schoolId, classId, deletedAt: null },
      data: { classId: null, needsClassWarning: true },
    });
    if (removed.count !== 1) return { kind: "stale" as const };
    return { kind: "removed" as const, className: cls.name };
  });
  if (result.kind === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  if (result.kind === "stale") return Response.json({ error: "Student is no longer in this class" }, { status: 409 });
  await logAction({ school_id: schoolId, action: `Remove student from class: ${result.className}`, entity_type: "class", entity_id: classId, entity_name: result.className, performed_by: session.user.name ?? "manager", request });
  return withNoStore(Response.json({ success: true }, { status: 200 }));
}
