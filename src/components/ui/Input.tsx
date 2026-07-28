import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-navy text-right">{label}</label>}
      <input
        className={cn(
          "w-full px-4 py-2.5 rounded-md border border-brand-border bg-white",
          "text-right text-sm text-navy placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal",
          "transition-all duration-150",
          error && "border-coral focus:ring-coral/30",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-coral text-right">{error}</p>}
    </div>
  );
}
