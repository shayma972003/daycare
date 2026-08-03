import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const reports = await prisma.financialReport.findMany({
    where: { school_id: schoolId },
    orderBy: { issued_at: "desc" },
    select: { id: true, name: true, type: true, period_label: true, file_url: true, issued_at: true },
  });

  return Response.json(reports);
}

const createSchema = z.object({
  name: z.string(),
  type: z.enum(["monthly", "semi_annual", "annual"]),
  period_label: z.string(),
  file_url: z.string(),
});

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 422 });

  const report = await prisma.financialReport.create({
    data: { school_id: schoolId, ...parsed.data },
  });

  return Response.json(report, { status: 201 });
}
