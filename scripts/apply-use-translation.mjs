/**
 * One-off codemod: switch `t()` from the static Arabic import to the locale hook.
 *
 * `t` was imported from `@/lib/utils`, which reads `locales/ar.json` directly, so
 * `locales/en.json` was unreachable. Every call site keeps the identical
 * `t("some.key")` shape — only where `t` comes from changes.
 *
 * Only files that already carry "use client" are touched: `useT` is a hook.
 * Anything else is reported and left alone.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

let changed = 0;
const skipped = [];

for (const file of walk(ROOT)) {
  const original = readFileSync(file, "utf8");

  // Does it call t("…") and import it from utils?
  if (!/\bt\("/.test(original)) continue;
  if (!/from "@\/lib\/utils"/.test(original)) continue;
  if (!/^"use client"/m.test(original)) {
    skipped.push(`${file} (not a client component)`);
    continue;
  }
  if (original.includes("useT()")) continue;

  // Drop `t` from the utils import, keeping any siblings (cn, formatDate, …).
  let updated = original.replace(
    /import \{([^}]*)\} from "@\/lib\/utils";/,
    (match, names) => {
      const kept = names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name && name !== "t");
      return kept.length
        ? `import { ${kept.join(", ")} } from "@/lib/utils";`
        : "";
    }
  );

  // Add the hook import after the last existing import.
  const importMatches = [...updated.matchAll(/^import .*;$/gm)];
  if (importMatches.length === 0) {
    skipped.push(`${file} (no imports found)`);
    continue;
  }
  const last = importMatches[importMatches.length - 1];
  const insertAt = last.index + last[0].length;
  updated =
    updated.slice(0, insertAt) +
    `\nimport { useT } from "@/lib/i18n";` +
    updated.slice(insertAt);

  // Declare `const t = useT()` as the first statement of the component.
  const componentMatch = updated.match(
    /export (?:default )?function (\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\n/
  );
  if (!componentMatch) {
    skipped.push(`${file} (component signature not recognised)`);
    continue;
  }
  const declareAt = componentMatch.index + componentMatch[0].length;
  updated =
    updated.slice(0, declareAt) +
    `  // Locale-aware translation — see src/lib/i18n.tsx.\n  const t = useT();\n` +
    updated.slice(declareAt);

  writeFileSync(file, updated, "utf8");
  changed++;
}

console.log(`converted ${changed} file(s) to useT()`);
if (skipped.length) {
  console.log(`\n${skipped.length} left for manual handling:`);
  for (const entry of skipped) console.log(`  ${entry}`);
}
