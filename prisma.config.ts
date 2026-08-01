import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Migrations run against a *direct* connection, not the pooled one.
 *
 * Prisma Migrate takes a session-level advisory lock so two deploys cannot
 * apply migrations concurrently. Neon's pooler runs PgBouncer in transaction
 * mode, which does not carry session state, so the lock silently fails to hold.
 * The application itself keeps using the pooled URL — that is what serverless
 * needs.
 */
const isMigrating = process.argv.some((arg) => arg === "migrate" || arg === "db");

/**
 * Neon suspends an idle compute, and the first connection has to wake it. That
 * takes longer than Prisma's 5-second default, which surfaced as P1002 ("server
 * was reached but timed out") and failed the deploy. The direct endpoint feels
 * this most, since it has no pooler holding a warm connection.
 */
function withConnectTimeout(url: string | undefined): string {
  if (!url) return "";
  if (url.includes("connect_timeout=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connect_timeout=30&pool_timeout=30`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: isMigrating
      ? withConnectTimeout(process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"])
      : (process.env["DATABASE_URL"] ?? ""),
  },
});
