// Skills 子系统（#52）：SKILL.md 发现/解析/@引用/自动触发/系统提示注入。
// 格式冻结契约见 agent-kit/SPEC.md §4.1（frontmatter: name/version/description/trigger；
// 正文：# Title / Goal: 行 / ## Workflow 编号步骤 / ## Recipes DSL 片段）。
// frontmatter 为手写行级解析器（不引 YAML 依赖）；非法文件静默跳过并记入 lastErrors。
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SettingsStore } from "../settings";

/** 已发现的技能（GET /api/skills 列表项形状） */
export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  trigger: string;
  /** SKILL.md 所在目录（绝对路径） */
  dir: string;
  source: "builtin" | "custom";
  enabled: boolean;
}

export interface SkillServiceOptions {
  /** 内置技能搜索目录（repo skills/ 存在时自动纳入） */
  defaultDirs: string[];
  settings: SettingsStore;
}

/** 内置技能目录探测：env VIDEOOS_SKILLS_DIR → 仓根 skills/（monorepo 布局） */
export function defaultSkillsDirs(): string[] {
  const dirs: string[] = [];
  const env = process.env.VIDEOOS_SKILLS_DIR;
  if (typeof env === "string" && env.length > 0) dirs.push(resolve(env));
  const here = dirname(fileURLToPath(import.meta.url)); // packages/server/src/chat
  const repoSkills = resolve(here, "..", "..", "..", "..", "skills");
  if (existsSync(repoSkills)) dirs.push(repoSkills);
  return dirs;
}

// ---------------------------------------------------------------------------
// SKILL.md 解析（冻结契约 D：首段 `---` 包裹的 frontmatter + 正文）
// ---------------------------------------------------------------------------

/** 技能名：kebab-case（小写字母/数字段，连字符分隔） */
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** 版本：宽松校验，允许 v 前缀（解析时剥掉） */
const VERSION_RE = /^v?\d+\.\d+\.\d+$/;
/** SPEC 要求 description ≤160 字符，解析容忍至 200（超长视为非法） */
const DESCRIPTION_MAX = 200;
const DEFAULT_VERSION = "0.1.0";
/** 自动触发入选阈值：≥5（单个 name token 命中恰好 5 分） */
const AUTO_TRIGGER_MIN_SCORE = 5;
/** 自动触发最多返回的技能数 */
const AUTO_TRIGGER_MAX_SKILLS = 5;
/** Workflow 摘要：行数上限 / 缩进后总字符上限（含省略号） */
const WORKFLOW_SUMMARY_MAX_LINES = 8;
const WORKFLOW_SUMMARY_MAX_CHARS = 700;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ParsedSkill {
  name: string;
  version: string;
  description: string;
  trigger: string;
  /** frontmatter 之后的正文（buildPromptBlock 提取 Workflow 摘要用） */
  body: string;
}

type ParseResult = { ok: true; skill: ParsedSkill } | { ok: false; error: string };

/**
 * 行级 frontmatter 解析：首个 `---` 行到下一个 `---` 行之间按 `key: value`
 * （首个冒号切分、两侧去空白）取 name/version/description/trigger 四字段。
 * 值内含冒号安全（只切第一个冒号）；未知键与空行忽略。
 */
function parseSkillMd(raw: string): ParseResult {
  // 剥 BOM；容忍 frontmatter 前的空行；正文先于 --- 出现 = 无 frontmatter
  let text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  text = text.replace(/^[ \t]*\r?\n+/, "");
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== "---") {
    return { ok: false, error: "missing frontmatter (file must open with a --- line)" };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { ok: false, error: "unterminated frontmatter (no closing ---)" };

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue; // 空行 / 无值行忽略
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.length > 0 && value.length > 0) fields[key] = value;
  }

  const name = fields.name ?? "";
  if (!KEBAB_RE.test(name)) {
    return { ok: false, error: `invalid or missing frontmatter name: ${JSON.stringify(name)}` };
  }
  const description = fields.description ?? "";
  if (description.length === 0 || description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `description must be 1..${DESCRIPTION_MAX} chars (got ${description.length})` };
  }
  const trigger = fields.trigger ?? "";
  if (trigger.length === 0) {
    return { ok: false, error: "trigger must be a non-empty string" };
  }
  const rawVersion = fields.version ?? DEFAULT_VERSION;
  if (!VERSION_RE.test(rawVersion)) {
    return { ok: false, error: `invalid version: ${JSON.stringify(rawVersion)}` };
  }
  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;

  return {
    ok: true,
    skill: { name, version, description, trigger, body: lines.slice(end + 1).join("\n") },
  };
}

