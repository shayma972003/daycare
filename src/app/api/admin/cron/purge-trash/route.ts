import { cleanupExpiredTrash } from "@/lib/trash-cleanup";
import { deleteExpiredImportSessions } from "@/lib/import-cleanup";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await cleanupExpiredTrash();
  await deleteExpiredImportSessions();

  return Response.json({ success: true, ran_at: new Date().toISOString() });
}
