import { cn } from "@/lib/utils";

interface IconPlaceholderProps {
  label: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-12 h-12 text-sm",
};

export function IconPlaceholder({
  label,
  className,
  size = "md",
}: IconPlaceholderProps) {
  return (
    <div
      className={cn(
        "bg-gray-200 rounded flex items-center justify-center text-gray-500 font-medium shrink-0",
        sizes[size],
        className
      )}
    >
      {label}
    </div>
  );
}

export function AvatarPlaceholder({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div
      className={cn(
        "w-9 h-9 rounded-full bg-[#111111] text-white flex items-center justify-center text-xs font-bold shrink-0",
        className
      )}
    >
      {initials}
    </div>
  );
}

export function ImagePlaceholder({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full h-32 bg-gray-100 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 border-2 border-dashed border-gray-200",
        className
      )}
    >
      <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-xs">
        [img]
      </div>
      <span className="text-xs">{label}</span>
    </div>
  );
}
