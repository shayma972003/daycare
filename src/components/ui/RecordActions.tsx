"use client";

/**
 * One action menu for every record type (task 2.27).
 *
 * Edit · archive · delete, in that order, everywhere. The order is the point:
 * the safe action is first and the irreversible one is last and red, so muscle
 * memory built on the students list does not delete a class.
 *
 * Archive and delete are deliberately separate items rather than one "remove".
 * They are different promises — archive keeps the record and its history, delete
 * puts it in the 30-day trash — and a single control that means both is how a
 * nursery loses a year of attendance while trying to tidy up a room.
 */

import { useEffect, useRef, useState } from "react";

export interface RecordAction {
  key: string;
  label: string;
  onSelect: () => void;
  /** Renders red and sits at the bottom, after a divider. */
  destructive?: boolean;
  hidden?: boolean;
}

export function RecordActions({
  actions,
  label = "إجراءات",
}: {
  actions: RecordAction[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Closes on an outside click and on Escape. A menu that only closes when you
  // pick something traps a phone user who opened it by accident.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return null;

  const safe = visible.filter((action) => !action.destructive);
  const destructive = visible.filter((action) => action.destructive);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors text-lg leading-none"
      >
        ⋮
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-1 min-w-[160px] bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20"
          dir="rtl"
        >
          {safe.map((action) => (
            <button
              key={action.key}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className="w-full text-right px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {action.label}
            </button>
          ))}

          {destructive.length > 0 && safe.length > 0 && (
            <div className="my-1 border-t border-gray-100" />
          )}

          {destructive.map((action) => (
            <button
              key={action.key}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className="w-full text-right px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
