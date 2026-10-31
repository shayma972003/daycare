"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { useT } from "@/lib/i18n-provider";

export function AssistantDock() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const launcher = launcherRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      launcher?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("assistant.openPanel")}
        aria-expanded={open}
        aria-controls="assistant-side-panel"
        className="fixed bottom-5 end-5 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5B14D1] text-white shadow-[0_14px_35px_rgba(91,20,209,0.35)] transition hover:-translate-y-0.5 hover:bg-[#4810A8] focus:outline-none focus:ring-4 focus:ring-[#DCCBFA] sm:bottom-7 sm:end-7 sm:h-16 sm:w-16"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none">
          <path d="M7 18.5 3.5 21v-5.1A8.1 8.1 0 0 1 2 11.2C2 6.7 6.4 3 12 3s10 3.7 10 8.2-4.4 8.2-10 8.2c-1.8 0-3.5-.4-5-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m12 6.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="currentColor" />
          <path d="m17.2 12.2.45 1.35 1.35.45-1.35.45-.45 1.35-.45-1.35-1.35-.45 1.35-.45.45-1.35Z" fill="currentColor" opacity=".75" />
        </svg>
      </button>

      <div
        className="fixed inset-0 z-50"
        hidden={!open}
        aria-hidden={!open}
      >
        <div
          className="absolute inset-0 h-full w-full cursor-default bg-[#1D1527]/35"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <aside
          id="assistant-side-panel"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t("assistant.title")}
          className="absolute inset-y-0 end-0 flex w-full max-w-[31rem] flex-col overflow-hidden bg-[#F8F5FC] shadow-[-18px_0_48px_rgba(45,34,56,0.18)] outline-none"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 bg-[#5B14D1] px-5 py-4 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                  <path d="M7 18.5 3.5 21v-5.1A8.1 8.1 0 0 1 2 11.2C2 6.7 6.4 3 12 3s10 3.7 10 8.2-4.4 8.2-10 8.2c-1.8 0-3.5-.4-5-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="m12 6.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="currentColor" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold">{t("assistant.title")}</h2>
                <p className="truncate text-xs text-white/75">{t("assistant.subtitle")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("assistant.closePanel")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              ×
            </button>
          </header>
          <AssistantChat variant="panel" />
        </aside>
      </div>
    </>
  );
}
