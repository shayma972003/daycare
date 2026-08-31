import { requireSession, sessionErrorResponse } from "@/lib/session";
import { renewalFields, renewStudentSubscription, RenewalError } from "@/lib/student-renewal";
import { withNoStore } from "@/lib/auth-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!session.can("students.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = renewalFields.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid renewal data" }, { status: 422 });
  try {
    const { id } = await params;
    const student = await renewStudentSubscription(parsed.data, { id, schoolId: session.user.schoolId, actor: session.user.name ?? "admin", request });
    const financial = session.can("finance.view") || session.can("finance.manage");
    return withNoStore(Response.json({ student: { ...student, cycleFee: financial ? student.cycleFee : undefined } }));
  } catch (error) {
    return withNoStore(Response.json({ error: "Could not renew subscription", code: error instanceof RenewalError ? error.code : "RENEWAL_FAILED" }, { status: error instanceof RenewalError ? error.status : 500 }));
  }
}
