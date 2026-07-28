import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  accent?: "coral" | "yellow" | "teal" | "none";
  hoverable?: boolean;
}

const accentLine = {
  coral: "before:absolute before:top-0 before:right-0 before:left-0 before:h-[3px] before:bg-coral before:rounded-t-xl",
  yellow: "before:absolute before:top-0 before:right-0 before:left-0 before:h-[3px] before:bg-yellow before:rounded-t-xl",
  teal: "before:absolute before:top-0 before:right-0 before:left-0 before:h-[3px] before:bg-teal before:rounded-t-xl",
  none: "",
};

export function Card({ children, className, accent = "none", hoverable = false }: CardProps) {
  return (
    <div
      className={cn(
        "relative bg-white rounded-xl p-card shadow-card",
        hoverable && "cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all",
        accent !== "none" && "overflow-hidden",
        accentLine[accent],
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 pb-3 border-b border-brand-border", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("font-bold text-gray-900 text-lg", className)}>{children}</h3>;
}
