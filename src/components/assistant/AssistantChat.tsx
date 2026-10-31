"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n-provider";
import { deviceHeaders } from "@/lib/device-date";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ActionProposal {
  token: string;
  expiresAt: string;
  title: string;
  summary: string;
  tool: string;
}

interface UploadTarget {
  kind: "avatar" | "evaluation" | "unit_file" | "school_logo" | "student_import";
  studentId?: string;
  studentName?: string;
  endpoint: string;
  method: "POST" | "PUT";
  formField: string;
  extraFields?: Record<string, string>;
  accept: string;
  title: string;
  summary: string;
  successMessage: string;
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AssistantChat({ variant = "page" }: { variant?: "page" | "panel" }) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", content: t("assistant.welcome") },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionProposal | null>(null);
  const [pendingUpload, setPendingUpload] = useState<UploadTarget | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  async function submitQuestion(question: string) {
    const content = question.trim();
    if (!content || busy) return;

    const userMessage: ChatMessage = { id: messageId(), role: "user", content };
    const nextMessages = [...messages, userMessage].slice(-10);
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setPendingUpload(null);
    setUploadFile(null);
    setBusy(true);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deviceHeaders() },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })),
        }),
      });
      const payload = await response.json().catch(() => null) as {
        message?: string;
        code?: string;
        proposal?: ActionProposal;
        upload?: UploadTarget;
      } | null;

      if (!response.ok || !payload?.message) {
        setError(actionErrorMessage(payload?.code));
        return;
      }

      setMessages((current) => [
        ...current,
        { id: messageId(), role: "assistant" as const, content: payload.message! },
      ].slice(-10));
      if (payload.proposal) setPendingAction(payload.proposal);
      if (payload.upload) {
        setPendingAction(null);
        setPendingUpload(payload.upload);
      }
    } catch {
      setError(t("assistant.genericError"));
    } finally {
      setBusy(false);
    }
  }

  function actionErrorMessage(code?: string) {
    if (code === "ASSISTANT_NOT_CONFIGURED") return t("assistant.notConfigured");
    if (code === "SUBJECT_NOT_FOUND") return t("assistant.actionNotFound");
    if (code === "AMBIGUOUS_SUBJECT") return t("assistant.actionAmbiguous");
    if (code === "FORBIDDEN") return t("assistant.actionForbidden");
    if (code === "NO_GUARDIAN_EMAIL") return t("assistant.noGuardianEmail");
    if (code === "DUPLICATE_RECORD") return t("assistant.duplicateRecord");
    if (code === "PLAN_LIMIT") return t("assistant.planLimit");
    if (code === "NO_ELIGIBLE_RECIPIENTS") return t("assistant.noEligibleRecipients");
    if (code === "INVALID_OR_USED_APPROVAL") return t("assistant.actionExpired");
    if (code === "STALE_RECORD") return t("assistant.staleRecord");
    if (code === "RATE_LIMITED") return t("assistant.rateLimited");
    if (code === "DELIVERY_FAILED") return t("assistant.deliveryFailed");
    if (code === "CLASS_NOT_FOUND") return t("assistant.classNotFound");
    if (code === "GUARDIAN_PHONE_REQUIRED") return t("assistant.guardianPhoneRequired");
    if (code === "AMBIGUOUS_GUARDIAN") return t("assistant.ambiguousGuardian");
    if (code === "SUBSCRIPTION_FEE_NOT_CONFIGURED") return t("assistant.subscriptionFeeMissing");
    if (code === "REACTIVATION_REQUIRED") return t("assistant.reactivationRequired");
    if (code === "ANONYMIZED_STUDENT") return t("assistant.anonymizedStudent");
    if (code === "NO_CHANGE") return t("assistant.noChange");
    if (code === "NOTE_REQUIRED") return t("assistant.noteRequired");
    if (code === "DATE_REQUIRED") return t("assistant.dateRequired");
    if (code === "IMPORT_HAS_ERRORS") return t("assistant.importHasErrors");
    if (code === "TEACHER_RESUBMISSION_REQUIRED") return t("assistant.teacherResubmissionRequired");
    if (code === "NOT_MONTHLY_EXPENSE") return t("assistant.notMonthlyExpense");
    if (code === "APPROVED_REPORT_IMMUTABLE") return t("assistant.approvedReportImmutable");
    return t("assistant.genericError");
  }

  async function confirmAction() {
    if (!pendingAction || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deviceHeaders() },
        body: JSON.stringify({ token: pendingAction.token }),
      });
      const payload = await response.json().catch(() => null) as { message?: string; code?: string } | null;
      if (!response.ok || !payload?.message) {
        setError(actionErrorMessage(payload?.code));
        return;
      }
      setMessages((current) => [
        ...current,
        { id: messageId(), role: "assistant" as const, content: payload.message! },
      ].slice(-10));
      setPendingAction(null);
    } catch {
      setError(t("assistant.genericError"));
    } finally {
      setBusy(false);
    }
  }

  function cancelAction() {
    setPendingAction(null);
    setMessages((current) => [
      ...current,
      { id: messageId(), role: "assistant" as const, content: t("assistant.actionCancelled") },
    ].slice(-10));
  }

  async function submitUpload() {
    if (!pendingUpload || !uploadFile || busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append(pendingUpload.formField, uploadFile);
      for (const [key, value] of Object.entries(pendingUpload.extraFields ?? {})) form.append(key, value);
      const response = await fetch(pendingUpload.endpoint, {
        method: pendingUpload.method,
        headers: deviceHeaders(),
        body: form,
      });
      const payload = await response.json().catch(() => null) as { error?: string; session_id?: string } | null;
      if (!response.ok) {
        setError(payload?.error || t("assistant.uploadError"));
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant" as const,
          content: pendingUpload.kind === "student_import" && payload?.session_id
            ? `${pendingUpload.successMessage}\nرقم جلسة الاستيراد: ${payload.session_id}`
            : pendingUpload.successMessage,
        },
      ].slice(-10));
      setPendingUpload(null);
      setUploadFile(null);
    } catch {
      setError(t("assistant.uploadError"));
    } finally {
      setBusy(false);
    }
  }

  function cancelUpload() {
    setPendingUpload(null);
    setUploadFile(null);
    setMessages((current) => [
      ...current,
      { id: messageId(), role: "assistant" as const, content: t("assistant.actionCancelled") },
    ].slice(-10));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(draft);
  }

  const suggestions = [
    t("assistant.suggestRoster"),
    t("assistant.suggestAttendance"),
    t("assistant.suggestFinance"),
    t("assistant.suggestCalendar"),
    t("assistant.suggestCare"),
    t("assistant.suggestEnrollment"),
    t("assistant.suggestStorage"),
  ];
  const compact = variant === "panel";

  return (
    <div className={cn(
      "flex w-full flex-col",
      compact ? "min-h-0 flex-1 gap-3 p-3 sm:p-4" : "mx-auto max-w-5xl gap-4 p-4 sm:p-6 lg:p-8"
    )}>
      <section className={cn(
        "border border-[#dacdf0] bg-gradient-to-br from-[#f5efff] to-white",
        compact ? "rounded-xl p-3" : "rounded-2xl p-5 sm:p-6"
      )}>
        {!compact && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#2d2238]">{t("assistant.title")}</h2>
              <p className="mt-1 text-sm text-[#776c80]">{t("assistant.subtitle")}</p>
            </div>
            <span className="rounded-full bg-[#e8dcfb] px-3 py-1 text-xs font-bold text-[#5b14d1]">
              {t("assistant.readOnlyBadge")}
            </span>
          </div>
        )}
        <div className={cn("rounded-xl border border-emerald-100 bg-emerald-50/70", compact ? "p-3" : "mt-4 p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-emerald-900">{t("assistant.privacyTitle")}</p>
            {compact && (
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
                {t("assistant.readOnlyBadge")}
              </span>
            )}
          </div>
          {!compact && <p className="mt-1 text-sm leading-6 text-emerald-800">{t("assistant.privacyBody")}</p>}
          <p className="mt-1 text-xs text-emerald-700">{t("assistant.sessionOnly")}</p>
        </div>
      </section>

      <section className={cn(
        "flex flex-col overflow-hidden border border-[#e8e3ef] bg-white shadow-sm",
        compact ? "min-h-0 flex-1 rounded-xl" : "min-h-[32rem] rounded-2xl"
      )}>
        <div className={cn("flex-1 space-y-3 overflow-y-auto", compact ? "p-3 sm:p-4" : "p-4 sm:p-6")} aria-live="polite">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-start" : "justify-end"}`}
            >
              <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[75%] ${
                message.role === "user"
                  ? "bg-[#5b14d1] text-white"
                  : "border border-[#eeeaf2] bg-[#faf8fc] text-[#2d2238]"
              }`}>
                {message.content}
              </p>
            </div>
          ))}
          {busy && (
            <p role="status" className="w-fit rounded-2xl border border-[#eeeaf2] bg-[#faf8fc] px-4 py-3 text-sm text-[#776c80]">
              {t("assistant.thinking")}
            </p>
          )}
          {pendingAction && (
            <div className="mr-auto max-w-[92%] rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:max-w-[80%]" role="alert">
              <p className="font-bold text-amber-950">{pendingAction.title}</p>
              <p className="mt-1 text-sm leading-6 text-amber-900">{pendingAction.summary}</p>
              <p className="mt-1 text-xs text-amber-700">{t("assistant.approvalExpires")}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void confirmAction()} disabled={busy} className="rounded-lg bg-[#5b14d1] px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300">
                  {busy ? t("assistant.executingAction") : t("assistant.confirmAction")}
                </button>
                <button type="button" onClick={cancelAction} disabled={busy} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
          {pendingUpload && (
            <div className="mr-auto max-w-[92%] rounded-2xl border border-[#d9c9f2] bg-[#f8f4ff] p-4 sm:max-w-[80%]">
              <p className="font-bold text-[#2d2238]">{pendingUpload.title}</p>
              <p className="mt-1 text-sm leading-6 text-[#5f5369]">{pendingUpload.summary}</p>
              <input
                type="file"
                accept={pendingUpload.accept}
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                disabled={busy}
                className="mt-3 block w-full rounded-lg border border-[#d9c9f2] bg-white p-2 text-sm text-[#2d2238] file:ml-3 file:rounded-md file:border-0 file:bg-[#e8dcfb] file:px-3 file:py-2 file:font-semibold file:text-[#5b14d1]"
              />
              <p className="mt-2 text-xs text-[#776c80]">{t("assistant.uploadPrivacy")}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void submitUpload()} disabled={busy || !uploadFile} className="rounded-lg bg-[#5b14d1] px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300">
                  {busy ? t("assistant.uploading") : t("assistant.uploadFile")}
                </button>
                <button type="button" onClick={cancelUpload} disabled={busy} className="rounded-lg border border-[#d9c9f2] bg-white px-4 py-2 text-sm font-semibold text-[#5b14d1]">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className={cn("border-t border-[#eeeaf2]", compact ? "p-3" : "p-4 sm:p-5")}>
          <p className="mb-2 text-xs font-medium text-[#776c80]">{t("assistant.suggestions")}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void submitQuestion(suggestion)}
                disabled={busy}
                className="rounded-full border border-[#d9c9f2] px-3 py-2 text-xs text-[#5b14d1] transition hover:bg-[#f5efff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <label htmlFor={compact ? "assistant-panel-question" : "assistant-question"} className="sr-only">{t("assistant.placeholder")}</label>
            <textarea
              id={compact ? "assistant-panel-question" : "assistant-question"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2_000}
              rows={2}
              disabled={busy}
              placeholder={t("assistant.placeholder")}
              className="min-h-12 flex-1 resize-none rounded-xl border border-[#d9d2df] bg-white px-4 py-3 text-sm text-[#2d2238] outline-none transition focus:border-[#5b14d1] focus:ring-2 focus:ring-[#5b14d1]/15 disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="min-h-12 rounded-xl bg-[#5b14d1] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#4810a8] disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {t("assistant.send")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
