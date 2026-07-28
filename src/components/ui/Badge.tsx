import { cn } from "@/lib/utils";

type BadgeVariant = "مدفوع" | "متأخر" | "ملغي" | "موقوف" | "بانتظار الدفع" | "نشط" | "default";

const badgeStyles: Record<BadgeVariant, string> = {
  "مدفوع": "bg-success-bg text-success-text",
  "متأخر": "bg-warning-bg text-warning-text",
  "ملغي": "bg-danger-bg text-danger-text",
  "موقوف": "bg-neutral-bg text-neutral-text",
  "بانتظار الدفع": "bg-pending-bg text-pending-text",
  "نشط": "bg-teal-light text-teal-dark",
  default: "bg-gray-100 text-gray-600",
};

interface BadgeProps {
  status: BadgeVariant | string;
  className?: string;
}

export function Badge({ status, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium",
        badgeStyles[status as BadgeVariant] ?? badgeStyles.default,
        className
      )}
    >
      {status}
    </span>
  );
}
