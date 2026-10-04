import { withNoStore } from "@/lib/auth-response";
import { loadCareReportPolicy } from "@/lib/care-report-policy";
import { mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";

export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return withNoStore(Response.json(await loadCareReportPolicy(context.schoolId)));
}
