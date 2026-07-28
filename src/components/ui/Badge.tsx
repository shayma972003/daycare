import { cn } from "@/lib/utils";

type BadgeVariant = "مدفوع" | "متأخر" | "ملغي" | "موقوف" | "بانتظار الدفع" | "نشط" | "default";

const badgeStyles: Record<BadgeVariant, { dot: string; text: string }> = {
  "مدفوع": { dot: "bg-[#2D7A4F]", text: "text-[#2D7A4F]" },
  "متأخر": { dot: "bg-[#C45000]", text: "text-[#C45000]" },
  "ملغي": { dot: "bg-[#C0232C]", text: "text-[#C0232C]" },
  "موقوف": { dot: "bg-gray-400", text: "text-gray-500" },
  "بانتظار الدفع": { dot: "bg-[#7C3AED]", text: "text-[#7C3AED]" },
  "نشط": { dot: "bg-teal", text: "text-teal" },
  default: { dot: "bg-gray-300", text: "text-gray-500" },
};

interface BadgeProps {
  status: BadgeVariant | string;
  className?: string;
}

export function Badge({ status, className }: BadgeProps) {
  const style = badgeStyles[status as BadgeVariant] ?? badgeStyles.default;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", style.text, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", style.dot)} />
      {status}
    </span>
  );
}
