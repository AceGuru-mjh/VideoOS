#!/usr/bin/env bun
// scripts/i18n-report.ts — Studio i18n 体检报告（开发工具，信息型；非 CI 门禁）。
//
// 三个视图（覆盖 coverage.test.ts 不做的回归捕捉）：
//  1) 词典覆盖统计：zh/en 键量、键位奇偶（差异清单）、分段计数、
//     t() 字面量使用扫描 → 缺失键（CI 红线）与未引用键（信息，动态键静态不可见）
//  2) 硬编码 CJK 字面量扫描：apps/studio/src/**/*.{ts,tsx}（排除 i18n/ 词典与 *.test.*）中
//     字符串字面量 / JSX 文本里的中文 —— 组件应一律走 t()；注释已剥离（行注释 + 块注释 + 引号感知）
//  3) 结果汇总与退出码：缺省恒 0（信息型）；--strict 时任一硬编码 CJK 命中 → 退出码 1
//
// 用法：bun run i18n:report [--strict]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { flattenKeys } from "../apps/studio/src/i18n/core";
import { en } from "../apps/studio/src/i18n/en";
import { zh } from "../apps/studio/src/i18n/zh";

const ROOT = resolve(import.meta.dir, "..");
const STUDIO_SRC = join(ROOT, "apps", "studio", "src");
const STRICT = process.argv.includes("--strict");

const LINE = "-".repeat(72);
const BANNER = "=".repeat(72);

// ---------------------------------------------------------------- 源文件收集（与 coverage.test.ts 同规则）

/** 递归收集 apps/studio/src 下 .ts/.tsx（排除 i18n/ 词典目录与 *.test.*） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "i18n" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue; // .md/.css 天然不扫
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- t() 字面量使用扫描（同 coverage.test.ts 正则）

const USED_KEY_RE = /\bt\(\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;
const KNOWN_DYNAMIC_PREFIXES = ["errors."];

interface Usage {
  key: string;
  loc: string;
}

function scanUsages(files: string[]): Usage[] {
  const usages: Usage[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const relPath = relative(ROOT, file);
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

// ---------------------------------------------------------------- 硬编码 CJK 扫描（引号/注释感知，逐字符状态机）

/** CJK 表意字符（基本区 + 扩展 A + 兼容区）——判定“是否中文”的最小集合 */
const CJK_IDEOGRAPH_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** CJK 文本段字符：表意 + CJK 标点 + 全角符号（用于拼出可读的命中文本，仅表意字符计为命中） */
const CJK_TEXT_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

interface CjkFinding {
  /** 仓库相对路径:行号 */
  loc: string;
  kind: "string" | "text";
  text: string;
}

/**
 * 单文件扫描：逐字符状态机 —— 行注释 / 块注释 / 三种引号（' 与 " 不跨行，` 可跨行，
 * `\\` 转义跳过）。引号内 CJK → [string]（记录整个字面量）；引号外 CJK → [text]（JSX 文本）。
 * 已知简化（信息型工具，可接受）：JSX 文本中的撇号（don't）会临时进入“字符串态”、
 * 模板字符串内 ${} 里的引号不识别、正则字面量不识别（如 chat/util.ts 的 /通过|passed/
 * 匹配模式会被报为 [text]，属协议匹配非 UI 文案）—— 最坏情况是误归类/误报，不会漏报。
 */
