import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source"); // "activity" | "other"

  let sourceFilter: Record<string, unknown> = {};
  if (sourceParam === "activity") {
    sourceFilter = { source: "activity" };
  } else if (sourceParam === "other") {
    sourceFilter = { source: { not: "activity" } };
  }

  const { count } = await prisma.notificationLog.deleteMany({
    where: { schoolId, ...sourceFilter },
  });

  return Response.json({ deleted: count });
}
