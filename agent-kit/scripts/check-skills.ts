#!/usr/bin/env bun
// 技能库校验 harness（agent-kit SPEC §4.3）：
//   bun run agent-kit/scripts/check-skills.ts
// 校验 skills/*/SKILL.md：
//   1) frontmatter 可解析且字段齐全（name=目录名、version、description≤160、trigger 非空且与 description 不同）
//   2) 章节存在：# Title、Goal:、## Workflow、## Recipes
//   3) Workflow 包含 compile.run 与 test.run
//   4) 围栏代码块 ≥ 2
//   5) 代码块只使用 DSL API 白名单（v.xxx( / s.xxx( 方法名）
//   6) 不含 emoji、不含真实密钥样文（sk- / ghp_ / gho_ / ghu_ / github_pat_ / AKIA…）
// 退出码：0 = 全部通过；1 = 存在失败（逐文件打印违规项）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dir, "..", "..", "skills");

/** DSL 构建器方法白名单（与 packages/dsl/src/builder.ts 的公开 API 对齐） */
const DSL_METHOD_WHITELIST = new Set([
  "scene",
  "transition",
  "beat",
  "text",
  "rect",
  "ellipse",
  "image",
  "camera",
  "audio",
]);

/** 密钥样文检测（出现即 fail —— 教学示例也禁止真实格式） */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/, "OpenAI-style key (sk-…)"],
  [/ghp_[A-Za-z0-9]{20,}/, "GitHub PAT (ghp_…)"],
  [/gho_[A-Za-z0-9]{20,}/, "GitHub OAuth token (gho_…)"],
  [/ghu_[A-Za-z0-9]{20,}/, "GitHub user token (ghu_…)"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained PAT"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/xox[bap]-[A-Za-z0-9-]{10,}/, "Slack token"],
];

interface Violation {
  file: string;
  rule: string;
  detail: string;
}

const violations: Violation[] = [];

/** 提取 frontmatter（首行 --- 到下一个 ---） */
function parseFrontmatter(text: string): { fields: Map<string, string>; endLine: number } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== "---") return null;
  const fields = new Map<string, string>();
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") {
      endLine = i + 1;
      break;
    }
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const value = match[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    fields.set(match[1]!, value);
  }
  if (endLine === -1) return null;
  return { fields, endLine };
}

