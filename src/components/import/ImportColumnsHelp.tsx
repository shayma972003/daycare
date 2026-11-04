"use client";

import { useState } from "react";
import { STUDENT_FIELD_ALIASES, TEACHER_FIELD_ALIASES } from "@/lib/import-mapper";
import { useT } from "@/lib/i18n-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

type ImportType = "students" | "teachers";

function fieldLabel(field: string, type: ImportType, t: (key: string) => string) {
  const key = type === "teachers" && field === "full_name"
    ? "teacher_full_name"
    : type === "teachers" && field === "enrollment_end_date"
      ? "employee_enrollment_end_date"
      : field;
  const label = t(`importFields.${key}`);
  return label.startsWith("importFields.") ? field : label;
}
export function ImportColumnsHelp({ type }: { type: ImportType }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const aliases = type === "students" ? STUDENT_FIELD_ALIASES : TEACHER_FIELD_ALIASES;
  const fields = Object.keys(aliases);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("importer.columnHelpOpen")}
        title={t("importer.columnHelpOpen")}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#5B14D1]/30 bg-[#5B14D1]/5 text-sm font-bold text-[#5B14D1] transition-colors hover:bg-[#5B14D1]/10"
      >
        ؟
      </button>

      <DialogContent className="max-w-3xl p-5 sm:p-6">
        <DialogHeader className="items-center">
          <DialogTitle>
            {t(type === "students" ? "importer.columnHelpStudentsTitle" : "importer.columnHelpTeachersTitle")}
          </DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("common.close")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xl font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ×
            </button>
          </DialogClose>
        </DialogHeader>
        <DialogDescription className="text-sm leading-6 text-gray-600">
          {t("importer.columnHelpIntro")}
        </DialogDescription>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-start font-semibold text-gray-700">{t("importer.preferredColumnName")}</th>
                <th className="px-4 py-3 text-start font-semibold text-gray-700">{t("importer.columnImportance")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{fieldLabel(field, type, t)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${field === "full_name" ? "bg-red-50 text-red-700" : "bg-violet-50 text-[#5B14D1]"}`}>
                      {t(field === "full_name" ? "importer.requiredForImport" : "importer.recommendedForCompleteData")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {type === "teachers" && (
          <div className="rounded-xl bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900">
            {t("importer.employeeJobTitleValues")}
          </div>
        )}

        <div className="space-y-2 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <p>{t("importer.columnHelpOptionalNotice")}</p>
          <p>{t("importer.columnHelpClassNotice")}</p>
          <p className="font-semibold">{t("importer.columnHelpReviewNotice")}</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="rounded-xl bg-[#5B14D1] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#490EA9]">
              {t("common.close")}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

