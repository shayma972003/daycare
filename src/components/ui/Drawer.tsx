"use client";

/**
 * A side panel for work that does not deserve a page.
 *
 * Adding a class is four fields. Sending it to `/classes/new` unmounts the list
 * the user was reading, and coming back re-fetches and re-scrolls it, so the
 * cost of the round trip is paid twice for a form that fits in a panel.
 *
 * **The open state belongs in the URL, not in component state.** A drawer held in
 * `useState` is invisible to the browser: pressing back closes the whole screen
 * instead of the panel, the panel cannot be linked to, and on Android — where
 * back is a system gesture rather than a button people choose to press — a
 * teacher who means to close a form leaves the section. `useDrawer` therefore
 * writes `?drawer=<name>` and reads it back, so open and closed are two history
 * entries and back does what it says.
 *
 * `router.push` opens and `router.back()` closes, so closing pops the entry it
 * pushed rather than stacking a second one.
 */

import { useCallback, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n-provider";

const PARAM = "drawer";

export function useDrawer(name: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isOpen = params.get(PARAM) === name;

  const open = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.set(PARAM, name);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }, [router, pathname, params, name]);

  const close = useCallback(() => {
    // Pops the entry `open` pushed. Pushing a closed URL instead would leave a
    // history stack where back re-opens the drawer.
    router.back();
  }, [router]);

  return { isOpen, open, close };
}

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      {/* Anchored to the inline-start edge, so it slides in from the side the
          reader's language starts at — right in Arabic, left in English. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative ms-auto h-full w-full sm:max-w-md bg-white shadow-modal flex flex-col"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-[#111111]">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
