// Skills 子系统（issue #52，v0.2 §6 server 侧）：SKILL.md 发现/解析/启用集/注入。
// - 格式冻结：agent-kit/SPEC.md §4.1（YAML frontmatter：name/version/description/trigger，扁平 key: value）
// - 发现：repo 根 skills/*/SKILL.md（内置）+ settings.skills.customDir（绝对路径，缺失静默跳过）
// - 解析：手写 YAML-lite（单行 key: value；不引 yaml 依赖）；坏文件 → 跳过 + console.warn，绝不炸
// - 注入：composeSkillSection 纯函数（@引用强制包含 / autoTrigger 关键词匹配 / 技能块 + 花名册）
// 契约（apps/studio 冻结）：
//   GET /api/skills → {skills: [{name, version, description, trigger, enabled, source}], autoTrigger, customDir}
//   PATCH /api/skills/:name {enabled} → 更新条目；404 SKILL_NOT_FOUND
//   PATCH /api/skills {autoTrigger?, customDir?} → 设置更新
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ServerError } from "../errors";
import type { SettingsStore } from "../settings/store";

// ---------------------------------------------------------------- 契约（冻结，前端 api.ts 镜像）

/** 解析后的完整技能记录（含 markdown 正文；GET /api/skills 不回传 body） */
export interface SkillRecord {
  name: string;
  version: string;
  description: string;
  trigger: string;
  body: string;
  source: "builtin" | "custom";
}

/** GET /api/skills 列表项 */
export interface SkillListItem {
  name: string;
  version: string;
  description: string;
  trigger: string;
  enabled: boolean;
  source: "builtin" | "custom";
}

// ---------------------------------------------------------------- 常量

/** 技能块内 Workflow 段注入上限（字符） */
const WORKFLOW_LIMIT = 1200;
/** 技能块内 Anti-patterns 段注入上限（字符） */
const ANTI_PATTERNS_LIMIT = 400;
/** 内置技能目录：repo 根 skills/（本文件位于 packages/server/src/chat/ → 上溯四级） */
const BUILTIN_SKILLS_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "skills");

/** 内置技能目录（导出供测试/诊断） */
export function builtinSkillsDir(): string {
  return BUILTIN_SKILLS_DIR;
}

// ---------------------------------------------------------------- 解析

/**
 * 手写 YAML-lite frontmatter 解析（格式冻结为扁平 key: value 单行，见 agent-kit/SPEC.md §4.1）：
 * `---` 开头 + 下一处行首 `---` 结束；每行首个 `:` 切 key/value；成对引号剥除；重复键取首个。
 * 无 frontmatter / 未闭合 → null（调用方按坏文件跳过）。
 */
export function parseSkillFrontmatter(text: string): { front: Record<string, string>; body: string } | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const front: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    }
    if (key.length > 0 && !(key in front)) front[key] = value;
  }
  // 结束 `---` 行之后的内容即 markdown 正文（跳过闭合行本身；容忍 \r\n）
  const closeEnd = text.indexOf("\n", end + 1);
  const body = closeEnd < 0 ? "" : text.slice(closeEnd + 1);
  return { front, body };
}

/**
 * 按 heading 文本提取 body 内一节（## 级边界；更深 ###/#### 不截断小节）。
 * 例：extractSection(body, "workflow") 命中 "## Workflow"；"anti-patterns" 命中 "## Anti-patterns"。
 */
