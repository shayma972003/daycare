"use client";

import { useRef } from "react";
import { useT } from "@/lib/i18n-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  closeDialogOnOpenChange,
} from "@/components/ui/Dialog";

interface Props {
  isOpen: boolean;
  className: string;
  assignedStudentsCount: number;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClassDeleteConfirmModal({
  isOpen,
  className,
  assignedStudentsCount,
  deleting,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, deleting, onCancel)}
    >
      <DialogContent
        role="alertdialog"
        dismissBlocked={deleting}
        className="max-w-md space-y-4 p-5 text-start sm:p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="text-base">
          {assignedStudentsCount > 0
            ? t("classes.containsStudents", { n: String(assignedStudentsCount) })
            : t("common.delete")}
        </DialogTitle>
        <DialogDescription className="whitespace-pre-line text-gray-600">
          {assignedStudentsCount > 0
            ? t("classes.deleteWarning")
            : t("classes.trashNotice", { name: className })}
        </DialogDescription>

        {error && (
          <div role="alert" className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <DialogFooter className="justify-center pt-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting ? "..." : t("common.delete")}
          </button>
          <DialogClose asChild>
            <button
              ref={cancelButtonRef}
              type="button"
              disabled={deleting}
              className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {t("common.cancel")}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
