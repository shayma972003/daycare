import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "destructive" | "neutral" | "success" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-coral text-white hover:bg-coral-dark active:scale-[0.98]",
  secondary: "bg-white text-coral border-2 border-coral hover:bg-coral-light active:scale-[0.98]",
  destructive: "bg-white text-danger-text border-2 border-danger-text hover:bg-danger-bg active:scale-[0.98]",
  neutral: "bg-gray-100 text-navy hover:bg-teal-light hover:text-teal active:scale-[0.98]",
  success: "bg-success-text text-white hover:opacity-90 active:scale-[0.98]",
  ghost: "bg-transparent text-navy hover:bg-gray-100 active:scale-[0.98]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "rounded-md font-medium transition-all duration-150 inline-flex items-center gap-2",
        variants[variant],
        sizes[size],
        (disabled || loading) && "opacity-50 cursor-not-allowed",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}