export function extractSection(body: string, heading: string): string {
  const target = heading.trim().toLowerCase();
  const out: string[] = [];
  let capturing = false;
  for (const line of body.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m !== null) {
      if (capturing) break; // 下一节开始 → 结束
      if (m[1].trim().toLowerCase().startsWith(target)) capturing = true;
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

/** 超长截断（追加省略号，保留前 limit 字符） */
function clampText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 加载一个技能目录（目录不存在/不可读 → 空数组；坏文件跳过 + warn） */
async function loadSkillsFromDir(dir: string, source: "builtin" | "custom"): Promise<SkillRecord[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 目录缺失（customDir 常态）→ 静默跳过
  }
  const out: SkillRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = resolve(dir, entry.name, "SKILL.md");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      console.warn(`[videoos/server] skill skipped (${file}): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const parsed = parseSkillFrontmatter(text);
    const name = parsed?.front.name ?? "";
    const description = parsed?.front.description ?? "";
    if (parsed === null || name.length === 0 || description.length === 0) {
      console.warn(`[videoos/server] skill skipped (${file}): frontmatter requires non-empty name + description`);
      continue;
    }
    out.push({
      name,
      version: parsed.front.version ?? "",
      description,
      trigger: parsed.front.trigger ?? "",
      body: parsed.body,
      source,
    });
  }
  return out;
}

/**
 * 全量技能加载：内置 skills/ + 自定义目录（同名时 custom 覆盖 builtin）。
 * 每次调用读盘（文件小、调用频率低，不缓存 → PATCH/新增技能即时生效）。
 */
export async function loadSkills(customDir: string | null | undefined): Promise<SkillRecord[]> {
  const byName = new Map<string, SkillRecord>();
  for (const record of await loadSkillsFromDir(BUILTIN_SKILLS_DIR, "builtin")) byName.set(record.name, record);
  if (typeof customDir === "string" && customDir.length > 0) {
    for (const record of await loadSkillsFromDir(resolve(customDir), "custom")) byName.set(record.name, record);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- 注入（纯函数，orchestrator/测试共用）

/** @skill 引用语法：@ 后跟 kebab/snake 名（中文等不匹配，避免误伤普通文本） */
const SKILL_REF = /@([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** trigger 内引号短语（"..." / “...” / 「...」 / 『...』）→ 关键词；无引号短语 → 整句降级为子串匹配 */
function triggerKeywords(trigger: string): string[] {
  const keywords: string[] = [];
  for (const m of trigger.matchAll(/"([^"]+)"|“([^”]+)”|「([^」]+)」|『([^』]+)』/g)) {
    const kw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (kw.length > 0) keywords.push(kw.toLowerCase());
  }
  if (keywords.length === 0) {
    const whole = trigger.trim().toLowerCase();
    if (whole.length > 0) keywords.push(whole);
  }
  return keywords;
}

/** trigger 关键词命中用户消息（大小写不敏感子串；英文关键词对中文消息自然不命中） */
function matchesTrigger(trigger: string, messageLower: string): boolean {
  return triggerKeywords(trigger).some((kw) => messageLower.includes(kw));
}

// ---------------------------------------------------------------- CJK 匹配桥（16-r4：中文消息 ↔ 技能文本的桥接增益）

/** CJK 统一表意文字连续段（\u4e00-\u9fff） */
const CJK_RUN = /[\u4e00-\u9fff]+/g;

/**
 * 功能词二元组黑名单：高频虚词组合几乎出现在任何中文请求里（"做一个 / 帮我 / 可以"类），
 * 命中技能文本不代表语义相关 —— 桥接匹配前先剔除，降低误触发（冻结清单，可审计）。
 */
const CJK_STOP_BIGRAMS = new Set([
  "做一", "做个", "一个", "这个", "那个", "我想", "帮我", "给我",
  "可以", "想要", "需要", "一下", "什么", "怎么", "如何", "再来", "一次",
]);

/**
 * 提取消息侧 CJK 二元组（连续 2 字滑窗，去重 + 功能词黑名单过滤）：
 * "做一个产品介绍视频" → 产品 / 品介 / 介绍 / 绍视 / 视频（做一 / 一个被黑名单剔除）。
 * 动机：matchesTrigger 是纯子串匹配，中文消息与中文书写的 trigger/description 之间靠二元组桥接；
 * 英文文本天然不含 CJK 二元组 → 对纯英文技能零误伤（诚实的边界：中文消息命中不了英文关键词，
 * 该缺口由花名册兜底提示在 LLM 层弥补，见 composeSkillSection）。
 */
export function cjkBigrams(text: string): string[] {
  const grams: string[] = [];
  const seen = new Set<string>();
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      const gram = run.slice(i, i + 2);
      if (!seen.has(gram) && !CJK_STOP_BIGRAMS.has(gram)) {
        seen.add(gram);
        grams.push(gram);
      }
    }
  }
  return grams;
}

/** 技能名裸提及（@-less）：消息中出现技能名且两侧均为非名字字符（[a-z0-9_-] 之外）。例："用 product-demo 技能"。 */
function mentionsSkillName(name: string, message: string): boolean {
  if (name.length === 0) return false;
  const lower = message.toLowerCase();
  const target = name.toLowerCase();
  const boundary = /[^a-z0-9_-]/;
  let idx = lower.indexOf(target);
  while (idx >= 0) {
    const before = idx === 0 ? " " : lower[idx - 1];
    const after = idx + target.length >= lower.length ? " " : lower[idx + target.length];
    if (boundary.test(before) && boundary.test(after)) return true;
    idx = lower.indexOf(target, idx + target.length);
  }
  return false;
}

/** 消息 CJK 二元组命中技能 trigger/description 内的 CJK 子串（覆盖中文书写的触发描述，如 "用户想要竖屏短视频"） */
function matchesCjkGrams(trigger: string, description: string, grams: string[]): boolean {
  if (grams.length === 0) return false;
  const haystack = `${trigger}\n${description}`;
  return grams.some((gram) => haystack.includes(gram));
}

/** 消息是否含 CJK 字符（花名册兜底提示的触发条件之一） */
function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

export interface ComposeSkillsInput {
  /** 本轮用户消息（@引用与 trigger 匹配的输入） */
  message: string;
  /** loadSkills() 全量记录（enabled 过滤在内部完成） */
  skills: SkillRecord[];
  /** settings.skills.enabled（缺席 = 启用） */
  enabled: Record<string, boolean>;
  /** settings.skills.autoTrigger */
  autoTrigger: boolean;
}

/**
 * 组装 system prompt 技能段（纯函数）：
 * 1. @skill 引用 → 强制包含（无视 enabled；未知引用 → 追加系统注记 + 花名册兜底）
 * 2. autoTrigger → trigger 关键词命中（仅 enabled 技能）
 * 3. 命中技能注入紧凑块（技能：name（v version）/ 描述 / 工作流 ≤1200 / 反模式 ≤400）
 * 4. 恒定追加全部启用技能的一行式花名册（模型始终知道存在哪些技能）
 * 返回可直接 push 进 prompt 的行（无任何技能 → 空数组）。
 */
export function composeSkillSection(input: ComposeSkillsInput): string[] {
  if (input.skills.length === 0) return [];
  const isEnabled = (s: SkillRecord): boolean => input.enabled[s.name] !== false;
  const enabledSkills = input.skills.filter(isEnabled);
  const messageLower = input.message.toLowerCase();

  // 1) @skill 引用（大小写不敏感；显式意图优先于 enabled 开关）
  const referenced = new Set<string>();
  const unknownRefs: string[] = [];
  for (const m of input.message.matchAll(SKILL_REF)) {
    const ref = (m[1] ?? "").toLowerCase();
    const hit = input.skills.find((s) => s.name.toLowerCase() === ref);
    if (hit === undefined) {
      if (!unknownRefs.some((u) => u.toLowerCase() === ref)) unknownRefs.push(m[1] ?? "");
    } else referenced.add(hit.name);
  }

  // 2) autoTrigger 匹配（16-r4 增益，三条路径取并集）：
  //    a. 既有 quoted-phrase 关键词子串（英文消息 ↔ 英文关键词）
  //    b. 技能名裸提及（"用 product-demo 技能"，@-less）
  //    c. CJK 二元组桥（中文消息 ↔ 中文书写的 trigger/description）
  const triggered = new Set<string>();
  if (input.autoTrigger) {
    const grams = cjkBigrams(input.message);
    for (const skill of enabledSkills) {
      if (skill.trigger.length > 0 && matchesTrigger(skill.trigger, messageLower)) triggered.add(skill.name);
      else if (mentionsSkillName(skill.name, input.message)) triggered.add(skill.name);
      else if (matchesCjkGrams(skill.trigger, skill.description, grams)) triggered.add(skill.name);
    }
  }

  const lines: string[] = [];
  const included = input.skills.filter((s) => referenced.has(s.name) || triggered.has(s.name));
  if (included.length > 0) {
    lines.push("# 技能（本轮注入）");
    for (const skill of included) {
      lines.push(`## 技能：${skill.name}（v${skill.version}）`);
      lines.push(skill.description);
      const workflow = clampText(extractSection(skill.body, "workflow"), WORKFLOW_LIMIT);
      if (workflow.length > 0) lines.push("### 工作流", workflow);
      const antiPatterns = clampText(extractSection(skill.body, "anti-patterns"), ANTI_PATTERNS_LIMIT);
      if (antiPatterns.length > 0) lines.push("### 反模式", antiPatterns);
      lines.push("");
    }
  }
  for (const name of unknownRefs) {
    lines.push(`（用户引用了不存在的技能 ${name}，请提示可用技能列表）`);
  }
  if (enabledSkills.length > 0) {
    lines.push("# 可用技能（@<技能名> 可显式指定；直接描述需求可自动匹配）");
    for (const skill of enabledSkills) lines.push(`- ${skill.name} — ${skill.description}`);
    // CJK 兜底（16-r4）：中文消息命中不了英文 trigger 关键词（matchesTrigger 的既有缺口）→
    // 明示模型按语义自行对齐花名册（LLM 本身懂中文），必要时请用户 @技能名 注入完整工作流
    if (input.autoTrigger && included.length === 0 && hasCjk(input.message)) {
      lines.push("（本轮自动触发未命中：若用户需求与上述某技能语义相符，请按其名称与描述执行；需要完整工作流时请用户用 @<技能名> 显式调用）");
    }
  }
  return lines;
}

