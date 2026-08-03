import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests (tasks 0.54, 1.14ب, D3.12).
 *
 * Scope is deliberately narrow: **pure functions only**. No database, no Next.js
 * request context, no rendering. Those need a test database and a fixture story
 * of their own, and the value here is not in having many tests — it is in
 * pinning the handful of calculations that are easy to get wrong and impossible
 * to eyeball.
 *
 * The functions covered are the ones where a silent error costs real money or
 * real privacy: when a child's data expires, when a fee falls due, what a report
 * actually stores.
 *
 * `.mts` because the config uses ESM syntax and the package is CommonJS; Vite's
 * native loader warns otherwise.
 */
export default defineConfig({
  resolve: {
    // Native tsconfig path resolution — `@/lib/...` resolves exactly as it does
    // in the app. A test importing through a different alias is testing a
    // different module. This replaces `vite-tsconfig-paths`, which Vite now
    // reports as redundant.
    tsconfigPaths: true,
    /**
     * `server-only` is a marker, and in a test it must mark nothing.
     *
     * The modules holding R2 credentials import it so that a mistaken client
     * import fails the build. Its default entry throws on purpose — that *is*
     * the guard — and only a `react-server` bundle picks the harmless entry.
     * Vitest resolves it through Node, gets the throwing one, and every test
     * touching a server module dies with a message about Client Components.
     *
     * Aliased rather than switching resolve conditions globally: the guard that
     * matters runs at `next build`, and nothing here weakens it. The alias is an
     * absolute path because the package's `exports` map does not publish the
     * subpath by name — only the `react-server` condition reaches it.
     */
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The suite is fast on purpose; a slow suite is one nobody runs before
    // pushing.
    testTimeout: 5000,
  },
});
