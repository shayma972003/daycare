/** Preserve pg's current certificate/hostname verification explicitly instead
 * of relying on aliases whose meaning changes in pg 9. No credentials logged. */
export function postgresRuntimeUrl(connectionString: string): string {
  if (!connectionString) return connectionString;
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return connectionString;
  const mode = url.searchParams.get("sslmode");
  // An explicit libpq compatibility choice is a separate operator policy.
  if (url.searchParams.get("uselibpqcompat") === "true") return connectionString;
  if (mode && ["prefer", "require", "verify-ca"].includes(mode)) {
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  }
  return connectionString;
}
