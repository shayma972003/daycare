type SafeErrorDetails = {
  name: string;
  code?: string;
};

/**
 * Returns only a stable error class/code. Never serialises arbitrary properties:
 * Prisma errors can carry query arguments and mail/storage errors can carry
 * credentials or recipient data.
 */
export function safeErrorDetails(error: unknown): SafeErrorDetails {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name || "Error",
    ...(typeof code === "string" && /^[A-Z0-9_-]{1,32}$/i.test(code) ? { code } : {}),
  };
}

export function logSafeError(scope: string, error: unknown): void {
  console.error(`[${scope}] failed`, safeErrorDetails(error));
}
