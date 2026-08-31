import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { renewalFields, renewStudentSubscription, RenewalError } from "@/lib/student-renewal";
import { bulkSummary, type BulkItemResult } from "@/lib/bulk-result";
import { withNoStore } from "@/lib/auth-response";

const schema = renewalFields.pick({ mode: true, enrollmentEndDate: true, reactivate: true }).extend({ ids: z.array(z.string().min(1)).min(1).max(500) });

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!session.can("students.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid renewal data" }, { status: 422 });
  const results: BulkItemResult[] = [];
  for (const id of new Set(parsed.data.ids)) {
    try {
      await renewStudentSubscription(parsed.data, { id, schoolId: session.user.schoolId, actor: session.user.name ?? "admin", request });
      results.push({ id, status: "succeeded" });
    } catch (error) {
      results.push({ id, status: "failed", code: error instanceof RenewalError ? error.code : "RENEWAL_FAILED" });
    }
  }
  const summary = bulkSummary(results);
  return withNoStore(Response.json({ success: summary.failed === 0, updated: summary.succeeded, ...summary }, { status: summary.failed ? 207 : 200 }));
}