/** 提取 `## Workflow` 段正文：标题行之后到下一个 `## ` 标题行（或 EOF） */
function extractWorkflowSection(body: string): string {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Workflow\s*$/.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * Workflow 摘要行：跳过空行、markdown 表格行（| 开头）与代码围栏（``` 开头，
 * 围栏内容一并跳过）；保留编号步骤与普通文本行，最多 maxLines 行。
 */
function workflowSummaryLines(section: string, maxLines: number): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("|")) continue; // 表格行
    out.push(trimmed);
    if (out.length >= maxLines) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 自动触发打分（拉丁 token 交集 + CJK 2 字 shingle 子串）
// ---------------------------------------------------------------------------

interface TextTokens {
  /** 拉丁/数字 token（小写化，按非字母数字切分） */
  latin: Set<string>;
  /** CJK 2 字 shingle（连续汉字段滑窗切出） */
  cjk: Set<string>;
}

const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;

/** 文本 token 化：拉丁串按 \W+ 切分成词；CJK 连续段另切 2 字 shingle */
function tokenizeForMatch(text: string): TextTokens {
  const lower = text.toLowerCase();
  const latin = new Set(lower.match(/[a-z0-9]+/g) ?? []);
  const cjk = new Set<string>();
  for (const run of lower.matchAll(CJK_RUN_RE)) {
    for (let i = 0; i + 2 <= run[0].length; i++) cjk.add(run[0].slice(i, i + 2));
  }
  return { latin, cjk };
}

/** 字符串的拉丁 token 集（小写化） */
function latinTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * 单技能打分：拉丁 token 命中 name/trigger/description 的 token 集分别计 5/3/1 分
 * （name token 命中权重最高——用户点名技能类别词是最强信号）；
 * CJK：文本 2 字 shingle 作为子串出现在 trigger+description 小写串中 → 每个 +2，
 * CJK 项合计封顶 10（中文无词边界，2 字 shingle 子串匹配比 token 交集更鲁棒）。
 */
function scoreSkill(info: SkillInfo, text: TextTokens): number {
  const nameTokens = latinTokens(info.name);
  const triggerTokens = latinTokens(info.trigger);
  const descriptionTokens = latinTokens(info.description);
  let score = 0;
  for (const token of text.latin) {
    if (nameTokens.has(token)) score += 5;
    if (triggerTokens.has(token)) score += 3;
    if (descriptionTokens.has(token)) score += 1;
  }
  if (text.cjk.size > 0) {
    const haystack = `${info.trigger} ${info.description}`.toLowerCase();
    let cjkScore = 0;
    for (const shingle of text.cjk) {
      if (haystack.includes(shingle)) cjkScore += 2;
    }
    score += Math.min(cjkScore, 10);
  }
  return score;
}

// ---------------------------------------------------------------------------
// SkillService
// ---------------------------------------------------------------------------

/** 内部记录：SkillInfo + SKILL.md 正文（提示块 Workflow 摘要用） */
interface SkillRecord {
  info: SkillInfo;
  body: string;
}

export class SkillService {
  private readonly options: SkillServiceOptions;
  private records = new Map<string, SkillRecord>();
  private errors: string[] = [];

  constructor(options: SkillServiceOptions) {
    this.options = options;
  }

  /** 最近一次 refresh 被静默跳过的文件与原因（诊断用；每次 refresh 清空重记） */
  get lastErrors(): string[] {
    return [...this.errors];
  }

  /** 重扫描目录（defaultDirs + settings.skills.customDir）；幂等（清空重扫） */
  async refresh(): Promise<void> {
    this.records = new Map();
    this.errors = [];
    const settings = this.options.settings.get();
    // builtin 目录先扫、custom 目录后扫；同名技能后写覆盖 → custom 覆盖 builtin
    const dirs: Array<{ dir: string; source: "builtin" | "custom" }> = this.options.defaultDirs.map((dir) => ({
      dir: resolve(dir),
      source: "builtin" as const,
    }));
    if (settings.skills.customDir !== null) {
      dirs.push({ dir: resolve(settings.skills.customDir), source: "custom" });
    }

    for (const { dir, source } of dirs) {
      if (!existsSync(dir)) continue;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        this.errors.push(`${dir}: readdir failed: ${errMsg(err)}`);
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue; // 杂散文件忽略
        const mdPath = join(dir, entry.name, "SKILL.md");
        if (!existsSync(mdPath)) continue; // 无 SKILL.md 的目录忽略（不计错误）
        await this.loadSkillFile(mdPath, entry.name, source, settings.skills.enabled);
      }
    }
  }

  /** 读取并校验单个 SKILL.md；非法则记入 errors（路径 + 原因） */
  private async loadSkillFile(
    mdPath: string,
    dirName: string,
    source: "builtin" | "custom",
    enabledMap: Record<string, boolean>,
  ): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(mdPath, "utf8");
    } catch (err) {
      this.errors.push(`${mdPath}: read failed: ${errMsg(err)}`);
      return;
    }
    const parsed = parseSkillMd(raw);
    if (!parsed.ok) {
      this.errors.push(`${mdPath}: ${parsed.error}`);
      return;
    }
    if (parsed.skill.name !== dirName) {
      this.errors.push(`${mdPath}: frontmatter name "${parsed.skill.name}" does not match directory "${dirName}"`);
      return;
    }
    this.records.set(parsed.skill.name, {
      info: {
        name: parsed.skill.name,
        version: parsed.skill.version,
        description: parsed.skill.description,
        trigger: parsed.skill.trigger,
        dir: dirname(mdPath),
        source,
        enabled: enabledMap[parsed.skill.name] ?? true,
      },
      body: parsed.skill.body,
    });
  }

  /** 全部已发现技能（按名排序；enabled 取自 settings.skills.enabled，缺省 true） */
  list(): SkillInfo[] {
    return [...this.records.values()]
      .map((r) => ({ ...r.info }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  get(name: string): SkillInfo | null {
    const rec = this.records.get(name);
    return rec ? { ...rec.info } : null;
  }

  /** 启停（写 settings.skills.enabled 并同步内存）；未知技能返回 false */
  setEnabled(name: string, enabled: boolean): boolean {
    const rec = this.records.get(name);
    if (!rec) return false;
    this.options.settings.update({ skills: { enabled: { [name]: enabled } } });
    rec.info.enabled = enabled;
    return true;
  }

  /**
   * 解析用户消息中的 "@skill-name" 显式引用：命中技能 + 未知名清单。
   * 规则与 v1 已知限制：
   * - 只识别 @ + kebab-case token（小写字母/数字/连字符）；"@Alpha"（大写）不识别；
   * - "@alpha.com" 只取 "alpha"（不感知域名后缀，可能误报——v1 接受）；
   * - "@" 前一字符是字母/数字（如邮箱 a@alpha.com 的 local part）→ 不视为引用；
   * - 禁用技能仍解析（显式 @ 是用户意图，优先于开关），enabled 原样返回由调用方决策；
   * - token 命中已发现技能 → skills（首现顺序去重）；否则 → unknown。
   */
  resolveReferences(text: string): { skills: SkillInfo[]; unknown: string[] } {
    const skills: SkillInfo[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(/@([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      const at = m.index ?? 0;
      // @ 前是词字符（邮箱 local part 等）→ 非技能引用
      if (at > 0 && /[a-zA-Z0-9]/.test(text[at - 1])) continue;
      const token = m[1];
      if (seen.has(token)) continue;
      seen.add(token);
      const rec = this.records.get(token);
      if (rec) skills.push({ ...rec.info });
      else unknown.push(token);
    }
    return { skills, unknown };
  }

  /**
   * 自动触发匹配：对每个已启用技能打分，返回分数 ≥5 的前 5 个
   * （分数降序、同分按名升序——确定性排序）。
   * settings.skills.autoTrigger=false 时恒返回空（显式 @ 引用不受影响）。
   */
  matchAutoTrigger(text: string): SkillInfo[] {
    if (!this.options.settings.get().skills.autoTrigger) return [];
    const tokens = tokenizeForMatch(text);
    if (tokens.latin.size === 0 && tokens.cjk.size === 0) return [];
    const scored: Array<{ info: SkillInfo; score: number }> = [];
    for (const rec of this.records.values()) {
      if (!rec.info.enabled) continue; // 自动触发只考虑已启用技能
      const score = scoreSkill(rec.info, tokens);
      if (score >= AUTO_TRIGGER_MIN_SCORE) scored.push({ info: rec.info, score });
    }
    scored.sort(
      (a, b) => b.score - a.score || (a.info.name < b.info.name ? -1 : a.info.name > b.info.name ? 1 : 0),
    );
    return scored.slice(0, AUTO_TRIGGER_MAX_SKILLS).map((s) => ({ ...s.info }));
  }

  /**
   * 系统提示注入块：技能清单（what/when）+ Workflow 摘要（前 8 个非空行，
   * 剔表格行与围栏代码，4 空格缩进，总计 ≤700 字符超出截断加省略号）
   * + @ 引用收尾指令。空入参 → 空串；无 Workflow 段的技能省略摘要行。
   */
  buildPromptBlock(skills: SkillInfo[]): string {
    if (skills.length === 0) return "";
    const sections: string[] = [];
    for (const skill of skills) {
      const lines = [
        `### skill: ${skill.name} (v${skill.version})`,
        `- what: ${skill.description}`,
        `- when: ${skill.trigger}`,
      ];
      const rec = this.records.get(skill.name);
      if (rec) {
        const summary = workflowSummaryLines(extractWorkflowSection(rec.body), WORKFLOW_SUMMARY_MAX_LINES);
        if (summary.length > 0) {
          lines.push("- workflow summary:");
          let block = summary.map((line) => `    ${line}`).join("\n");
          if (block.length > WORKFLOW_SUMMARY_MAX_CHARS) {
            block = `${block.slice(0, WORKFLOW_SUMMARY_MAX_CHARS - 1)}…`;
          }
          lines.push(block);
        }
      }
      sections.push(lines.join("\n"));
    }
    return [
      "## Skills (video production workflows)",
      "",
      "When a skill below matches the user's request, follow its workflow steps and QA gates. Reference real VAP tool names only.",
      "",
      sections.join("\n\n"),
      "",
      "To use a skill the user mentioned with @name, follow it closely.",
    ].join("\n");
  }
}
