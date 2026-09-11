import { requireSession, sessionErrorResponse } from "@/lib/session";
import { getFinancialSummary, type ReportPeriodType } from "@/lib/finance";
import { logSafeError } from "@/lib/safe-logger";

const VALID_TYPES: ReportPeriodType[] = ["monthly", "semi_annual", "annual"];

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const type: ReportPeriodType = VALID_TYPES.includes(typeParam as ReportPeriodType) ? (typeParam as ReportPeriodType) : "monthly";

  try {
    const summary = await getFinancialSummary(schoolId, type);
    return Response.json(summary);
  } catch (error) {
    logSafeError("statistics-dashboard", error);
    return Response.json({ error: "Could not load financial summary" }, { status: 500 });
  }
}
