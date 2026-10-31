import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { withNoStore } from "@/lib/auth-response";
import { requestTimeZone } from "@/lib/device-date";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { AssistantActionError, confirmAssistantAction } from "@/lib/assistant/actions";

const schema = z.object({ token: z.string().min(40).max(8_000) }).strict();

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimitResponse(await rateLimit({
    key: `assistant-action-confirm:${session.user.schoolId}:${session.user.id}`,
    limit: 20,
    windowMs: 5 * 60_000,
  }));
  if (limited) return withNoStore(limited);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withNoStore(Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return withNoStore(Response.json({ error: "Invalid action token" }, { status: 422 }));

  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return withNoStore(Response.json({ error: "Invalid time zone" }, { status: 422 }));
  }

  try {
    const result = await confirmAssistantAction({
      token: parsed.data.token,
      session,
      timeZone,
      request,
    });
    return withNoStore(Response.json(result));
  } catch (error) {
    if (error instanceof AssistantActionError) {
      return withNoStore(Response.json({ error: error.code, code: error.code }, { status: error.status }));
    }
    console.error("[assistant-action] confirmation failed");
    return withNoStore(Response.json({ error: "ACTION_CONFIRM_FAILED" }, { status: 500 }));
  }
}

