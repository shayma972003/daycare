/**
 * One-off codemod: let route handlers return 403 instead of flattening it to 401.
 *
 * `requireSession()` now enforces the route permission table and throws
 * `ForbiddenError`. Every tenant route already wrapped it in
 *
 *     } catch {
 *       return Response.json({ error: "Unauthorized" }, { status: 401 });
 *     }
 *
 * which swallowed the distinction — a teacher tapping something she is not
 * allowed to do would get a 401, and the client treats 401 as "your session
 * ended" and bounces her to the login page.
 *
 * Rewrites that exact block to delegate to `sessionErrorResponse`, keeping the
 * original 401 as the fallback for any other error. Only the literal pattern is
 * touched; anything that does not match is reported and left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/api";

const CATCH_PATTERN =
  /\} catch \{\r?\n(\s*)return Response\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);\r?\n(\s*)\}/g;

/**
 * The import routes were written in a different house style — single quotes and
 * the `try`/`catch` on one line — so the pattern above misses them. Handled
 * separately rather than by loosening the main regex, which would start matching
 * catch blocks that have nothing to do with sessions.
 */
const COMPACT_PATTERN =
  /try \{ session = await requireSession\(\); \} catch \{\r?\n(\s*)return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);\r?\n(\s*)\}/g;

const COMPACT_REPLACEMENT = (indent, closeIndent) =>
  `try { session = await requireSession(); } catch (error) {\n${indent}// 403 when the caller is known but lacks the permission; 401 otherwise.\n${indent}return (\n${indent}  sessionErrorResponse(error) ??\n${indent}  Response.json({ error: 'Unauthorized' }, { status: 401 })\n${indent});\n${closeIndent}}`;

const REPLACEMENT = (indent, closeIndent) =>
  `} catch (error) {\n${indent}// 403 when the caller is known but lacks the permission; 401 otherwise.\n${indent}return (\n${indent}  sessionErrorResponse(error) ??\n${indent}  Response.json({ error: "Unauthorized" }, { status: 401 })\n${indent});\n${closeIndent}}`;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

let changedFiles = 0;
let changedSites = 0;
const skipped = [];

for (const file of walk(ROOT)) {
  const original = readFileSync(file, "utf8");

  // Admin-panel routes use their own auth and never call requireSession.
  if (!original.includes("requireSession")) continue;

  CATCH_PATTERN.lastIndex = 0;
  COMPACT_PATTERN.lastIndex = 0;
  const matches = [
    ...(original.match(CATCH_PATTERN) ?? []),
    ...(original.match(COMPACT_PATTERN) ?? []),
  ];
  if (!matches.length) {
    skipped.push(file);
    continue;
  }

  let updated = original
    .replace(CATCH_PATTERN, (_m, indent, closeIndent) => REPLACEMENT(indent, closeIndent))
    .replace(COMPACT_PATTERN, (_m, indent, closeIndent) =>
      COMPACT_REPLACEMENT(indent, closeIndent)
    );

  if (!updated.includes("sessionErrorResponse")) continue;

  // Extend the existing session import rather than adding a second one. Both
  // quote styles appear in the codebase.
  if (!/import \{[^}]*sessionErrorResponse[^}]*\} from ['"]@\/lib\/session['"]/.test(updated)) {
    updated = updated.replace(
      /import \{([^}]*)\} from (['"])@\/lib\/session\2;/,
      (_m, names, quote) =>
        `import {${names.replace(/\s+$/, "")}, sessionErrorResponse } from ${quote}@/lib/session${quote};`
    );
  }

  writeFileSync(file, updated, "utf8");
  changedFiles++;
  changedSites += matches.length;
}

console.log(`rewrote ${changedSites} catch blocks across ${changedFiles} files`);
if (skipped.length) {
  console.log(`\n${skipped.length} file(s) call requireSession but did not match the pattern — check by hand:`);
  for (const file of skipped) console.log(`  ${file}`);
}
