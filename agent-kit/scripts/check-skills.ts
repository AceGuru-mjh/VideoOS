#!/usr/bin/env bun
// agent-kit/scripts/check-skills.ts — 技能库校验 harness（SPEC §4.3，Issue #38）。
// 五条规则：
//   1. frontmatter 可解析且字段齐全（name=目录名、version、description ≤ 160、trigger 非空且不与 description 雷同）
//   2. 章节存在：`# Title`、`Goal:`、`## Workflow`、`## Recipes`
//   3. Workflow 包含 `compile.run` 与 `test.run` 字样
//   4. 代码块 ≥ 2，且全文 DSL API 调用只出自白名单（真实 @videoos/dsl 面；随 DSL 演进可提 PR 增补）
//   5. 不含 emoji、不含真实密钥样文（sk- / ghp_ 前缀长串直接 fail）
// 用法：bun run agent-kit/scripts/check-skills.ts [dir]（缺省 skills/）；违规 → 非零退出 + 逐条报告。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** DSL API 白名单 = @videoos/dsl 真实导出面（VideoBuilder/SceneBuilder + defineVideo） */
const DSL_API_WHITELIST = new Set([
  "v.scene",
  "v.transition",
  "v.audio",
  "s.text",
  "s.rect",
  "s.ellipse",
  "s.image",
  "s.camera",
  "s.beat",
  "defineVideo",
]);

/** emoji 判定（表情符号块 + 变体选择符 + 区域指示符；刻意排除数学符号/箭头/制表符——存量技能合法使用） */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

/** 密钥样文：sk- / ghp_ / gho_ / github_pat_ 前缀 + 8 位以上凭证字符（\b 避免 task-/risk- 误伤） */
const KEY_SAMPLE_RE = /\b(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9]{8,}/;

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export interface SkillViolation {
  file: string;
  rule: string;
  message: string;
}

/** 解析 frontmatter（--- 包裹的 YAML 子集：仅取顶层 key: value 行） */
function parseFrontmatter(content: string): { fm: Record<string, string> | null; body: string; error?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match === null) {
    return { fm: null, body: content, error: "frontmatter block (--- ... ---) not found at file head" };
  }
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (kv !== null) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: content.slice(match[0].length) };
}

