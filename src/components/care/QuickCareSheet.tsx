"use client";

/**
 * One child, one report, without leaving the roster.
 *
 * The screen's bulk flow — select children, pick a type, fill once — is the right
 * shape for the common case: a class finishes lunch and one report covers all of
 * them. It is the wrong shape for the other case, which is just as common. A
 * teacher notices one child has a temperature, and the bulk flow makes her clear
 * the current selection, select that child, pick a type, and then rebuild the
 * selection she was working on.
 *
 * So this sits beside it rather than replacing it. Tapping a child's name still
 * toggles them into the bulk selection; tapping the ⚡ beside it opens this.
 *
 * A bottom sheet rather than a centred dialog because the reader is holding a
 * phone in one hand with a child in the other, and the bottom of the screen is
 * the part of it a thumb reaches.
 */

import { useEffect } from "react";
import { CARE_REPORT_TYPES, CARE_TYPE_LABEL_KEYS, CARE_TYPE_COLORS } from "@/lib/care-reports";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n-provider";
import type { CareReportType } from "@/generated/prisma/enums";

export function QuickCareSheet({
  childName,
  onPick,
  onClose,
}: {
  childName: string;
  onPick: (type: CareReportType) => void;
  onClose: () => void;
}) {
  const t = useT();

  // Escape closes it, and the body does not scroll behind it.
  useEffect(() => {
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
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("care.quickFor", { name: childName })}
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 pb-7 sm:pb-5 space-y-4 shadow-modal animate-[slideUp_.18s_ease-out]"
      >
        {/* The grab handle is the affordance that says "drag me down" on a phone. */}
        <div aria-hidden className="sm:hidden w-10 h-1 rounded-full bg-gray-200 mx-auto" />

        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-bold text-[#111111]">{childName}</h3>
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-gray-600 px-2 py-1"
          >
            {t("common.close")}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {CARE_REPORT_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onPick(type)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-100 hover:border-[#2F96A6] hover:bg-[#E0F7FA] active:bg-[#E0F7FA] transition-all"
            >
              <Icon name={CARE_TYPE_ICON_NAMES[type]} size={26} className={CARE_TYPE_COLORS[type]} />
              <span className="text-[10px] font-medium text-[#111111] text-center leading-tight">
                {t(CARE_TYPE_LABEL_KEYS[type])}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