/** 提取围栏代码块内容（```lang … ```） */
function extractCodeBlocks(body: string): string[] {
  const blocks: string[] = [];
  const lines = body.split(/\r?\n/);
  let inBlock = false;
  let current: string[] = [];
  for (const line of lines) {
    if (!inBlock && /^```/.test(line)) {
      inBlock = true;
      current = [];
      continue;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false;
      blocks.push(current.join("\n"));
      continue;
    }
    if (inBlock) current.push(line);
  }
  // 未闭合块也算一个（便于报错定位）
  if (inBlock && current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function checkSkill(dirName: string, path: string): void {
  const text = readFileSync(path, "utf8");
  const fail = (rule: string, detail: string): void => {
    violations.push({ file: `skills/${dirName}/SKILL.md`, rule, detail });
  };

  // 1) frontmatter
  const fm = parseFrontmatter(text);
  if (fm === null) {
    fail("frontmatter", "missing or unterminated frontmatter (--- … ---)");
    return;
  }
  const name = fm.fields.get("name");
  const version = fm.fields.get("version");
  const description = fm.fields.get("description");
  const trigger = fm.fields.get("trigger");
  if (name === undefined || name.length === 0) fail("frontmatter.name", "name field is required");
  else if (name !== dirName) fail("frontmatter.name", `name "${name}" must equal directory name "${dirName}"`);
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail("frontmatter.name", `name "${name}" must be kebab-case`);
  if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
    fail("frontmatter.version", `version "${version ?? ""}" must be semver (x.y.z)`);
  }
  if (description === undefined || description.length === 0) {
    fail("frontmatter.description", "description field is required");
  } else if (description.length > 160) {
    fail("frontmatter.description", `description is ${description.length} chars (max 160)`);
  }
  if (trigger === undefined || trigger.length === 0) {
    fail("frontmatter.trigger", "trigger field is required");
  } else if (trigger === description) {
    fail("frontmatter.trigger", "trigger must differ from description");
  }

  const body = text.split(/\r?\n/).slice(fm.endLine).join("\n");

  // 2) 章节
  if (!/^# \S/m.test(body)) fail("sections", "missing top-level title (# Title)");
  if (!/^Goal:/m.test(body)) fail("sections", "missing `Goal:` line");
  if (!/^## Workflow\b/m.test(body)) fail("sections", "missing `## Workflow` section");
  if (!/^## Recipes\b/m.test(body)) fail("sections", "missing `## Recipes` section");

  // 3) Workflow 引用真实 VAP 工具
  const workflowMatch = /^## Workflow\b([\s\S]*?)(?=^## )/m.exec(body);
  const workflow = workflowMatch?.[1] ?? body;
  if (!workflow.includes("compile.run")) fail("workflow.tools", "`## Workflow` must reference compile.run");
  if (!workflow.includes("test.run")) fail("workflow.tools", "`## Workflow` must reference test.run");

  // 4) 代码块数量
  const blocks = extractCodeBlocks(body);
  if (blocks.length < 2) fail("recipes", `expected ≥ 2 fenced code blocks, found ${blocks.length}`);

  // 5) DSL 白名单（v.method( / s.method( 只允许白名单方法）
  const used = new Set<string>();
  for (const block of blocks) {
    for (const match of block.matchAll(/\b([vs])\.([a-zA-Z][a-zA-Z0-9]*)\(/g)) {
      used.add(`${match[1]}.${match[2]}`);
      if (!DSL_METHOD_WHITELIST.has(match[2]!)) {
        fail(
          "dsl-whitelist",
          `code block uses "${match[1]}.${match[2]}(" — not a real DSL builder method (whitelist: ${[...DSL_METHOD_WHITELIST].map((m) => `v/s.${m}`).join(", ")})`,
        );
      }
    }
  }

  // 6) emoji 与密钥样文
  const emoji = text.match(/\p{Extended_Pictographic}/u);
  if (emoji !== null) fail("no-emoji", `contains emoji ${JSON.stringify(emoji[0])}`);
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text)) fail("no-secrets", `contains ${label} sample`);
  }
}

// ---- 主流程 ----
const entries = readdirSync(SKILLS_DIR).filter((entry) => {
  const full = join(SKILLS_DIR, entry);
  return statSync(full).isDirectory() && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry);
});
const skillDirs = entries.sort();

if (skillDirs.length === 0) {
  console.error("check-skills: no skill directories found under skills/");
  process.exit(1);
}

for (const dir of skillDirs) {
  const path = join(SKILLS_DIR, dir, "SKILL.md");
  try {
    const text = readFileSync(path, "utf8");
    if (text.trim().length === 0) {
      violations.push({ file: `skills/${dir}/SKILL.md`, rule: "empty", detail: "file is empty" });
    } else {
      checkSkill(dir, path);
    }
  } catch {
    violations.push({ file: `skills/${dir}/SKILL.md`, rule: "missing", detail: "SKILL.md not found" });
  }
}

if (violations.length > 0) {
  console.error(`check-skills: ${violations.length} violation(s) across skills/:\n`);
  let lastFile = "";
  for (const v of violations) {
    if (v.file !== lastFile) {
      console.error(`\n${v.file}`);
      lastFile = v.file;
    }
    console.error(`  - ${v.rule}: ${v.detail}`);
  }
  console.error(`\ncheck-skills: FAIL (${skillDirs.length} skills checked, ${violations.length} violations)`);
  process.exit(1);
}

console.log(`check-skills: PASS (${skillDirs.length} skills: ${skillDirs.join(", ")})`);
