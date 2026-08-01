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

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      (isMigrating
        ? process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"]
        : process.env["DATABASE_URL"]) ?? "",
  },
});