/** 校验单个 SKILL.md 内容；返回违规列表（空 = 通过）。relPath 仅用于报告定位。 */
export function checkSkillContent(content: string, relPath: string, expectedName: string): SkillViolation[] {
  const violations: SkillViolation[] = [];
  const v = (rule: string, message: string): void => {
    violations.push({ file: relPath, rule, message });
  };

  // ---- 规则 1：frontmatter ----
  const { fm, error } = parseFrontmatter(content);
  if (fm === null) {
    v("frontmatter", error ?? "frontmatter unparseable");
    return violations; // frontmatter 都没有，后续规则没有意义
  }
  if (fm.name === undefined || fm.name.length === 0) v("frontmatter", "missing field: name");
  else if (fm.name !== expectedName) v("frontmatter", `name "${fm.name}" must equal directory name "${expectedName}"`);
  else if (!KEBAB_RE.test(fm.name)) v("frontmatter", `name "${fm.name}" must be kebab-case`);
  if (fm.version === undefined || !/^\d+\.\d+\.\d+$/.test(fm.version)) {
    v("frontmatter", `missing/invalid field: version (expected semver like "0.1.0", got ${JSON.stringify(fm.version)})`);
  }
  if (fm.description === undefined || fm.description.length === 0) {
    v("frontmatter", "missing field: description");
  } else if (fm.description.length > 160) {
    v("frontmatter", `description is ${fm.description.length} chars (max 160)`);
  }
  if (fm.trigger === undefined || fm.trigger.length === 0) {
    v("frontmatter", "missing field: trigger");
  } else if (fm.description !== undefined && fm.trigger === fm.description) {
    v("frontmatter", "trigger must not be identical to description (they serve different readers)");
  }

  // ---- 规则 2：章节 ----
  const h1s = content.match(/^# (.+)$/m);
  if (h1s === null) v("sections", "missing top-level heading: `# Title`");
  if (!/^Goal:/m.test(content)) v("sections", "missing `Goal:` line");
  if (!/^## Workflow\b/m.test(content)) v("sections", "missing section: `## Workflow`");
  if (!/^## Recipes\b/m.test(content)) v("sections", "missing section: `## Recipes`");

  // ---- 规则 3：Workflow 必须引用 compile.run 与 test.run ----
  const workflowMatch = content.match(/^## Workflow\b([\s\S]*?)(?=^## |\Z)/m);
  const workflow = workflowMatch !== null ? workflowMatch[1] : "";
  if (!workflow.includes("compile.run")) v("workflow", "`## Workflow` must reference `compile.run` (VAP tool)");
  if (!workflow.includes("test.run")) v("workflow", "`## Workflow` must reference `test.run` (VAP tool)");

  // ---- 规则 4：代码块 ≥ 2 + DSL API 白名单 ----
  const blocks = [...content.matchAll(/```[^\n]*\n[\s\S]*?```/g)];
  if (blocks.length < 2) v("recipes", `expected ≥ 2 fenced code blocks, found ${blocks.length}`);
  const calls = [...content.matchAll(/\b([sv])\.([a-zA-Z]+)\(/g)];
  const badCalls = new Set<string>();
  for (const call of calls) {
    const api = `${call[1]}.${call[2]}`;
    if (!DSL_API_WHITELIST.has(api)) badCalls.add(api);
  }
  if (badCalls.size > 0) {
    v(
      "recipes",
      `non-whitelisted DSL API calls: ${[...badCalls].join(", ")} (whitelist: ${[...DSL_API_WHITELIST].join(", ")})`,
    );
  }
  if (!/\bdefineVideo\(/.test(content) && calls.length === 0) {
    // 有代码块但一个 DSL 调用都没有 —— 提示级违规（存量 visual-qa 豁免：其 Recipes 为 QA 套件代码，规则 4 原文只约束白名单）
    // 说明：此分支刻意不产出违规 —— 规则 4 的原文是“只使用白名单”，零调用满足之。
  }

  // ---- 规则 5：emoji / 密钥样文 ----
  const emoji = content.match(EMOJI_RE);
  if (emoji !== null) v("hygiene", `emoji found: ${emoji[0]} (U+${emoji[0].codePointAt(0)?.toString(16)})`);
  const key = content.match(KEY_SAMPLE_RE);
  if (key !== null) v("hygiene", `credential-like sample found: ${key[0].slice(0, 12)}… — never commit key-shaped strings`);

  return violations;
}

export interface CheckResult {
  ok: boolean;
  checked: number;
  violations: SkillViolation[];
}

/** 扫描目录下全部 skills/<name>/SKILL.md */
export function checkSkillsDir(root: string): CheckResult {
  const violations: SkillViolation[] = [];
  let checked = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(root).filter((e) => statSync(join(root, e)).isDirectory());
  } catch (err) {
    return {
      ok: false,
      checked: 0,
      violations: [{ file: root, rule: "io", message: `cannot read skills directory: ${(err as Error).message}` }],
    };
  }
  if (entries.length === 0) {
    return { ok: false, checked: 0, violations: [{ file: root, rule: "io", message: "no skill directories found" }] };
  }
  for (const name of entries.sort()) {
    const file = join(root, name, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      violations.push({ file: join(name, "SKILL.md"), rule: "io", message: "SKILL.md not found in skill directory" });
      continue;
    }
    checked += 1;
    violations.push(...checkSkillContent(content, join(name, "SKILL.md"), name));
  }
  return { ok: violations.length === 0, checked, violations };
}

// ---------------------------------------------------------------- CLI 入口
if (import.meta.main) {
  const dir = process.argv[2] ?? join(import.meta.dir, "..", "..", "skills");
  const result = checkSkillsDir(dir);
  if (result.violations.length === 0) {
    console.log(`[check-skills] OK — ${result.checked} skills passed (${dir})`);
    process.exit(0);
  }
  console.error(`[check-skills] FAIL — ${result.violations.length} violation(s) across ${dir}:`);
  for (const { file, rule, message } of result.violations) {
    console.error(`  ✗ ${file} [${rule}] ${message}`);
  }
  process.exit(1);
}
