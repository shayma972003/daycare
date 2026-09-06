import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await params;
  return Response.json({ error: "الخطط ثابتة ولا تُعدّل من الواجهة" }, { status: 405, headers: { Allow: "GET" } });
}