// ---------------------------------------------------------------- 服务函数（app.ts 薄壳调用）

/** GET /api/skills 响应体 */
export async function skillsSnapshot(settings: SettingsStore): Promise<{
  skills: SkillListItem[];
  autoTrigger: boolean;
  customDir: string | null;
}> {
  const values = settings.get();
  const records = await loadSkills(values.skills.customDir);
  return {
    skills: records.map((r) => ({
      name: r.name,
      version: r.version,
      description: r.description,
      trigger: r.trigger,
      enabled: values.skills.enabled[r.name] !== false,
      source: r.source,
    })),
    autoTrigger: values.skills.autoTrigger,
    customDir: values.skills.customDir,
  };
}

/** PATCH /api/skills/:name {enabled}：持久化启用/停用 → 返回更新后的条目；未知 → 404 SKILL_NOT_FOUND */
export async function setSkillEnabled(settings: SettingsStore, name: string, enabled: boolean): Promise<SkillListItem> {
  const values = settings.get();
  const record = (await loadSkills(values.skills.customDir)).find((s) => s.name === name);
  if (record === undefined) {
    throw new ServerError("SKILL_NOT_FOUND", `skill "${name}" not found (GET /api/skills 查看可用技能)`, 404);
  }
  settings.update({ skills: { enabled: { [name]: enabled } } });
  return {
    name: record.name,
    version: record.version,
    description: record.description,
    trigger: record.trigger,
    enabled,
    source: record.source,
  };
}

/** PATCH /api/skills {autoTrigger?, customDir?}：技能节设置更新（customDir 空串归一为 null） */
export function updateSkillsSettings(
  settings: SettingsStore,
  body: { autoTrigger?: unknown; customDir?: unknown },
): { autoTrigger: boolean; customDir: string | null } {
  const patch: { autoTrigger?: boolean; customDir?: string | null } = {};
  if (body.autoTrigger !== undefined) {
    if (typeof body.autoTrigger !== "boolean") {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.autoTrigger must be a boolean");
    }
    patch.autoTrigger = body.autoTrigger;
  }
  if (body.customDir !== undefined) {
    if (body.customDir === null) patch.customDir = null;
    else if (typeof body.customDir === "string") {
      const dir = body.customDir.trim();
      patch.customDir = dir.length === 0 ? null : dir;
    } else {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.customDir must be a string or null");
    }
  }
  if (patch.autoTrigger === undefined && patch.customDir === undefined) {
    throw new ServerError("SERVER_INVALID_PARAMS", "body.autoTrigger / body.customDir 至少其一");
  }
  const values = settings.update({ skills: patch });
  return { autoTrigger: values.skills.autoTrigger, customDir: values.skills.customDir };
}
