import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import ar from "../../locales/ar.json";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function t(key: string): string {
  const keys = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = ar;
  for (const k of keys) {
    if (current == null) return key;
    current = current[k];
  }
  return typeof current === "string" ? current : key;
}

export function replaceVariables(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/<(\w+)>/g, (match, key) => {
    return vars[key] ?? match;
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString("ar-SA")} ر.س`;
}
