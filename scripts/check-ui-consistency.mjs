#!/usr/bin/env node
// UI consistency linter: forbids rounded-3xl, non-locked font weights, and
// font sizes outside {10,12,14,16,18,20}px on the unified routes + dashboard.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED_PX = new Set([10, 12, 14, 16, 18, 20]);

const TARGETS = [
  "src/routes/home.tsx",
  "src/routes/nutrition.tsx",
  "src/routes/coach.tsx",
  "src/routes/workouts.tsx",
  "src/routes/_authenticated/dashboard.tsx",
];
const DIRS = ["src/components/dashboard"];

const RULES = [
  { name: "rounded-3xl", re: /\brounded-3xl\b/g },
  { name: "forbidden font-weight", re: /\bfont-(bold|semibold|extrabold|black)\b/g },
  { name: "forbidden text size token", re: /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)\b/g },
];
const ARBITRARY_PX = /\btext-\[(\d+)px\]/g;

function collect() {
  const files = new Set(TARGETS.map((t) => join(ROOT, t)));
  for (const d of DIRS) {
    const abs = join(ROOT, d);
    try {
      for (const entry of walk(abs)) files.add(entry);
    } catch {}
  }
  return [...files].filter((f) => /\.(tsx?|jsx?)$/.test(f));
}
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let violations = 0;
for (const file of collect()) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(line))) {
        report(file, i + 1, m[0], r.name, line);
      }
    }
    ARBITRARY_PX.lastIndex = 0;
    let m;
    while ((m = ARBITRARY_PX.exec(line))) {
      const n = parseInt(m[1], 10);
      if (!ALLOWED_PX.has(n)) {
        report(file, i + 1, m[0], `text-[${n}px] not in {10,12,14,16,18,20}`, line);
      }
    }
  });
}

function report(file, lineNo, token, rule, line) {
  violations++;
  const rel = relative(ROOT, file);
  console.log(`${rel}:${lineNo}  [${rule}]  ${token}  ← ${line.trim().slice(0, 120)}`);
}

if (violations > 0) {
  console.log(`\n✗ ${violations} UI consistency violation(s).`);
  process.exit(1);
} else {
  console.log("✓ UI consistency check passed.");
}
