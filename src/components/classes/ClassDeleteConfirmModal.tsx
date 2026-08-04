"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n-provider";

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
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, deleting, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 100 }}
      className="bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="class-delete-confirm-title"
        dir="rtl"
        style={{ position: "relative", zIndex: 101 }}
        className="bg-white rounded-2xl shadow-modal p-6 w-full max-w-md text-right space-y-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {assignedStudentsCount > 0 ? (
          <>
            <h2 id="class-delete-confirm-title" className="text-sm font-medium text-[#111111]">
              {t("classes.containsStudents", { n: String(assignedStudentsCount) })}
            </h2>
            <p className="text-sm text-gray-600 whitespace-pre-line">
              {t("classes.deleteWarning")}
            </p>
          </>
        ) : (
          <h2 id="class-delete-confirm-title" className="text-sm font-medium text-[#111111]">
            {t("classes.trashNotice", { name: className })}
          </h2>
        )}

        {error && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-center pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            disabled={deleting}
            className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting ? "..." : t("common.delete")}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!deleting) onCancel();
            }}
            disabled={deleting}
            className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
