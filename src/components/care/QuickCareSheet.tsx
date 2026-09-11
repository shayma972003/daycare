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

import { CARE_REPORT_TYPES, CARE_TYPE_LABEL_KEYS, CARE_TYPE_COLORS } from "@/lib/care-reports";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n-provider";
import type { CareReportType } from "@/generated/prisma/enums";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  closeDialogOnOpenChange,
} from "@/components/ui/Dialog";

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

  return (
    <Dialog open onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, false, onClose)}>
      <DialogContent
        overlayClassName="bg-black/40"
        className="inset-x-0 bottom-0 top-auto mx-0 w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl p-5 pb-7 animate-[slideUp_.18s_ease-out] sm:inset-x-4 sm:bottom-auto sm:top-1/2 sm:mx-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5"
      >
        {/* The grab handle is the affordance that says "drag me down" on a phone. */}
        <div aria-hidden className="sm:hidden w-10 h-1 rounded-full bg-gray-200 mx-auto" />

        <DialogHeader className="mt-4 items-baseline">
          <div>
            <DialogTitle>{childName}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("care.quickFor", { name: childName })}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="text-sm text-gray-400 hover:text-gray-600 px-2 py-1"
            >
              {t("common.close")}
            </button>
          </DialogClose>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2">
          {CARE_REPORT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-100 hover:border-[#5B14D1] hover:bg-[#F1E8FF] active:bg-[#F1E8FF] transition-all"
            >
              <Icon name={CARE_TYPE_ICON_NAMES[type]} size={26} className={CARE_TYPE_COLORS[type]} />
              <span className="text-[10px] font-medium text-[#111111] text-center leading-tight">
                {t(CARE_TYPE_LABEL_KEYS[type])}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
