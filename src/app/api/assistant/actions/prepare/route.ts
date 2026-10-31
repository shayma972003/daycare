import { requireSession, sessionErrorResponse } from "@/lib/session";
import { withNoStore } from "@/lib/auth-response";
import { requestTimeZone } from "@/lib/device-date";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  AssistantActionError,
  assistantActionProposalSchema,
  prepareAssistantAction,
} from "@/lib/assistant/actions";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimitResponse(await rateLimit({
    key: `assistant-action-prepare:${session.user.schoolId}:${session.user.id}`,
    limit: 30,
    windowMs: 5 * 60_000,
  }));
  if (limited) return withNoStore(limited);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withNoStore(Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const parsed = assistantActionProposalSchema.safeParse(body);
  if (!parsed.success) {
    return withNoStore(Response.json({ error: "Invalid action" }, { status: 422 }));
  }

  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return withNoStore(Response.json({ error: "Invalid time zone" }, { status: 422 }));
  }

  try {
    const proposal = await prepareAssistantAction({ proposal: parsed.data, session, timeZone });
    return withNoStore(Response.json({ proposal }));
  } catch (error) {
    if (error instanceof AssistantActionError) {
      return withNoStore(Response.json({ error: error.code, code: error.code }, { status: error.status }));
    }
    console.error("[assistant-action] proposal failed");
    return withNoStore(Response.json({ error: "ACTION_PREPARE_FAILED" }, { status: 500 }));
  }
}

