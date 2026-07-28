import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  accent?: "coral" | "yellow" | "teal" | "none";
  hoverable?: boolean;
}

const accentColors = {
  coral: "border-r-4 border-r-coral",
  yellow: "border-r-4 border-r-yellow",
  teal: "border-r-4 border-r-teal",
  none: "",
};

export function Card({ children, className, accent = "none", hoverable = false }: CardProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-xl p-card shadow-card",
        hoverable && "cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5",
        accentColors[accent],
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
  return <h3 className={cn("font-bold text-navy text-lg", className)}>{children}</h3>;
}
