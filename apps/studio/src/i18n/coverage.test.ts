// Bidirectional key-coverage validation for the Studio i18n dictionaries:
//   1) zh/en key parity (complements i18n.test.ts, kept here so the coverage
//      suite is self-contained for CI triage)
//   2) USED-KEY COVERAGE — every t("literal.key") call in apps/studio/src
//      (outside i18n/, outside *.test.*) must resolve to a key in the zh
//      dictionary. A missing key fails the test listing file:line of each
//      usage, so a new string lands in CI red with an actionable diff.
//   3) UNUSED-KEY REPORT — dictionary keys no scanned source references.
//      Informational only (console.log): dynamic keys are legitimate —
//      errors.* is resolved at runtime as t(`errors.${code}`), and keys
//      consumed through helper constants (e.g. format.ts RELATIVE_JUST_NOW_KEY)
//      or planned-but-not-yet-wired components never appear as literals.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { flattenKeys } from "./core";
import { en } from "./en";
import { zh } from "./zh";

const SRC_ROOT = join(import.meta.dir, ".."); // apps/studio/src

/** t("...") / t('...') / t(`...`) with a fully literal key. Template literals
 *  with interpolation (t(`errors.${code}`)) deliberately do not match — they
 *  cannot be resolved statically. */
const USED_KEY_RE = /\bt\(\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;

/** Key prefixes that are resolved dynamically at runtime — excluded from the
 *  "unused" triage hints because the scanner can never see their call sites. */
const KNOWN_DYNAMIC_PREFIXES = ["errors."];

interface Usage {
  key: string;
  /** e.g. "components/TopBar.tsx:23" (relative to apps/studio/src) */
  loc: string;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // skip the i18n module itself (dictionaries/provider define keys, they
    // do not consume them) and any dependency artifacts
    if (entry === "i18n" || entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

function scanUsages(files: string[]): Usage[] {
  const usages: Usage[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const relPath = relative(SRC_ROOT, file).split(sep).join("/");
    USED_KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = USED_KEY_RE.exec(src)) !== null) {
      const key = m[1];
      if (key === undefined) continue;
      const line = src.slice(0, m.index).split("\n").length;
      usages.push({ key, loc: `${relPath}:${line}` });
    }
  }
  return usages;
}

const sourceFiles = collectSourceFiles(SRC_ROOT, []);
const usages = scanUsages(sourceFiles);
const usedKeys = new Set(usages.map((u) => u.key));
const zhKeys = flattenKeys(zh).sort();
const enKeys = flattenKeys(en).sort();
const zhKeySet = new Set(zhKeys);

describe("词典键位奇偶（覆盖套件内复核）", () => {
  test("zh 与 en 键位完全一致", () => {
    expect(zhKeys).toEqual(enKeys);
  });
});

describe("已使用键覆盖（CI 强制）", () => {
  test("扫描器健康：至少扫到 1 个源文件与 1 个已使用键（防扫描器失效导致测试空洞）", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(usedKeys.size).toBeGreaterThan(0);
  });

  test("组件中每个 t() 字面量键都必须存在于词典", () => {
    const missing = usages.filter((u) => !zhKeySet.has(u.key)).map((u) => `${u.loc} → "${u.key}"`);
    if (missing.length > 0) {
      console.error(
        `Missing ${missing.length} dictionary key(s) used via t(). ` +
          `Add each one to BOTH apps/studio/src/i18n/locales/zh-*.ts and en-*.ts at the same dotted path:`,
      );
      for (const line of missing) console.error(`  - ${line}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("未使用键报告（仅记录，不失败）", () => {
  test("词典中未被任何扫描源引用的键 → console.log 汇总", () => {
    const unused = zhKeys.filter((k) => !usedKeys.has(k));
    const bySection = new Map<string, string[]>();
    for (const key of unused) {
      const section = key.split(".")[0] ?? "?";
      const list = bySection.get(section) ?? [];
      list.push(key);
      bySection.set(section, list);
    }
    console.log(
      `[i18n coverage] scanned ${sourceFiles.length} source files, ` +
        `${usages.length} t() literal usages (${usedKeys.size} distinct keys); ` +
        `dictionary has ${zhKeys.length} keys, ${unused.length} unreferenced ` +
        `(informational — dynamic prefixes not statically visible: ${KNOWN_DYNAMIC_PREFIXES.join(", ")})`,
    );
    for (const section of [...bySection.keys()].sort()) {
      const keys = bySection.get(section) ?? [];
      console.log(`[i18n coverage]   ${section}: ${keys.length} unused → ${keys.join(", ")}`);
    }
    // The report is informational by design: dynamic keys (errors.*) and
    // helper-consumed keys are legitimately invisible to the scanner.
    expect(Array.isArray(unused)).toBe(true);
  });
});
