import { requireSession, sessionErrorResponse } from "@/lib/session";
import { withNoStore } from "@/lib/auth-response";
import { assistantRequestSchema, assistantSafePrompt } from "@/lib/assistant/contracts";
import {
  answerAssistantRequest,
  AssistantNotConfiguredError,
  AssistantProviderError,
  assistantConfigured,
} from "@/lib/assistant/openai";
import { requestTimeZone } from "@/lib/device-date";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { logAction } from "@/lib/activity-logger";
import { parseAssistantActionCommand } from "@/lib/assistant/action-command";
import { AssistantActionError, prepareAssistantAction, prepareAssistantUpload } from "@/lib/assistant/actions";

export const maxDuration = 60;

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimitResponse(await rateLimit({
    key: `assistant:${session.user.schoolId}:${session.user.id}`,
    limit: 20,
    windowMs: 5 * 60_000,
  }));
  if (limited) return withNoStore(limited);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return withNoStore(Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const parsed = assistantRequestSchema.safeParse(json);
  if (!parsed.success) {
    return withNoStore(Response.json({ error: "Invalid request" }, { status: 422 }));
  }

  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return withNoStore(Response.json({ error: "Invalid time zone" }, { status: 422 }));
  }

  const lastUserMessage = parsed.data.messages[parsed.data.messages.length - 1]!;
  const actionCommand = parseAssistantActionCommand(lastUserMessage.content, { timeZone });
  if (actionCommand?.kind === "help") {
    return withNoStore(Response.json({ message: actionCommand.message, toolsUsed: [] }));
  }
  if (actionCommand?.kind === "action") {
    try {
      const proposal = await prepareAssistantAction({
        proposal: actionCommand.proposal,
        session,
        timeZone,
      });
      return withNoStore(Response.json({
        message: proposal.summary,
        proposal,
        toolsUsed: [proposal.tool],
      }));
    } catch (error) {
      if (error instanceof AssistantActionError) {
        return withNoStore(Response.json({
          error: error.code,
          code: error.code,
        }, { status: error.status }));
      }
      console.error("[assistant-action] chat proposal failed");
      return withNoStore(Response.json({ error: "ACTION_PREPARE_FAILED", code: "ACTION_PREPARE_FAILED" }, { status: 500 }));
    }
  }
  if (actionCommand?.kind === "upload") {
    try {
      const upload = await prepareAssistantUpload({
        ...actionCommand.upload,
        session,
      });
      return withNoStore(Response.json({
        message: upload.summary,
        upload,
        toolsUsed: [`${upload.kind}_upload`],
      }));
    } catch (error) {
      if (error instanceof AssistantActionError) {
        return withNoStore(Response.json({ error: error.code, code: error.code }, { status: error.status }));
      }
      console.error("[assistant-upload] target preparation failed");
      return withNoStore(Response.json({ error: "UPLOAD_PREPARE_FAILED", code: "UPLOAD_PREPARE_FAILED" }, { status: 500 }));
    }
  }

  if (!assistantConfigured()) {
    return withNoStore(Response.json(
      { error: "المساعد غير مفعّل على الخادم بعد", code: "ASSISTANT_NOT_CONFIGURED" },
      { status: 503 }
    ));
  }

  // The manager's original wording stays inside the application. The provider
  // receives only a fixed aggregate intent, so a pasted name cannot leak even
  // though natural-language name detection is inherently unreliable.
  const safeRequest = {
    messages: [{
      role: "user" as const,
      content: assistantSafePrompt(lastUserMessage.content),
    }],
  };

  try {
    const result = await answerAssistantRequest({ request: safeRequest, session, timeZone });

    // Audit the capability, never the prompt or reply: either may contain a
    // name typed by the manager and does not belong in a permanent audit row.
    await logAction({
      school_id: session.user.schoolId,
      action: "استخدام المساعد الذكي للقراءة",
      entity_type: "assistant",
      performed_by: session.user.name ?? "المدير",
      request,
    });

    return withNoStore(Response.json(result));
  } catch (error) {
    if (error instanceof AssistantNotConfiguredError) {
      return withNoStore(Response.json(
        { error: "المساعد غير مفعّل على الخادم بعد", code: "ASSISTANT_NOT_CONFIGURED" },
        { status: 503 }
      ));
    }
    if (error instanceof AssistantProviderError) {
      console.error("[assistant] provider request failed");
      return withNoStore(Response.json(
        { error: "تعذر إكمال طلب المساعد", code: "ASSISTANT_PROVIDER_ERROR" },
        { status: 502 }
      ));
    }
    console.error("[assistant] unexpected request failure");
    return withNoStore(Response.json(
      { error: "تعذر إكمال طلب المساعد", code: "ASSISTANT_ERROR" },
      { status: 500 }
    ));
  }
}
