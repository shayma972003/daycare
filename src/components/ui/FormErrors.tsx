"use client";

/**
 * What a form says when it refuses to submit.
 *
 * `handleSubmit` does not call the handler when the schema rejects a field, and
 * several forms destructured `errors` and rendered it nowhere. Pressing save
 * then did nothing at all — no request, no message, no clue — and the only way
 * to find out that an ID number was eleven digits instead of ten was to guess.
 *
 * A button that appears broken is worse than one that refuses out loud, so this
 * goes next to the button rather than at the top of a long form the reader would
 * have to scroll back through.
 *
 * The messages come from the zod schemas, which already phrase them for a
 * reader; this only gives them somewhere to appear.
 */

import { useT } from "@/lib/i18n-provider";

/** Flattens react-hook-form's error object, including nested field groups. */
export function collectMessages(errors: unknown): string[] {
  const found: string[] = [];

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown> & { message?: unknown };
    if (typeof record.message === "string" && record.message) {
      found.push(record.message);
      return;
    }
    for (const value of Object.values(record)) walk(value);
  }

  walk(errors);
  return Array.from(new Set(found));
}

export function FormErrors({ messages, title }: { messages: string[]; title?: string }) {
  const t = useT();
  if (messages.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-lg bg-danger-bg border border-red-200 px-3 py-2 text-xs text-danger-text space-y-1"
    >
      <p className="font-medium">{title ?? t("students.profile.fixFirst")}</p>
      <ul className="list-disc ps-4 space-y-0.5">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
