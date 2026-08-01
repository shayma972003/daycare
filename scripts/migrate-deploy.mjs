import { spawnSync } from "node:child_process";

/**
 * Applies pending migrations during the build, retrying on connection failures.
 *
 * Neon suspends an idle compute and the first connection has to wake it, which
 * can exceed any single connect timeout. That surfaces as P1002 and fails the
 * whole deploy — for a migration set that is usually already applied.
 * `migrate deploy` is idempotent, so retrying is safe.
 *
 * Only connection-level errors are retried. A migration that fails because its
 * SQL is wrong fails immediately: deploying code whose schema change did not
 * apply is worse than a failed build.
 */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 5000, 15000];

/** Prisma error codes that mean "could not reach the database", not "bad SQL". */
const RETRYABLE = ["P1001", "P1002", "P1017"];

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  if (BACKOFF_MS[attempt - 1] > 0) {
    console.log(`waiting ${BACKOFF_MS[attempt - 1] / 1000}s before retry…`);
    // Deliberately blocking: the build must not continue past this point.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF_MS[attempt - 1]);
  }

  console.log(`prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Neon fronts even its non-pooled endpoint with PgBouncer, so the
      // session-level advisory lock Prisma takes is orphaned the moment the
      // connection returns to the pool. The lock then blocks every later
      // migration until someone terminates the idle session by hand — which is
      // exactly what broke this deploy.
      //
      // The lock only guards against two migrate runs racing. Vercel builds one
      // commit at a time and this script runs once per build, so the protection
      // it offers here is worth less than the outages it causes.
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "true",
    },
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);

  if (result.status === 0) {
    console.log("migrations applied");
    process.exit(0);
  }

  const isRetryable = RETRYABLE.some((code) => output.includes(code));
  if (!isRetryable) {
    console.error("migration failed for a non-connection reason — not retrying");
    process.exit(result.status ?? 1);
  }

  console.warn(`connection problem on attempt ${attempt}`);
}

console.error(`could not reach the database after ${MAX_ATTEMPTS} attempts`);
process.exit(1);
