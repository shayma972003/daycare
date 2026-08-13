export function createIdempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}
