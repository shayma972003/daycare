interface VariableReferenceProps {
  mode?: "full" | "payment" | "activity";
}

interface VarDef {
  key: string;
  label: string;
  color?: "indigo" | "purple" | "emerald";
}

const ALL_VARS: VarDef[] = [
  { key: "child_name",       label: "اسم الطفل" },
  { key: "guardian_name",    label: "اسم ولي الأمر الأول" },
  { key: "guardian_2_name",  label: "اسم ولي الأمر الثاني", color: "purple" },
  { key: "school_name",      label: "اسم المنشأة" },
  { key: "checkin_time",     label: "وقت دخول الطالب" },
  { key: "checkout_time",    label: "وقت خروج الطالب" },
  { key: "subscription_fee", label: "رسوم التسجيل", color: "emerald" },
  { key: "due_date",         label: "تاريخ انتهاء الاشتراك" },
  { key: "activity_name",    label: "اسم الفعالية" },
  { key: "activity_fee",     label: "رسوم الفعالية", color: "emerald" },
  { key: "activity_date",    label: "تاريخ الفعالية" },
];

const PAYMENT_VARS: VarDef[] = [
  { key: "child_name",       label: "اسم الطفل" },
  { key: "guardian_name",    label: "اسم ولي الأمر الأول" },
  { key: "guardian_2_name",  label: "اسم ولي الأمر الثاني", color: "purple" },
  { key: "school_name",      label: "اسم المنشأة" },
  { key: "subscription_fee", label: "رسوم التسجيل", color: "emerald" },
  { key: "due_date",         label: "تاريخ انتهاء الاشتراك" },
];

const ACTIVITY_VARS: VarDef[] = [
  { key: "child_name",       label: "اسم الطفل" },
  { key: "guardian_name",    label: "اسم ولي الأمر الأول" },
  { key: "guardian_2_name",  label: "اسم ولي الأمر الثاني", color: "purple" },
  { key: "school_name",      label: "اسم المنشأة" },
  { key: "activity_name",    label: "اسم الفعالية" },
  { key: "activity_fee",     label: "رسوم الفعالية", color: "emerald" },
  { key: "activity_date",    label: "تاريخ الفعالية" },
];

const COLOR_MAP: Record<string, string> = {
  indigo:  "px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-indigo-600 font-mono",
  purple:  "px-2 py-0.5 bg-white border border-purple-200 rounded text-xs text-purple-600 font-mono",
  emerald: "px-2 py-0.5 bg-white border border-emerald-200 rounded text-xs text-emerald-600 font-mono",
};
const DEFAULT_CLASS = COLOR_MAP.indigo;

export function VariableReference({ mode = "full" }: VariableReferenceProps) {
  const vars =
    mode === "payment"  ? PAYMENT_VARS  :
    mode === "activity" ? ACTIVITY_VARS :
    ALL_VARS;

  return (
    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
      <p className="text-xs font-semibold text-slate-600 mb-2">المتغيرات المتاحة</p>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((v) => (
          <code
            key={v.key}
            title={v.label}
            className={COLOR_MAP[v.color ?? "indigo"] ?? DEFAULT_CLASS}
          >
            {"<"}{v.key}{">"}
          </code>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {vars.map((v) => (
          <span key={v.key + "_label"} className="text-xs text-slate-500">
            {`<${v.key}>`} = {v.label}
          </span>
        )).filter((_, i) => i < 4)}
        {vars.length > 4 && <span className="text-xs text-slate-400">…</span>}
      </div>
    </div>
  );
}