function scanHardcodedCjk(content: string, relPath: string): CjkFinding[] {
  const stringHits = new Map<number, string[]>(); // 行号（字面量起始行）→ 字面量文本
  const textHits = new Map<number, string[]>(); // 行号 → CJK 文本段
  let line = 1;
  let quote: '"' | "'" | "`" | null = null;
  let literal = ""; // 当前字符串字面量内容（起始行记录在 literalLine）
  let literalLine = 0;
  let run = ""; // 当前 CJK 文本段（引号外）
  let runLine = 0;
  let blockComment = false;
  let lineComment = false;

  const flushRun = (): void => {
    if (run.length > 0 && CJK_IDEOGRAPH_RE.test(run)) {
      const list = textHits.get(runLine) ?? [];
      list.push(run);
      textHits.set(runLine, list);
    }
    run = "";
  };
  const flushLiteral = (): void => {
    if (literal.length > 0 && CJK_IDEOGRAPH_RE.test(literal)) {
      const list = stringHits.get(literalLine) ?? [];
      list.push(`"${literal.length > 48 ? `${literal.slice(0, 48)}…` : literal}"`);
      stringHits.set(literalLine, list);
    }
    literal = "";
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i] ?? "";
    const next = content[i + 1] ?? "";
    if (ch === "\n") {
      if (quote !== "`") {
        flushLiteral(); // ' 与 " 不跨行：行尾收束
        quote = null;
      }
      flushRun();
      lineComment = false;
      line++;
      continue;
    }
    if (lineComment) continue;
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++; // 消耗 '/'
      }
      continue;
    }
    if (quote !== null) {
      if (ch === "\\") {
        literal += next;
        i++; // 转义字符原样收录，跳过下一字符
        continue;
      }
      if (quote === "`" && ch === "$" && next === "{") {
        // 模板插值：简化为继续按字面量收录（信息型工具，容忍）
        literal += "${";
        i++;
        continue;
      }
      if (ch === quote) {
        flushLiteral();
        quote = null;
        continue;
      }
      literal += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      flushRun();
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      flushRun();
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      flushRun();
      quote = ch;
      literal = "";
      literalLine = line;
      continue;
    }
    if (CJK_TEXT_RE.test(ch)) {
      if (run.length === 0) runLine = line;
      run += ch;
      continue;
    }
    flushRun();
  }
  flushLiteral();
  flushRun();

  const findings: CjkFinding[] = [];
  for (const [ln, texts] of textHits) {
    findings.push({ loc: `${relPath}:${ln}`, kind: "text", text: texts.join(" … ") });
  }
  for (const [ln, literals] of stringHits) {
    findings.push({ loc: `${relPath}:${ln}`, kind: "string", text: literals.join(" | ") });
  }
  findings.sort((a, b) => (a.loc === b.loc ? a.kind.localeCompare(b.kind) : a.loc.localeCompare(b.loc)));
  return findings;
}

// ---------------------------------------------------------------- 汇总与输出

