import { t } from "@/lib/utils";

interface VariableReferenceProps {
  mode?: "full" | "payment";
}

const GUARDIAN2_VARS = [
  { key: "guardian_2_name", label: "اسم ولي الأمر الثاني" },
  { key: "guardian_2_phone", label: "رقم جوال ولي الأمر الثاني" },
  { key: "guardian_2_email", label: "بريد ولي الأمر الثاني" },
];

const fullVars = [
  "child_name",
  "guardian_name",
  "checkin_time",
  "checkout_time",
  "amount_due",
  "due_date",
  "school_name",
  "activity_name",
] as const;

const paymentVars = [
  "child_name",
  "guardian_name",
  "amount_due",
  "due_date",
  "school_name",
] as const;

export function VariableReference({ mode = "full" }: VariableReferenceProps) {
  const vars = mode === "payment" ? paymentVars : fullVars;

  return (
    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
      <p className="text-xs font-semibold text-slate-600 mb-2">
        {t("variables.title")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((v) => (
          <code
            key={v}
            className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-indigo-600 font-mono"
          >
            {t(`variables.${v}`)}
          </code>
        ))}
        {GUARDIAN2_VARS.map((v) => (
          <code
            key={v.key}
            title={v.label}
            className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-purple-600 font-mono"
          >
            {"<"}{v.key}{">"}
          </code>
        ))}
      </div>
    </div>
  );
}
