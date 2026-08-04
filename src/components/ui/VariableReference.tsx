"use client";

import { useT } from "@/lib/i18n-provider";

interface VariableReferenceProps {
  mode?: "full" | "payment" | "activity";
}

interface VarDef {
  key: string;
  /** A key — resolved per render, not at module load. */
  labelKey: string;
  color?: "indigo" | "purple" | "emerald";
}

const ALL_VARS: VarDef[] = [
  { key: "child_name",       labelKey: "variables.childNameDesc" },
  { key: "guardian_name",    labelKey: "variables.guardianNameDesc" },
  { key: "guardian_2_name",  labelKey: "variables.guardian_2_name", color: "purple" },
  { key: "school_name",      labelKey: "variables.schoolNameDesc" },
  { key: "checkin_time",     labelKey: "variables.checkInTime" },
  { key: "checkout_time",    labelKey: "variables.checkOutTime" },
  { key: "subscription_fee", labelKey: "studentProfile.registrationFee", color: "emerald" },
  { key: "due_date",         labelKey: "students.profile.enrollmentEndDate" },
  { key: "activity_name",    labelKey: "home.activityForm.name" },
  { key: "activity_fee",     labelKey: "home.activityForm.fee", color: "emerald" },
  { key: "activity_date",    labelKey: "variables.activityDate" },
];

const PAYMENT_VARS: VarDef[] = [
  { key: "child_name",       labelKey: "variables.childNameDesc" },
  { key: "guardian_name",    labelKey: "variables.guardianNameDesc" },
  { key: "guardian_2_name",  labelKey: "variables.guardian_2_name", color: "purple" },
  { key: "school_name",      labelKey: "variables.schoolNameDesc" },
  { key: "subscription_fee", labelKey: "studentProfile.registrationFee", color: "emerald" },
  { key: "due_date",         labelKey: "students.profile.enrollmentEndDate" },
];

const ACTIVITY_VARS: VarDef[] = [
  { key: "child_name",       labelKey: "variables.childNameDesc" },
  { key: "guardian_name",    labelKey: "variables.guardianNameDesc" },
  { key: "guardian_2_name",  labelKey: "variables.guardian_2_name", color: "purple" },
  { key: "school_name",      labelKey: "variables.schoolNameDesc" },
  { key: "activity_name",    labelKey: "home.activityForm.name" },
  { key: "activity_fee",     labelKey: "home.activityForm.fee", color: "emerald" },
  { key: "activity_date",    labelKey: "variables.activityDate" },
];

const COLOR_MAP: Record<string, string> = {
  indigo:  "px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-indigo-600 font-mono",
  purple:  "px-2 py-0.5 bg-white border border-purple-200 rounded text-xs text-purple-600 font-mono",
  emerald: "px-2 py-0.5 bg-white border border-emerald-200 rounded text-xs text-emerald-600 font-mono",
};
const DEFAULT_CLASS = COLOR_MAP.indigo;

export function VariableReference({ mode = "full" }: VariableReferenceProps) {
  const t = useT();
  const vars =
    mode === "payment"  ? PAYMENT_VARS  :
    mode === "activity" ? ACTIVITY_VARS :
    ALL_VARS;

  return (
    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
      <p className="text-xs font-semibold text-slate-600 mb-2">{t("variables.title")}</p>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((v) => (
          <code
            key={v.key}
            title={t(v.labelKey)}
            className={COLOR_MAP[v.color ?? "indigo"] ?? DEFAULT_CLASS}
          >
            {"<"}{v.key}{">"}
          </code>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {vars.map((v) => (
          <span key={v.key + "_label"} className="text-xs text-slate-500">
            {`<${v.key}>`} = {t(v.labelKey)}
          </span>
        )).filter((_, i) => i < 4)}
        {vars.length > 4 && <span className="text-xs text-slate-400">…</span>}
      </div>
    </div>
  );
}