function main(): number {
  const sourceFiles = collectSourceFiles(STUDIO_SRC, []);
  const usages = scanUsages(sourceFiles);
  const usedKeys = new Set(usages.map((u) => u.key));
  const zhKeys = flattenKeys(zh).sort();
  const enKeys = flattenKeys(en).sort();
  const zhKeySet = new Set(zhKeys);
  const enKeySet = new Set(enKeys);
  const onlyZh = zhKeys.filter((k) => !enKeySet.has(k));
  const onlyEn = enKeys.filter((k) => !zhKeySet.has(k));
  const missing = usages.filter((u) => !zhKeySet.has(u.key));
  const unused = zhKeys.filter((k) => !usedKeys.has(k));
  const cjkFindings = sourceFiles.flatMap((file) => scanHardcodedCjk(readFileSync(file, "utf8"), relative(ROOT, file)));
  const cjkString = cjkFindings.filter((f) => f.kind === "string").length;
  const cjkText = cjkFindings.filter((f) => f.kind === "text").length;

  console.log(BANNER);
  console.log(" VideoOS Studio — i18n report");
  console.log(BANNER);
  console.log(" dictionaries : apps/studio/src/i18n (zh + en)");
  console.log(" source scan  : apps/studio/src/**/*.{ts,tsx} (excl. i18n/, *.test.*)");
  console.log(` flags        :${STRICT ? " --strict (any hardcoded CJK finding fails the run)" : " (informational; pass --strict to fail on hardcoded CJK)"}`);
  console.log();

  // ---- [1] 词典覆盖
  console.log("[1] Dictionary coverage");
  console.log(LINE);
  console.log(` zh keys                       : ${zhKeys.length}`);
  console.log(` en keys                       : ${enKeys.length}`);
  console.log(` parity                        : ${onlyZh.length === 0 && onlyEn.length === 0 ? "OK (zh == en)" : "MISMATCH"}`);
  for (const k of onlyZh) console.log(`   - only in zh : ${k}`);
  for (const k of onlyEn) console.log(`   - only in en : ${k}`);

  const sectionCounts = new Map<string, number>();
  for (const key of zhKeys) {
    const section = key.split(".")[0] ?? "?";
    sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
  }
  console.log();
  console.log(" section counts (zh keys)      :");
  const pad = Math.max(...[...sectionCounts.keys()].map((s) => s.length), 12);
  for (const section of [...sectionCounts.keys()].sort()) {
    console.log(`   ${section.padEnd(pad)} : ${String(sectionCounts.get(section)).padStart(4)}`);
  }

  console.log();
  console.log(" t() usage scan                :");
  console.log(`   source files                : ${sourceFiles.length}`);
  console.log(`   t() literal calls           : ${usages.length}`);
  console.log(`   distinct keys used          : ${usedKeys.size}`);
  console.log(
    `   used keys missing from dict : ${missing.length}${missing.length > 0 ? "  <-- also red in coverage.test.ts" : ""}`,
  );
  for (const u of missing) console.log(`     - ${u.loc} → "${u.key}"`);
  console.log(
    `   dict keys unreferenced      : ${unused.length}  (informational; dynamic prefixes not statically visible: ${KNOWN_DYNAMIC_PREFIXES.join(", ")})`,
  );
  const unusedBySection = new Map<string, string[]>();
  for (const key of unused) {
    const section = key.split(".")[0] ?? "?";
    const list = unusedBySection.get(section) ?? [];
    list.push(key);
    unusedBySection.set(section, list);
  }
  for (const section of [...unusedBySection.keys()].sort()) {
    const keys = unusedBySection.get(section) ?? [];
    console.log(`     ${section.padEnd(pad)} : ${keys.length} → ${keys.join(", ")}`);
  }
  console.log();

  // ---- [2] 硬编码 CJK
  console.log("[2] Hardcoded CJK literals (regression catcher)");
  console.log(LINE);
  console.log(" rule : CJK inside string literals [string] or JSX text [text];");
  console.log("        comments stripped (line + block, quote-aware); i18n/ and *.test.* excluded");
  console.log(` total: ${cjkFindings.length} (string: ${cjkString} / jsx-text: ${cjkText})`);
  console.log();
  if (cjkFindings.length === 0) {
    console.log(" (no findings — all user-visible strings flow through t())");
  } else {
    const locPad = Math.max(...cjkFindings.map((f) => f.loc.length)) + 2;
    for (const f of cjkFindings) {
      console.log(`   [${f.kind === "string" ? "string" : "text  "}] ${f.loc.padEnd(locPad)} ${f.text}`);
    }
  }
  console.log();

  // ---- [3] 结果
  console.log("[3] Result");
  console.log(LINE);
  const problems: string[] = [];
  if (onlyZh.length > 0 || onlyEn.length > 0) problems.push(`parity mismatch (${onlyZh.length} zh-only, ${onlyEn.length} en-only)`);
  if (missing.length > 0) problems.push(`${missing.length} used key(s) missing from dictionary`);
  if (cjkFindings.length > 0) problems.push(`${cjkFindings.length} hardcoded CJK literal(s)`);
  if (problems.length === 0) {
    console.log(" all checks clean — parity OK, no missing keys, no hardcoded CJK literals");
  } else {
    console.log(` findings: ${problems.join("; ")}`);
  }
  if (STRICT) {
    if (cjkFindings.length > 0) {
      console.log(" --strict: FAIL (hardcoded CJK literals present)");
      return 1;
    }
    console.log(" --strict: PASS (no hardcoded CJK literals)");
    return 0;
  }
  console.log(" exit code 0 (informational run; --strict gates on hardcoded CJK only)");
  return 0;
}

process.exit(main());
