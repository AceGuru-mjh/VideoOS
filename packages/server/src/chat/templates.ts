// Template 子系统（v0.2.1 任务 11-a）：模板库发现/加载 + template.list / inspect / apply 三工具。
// - 模板 = 一个可直接编译的完整视频项目（templates/<name>/{template.json, video.project.json, src/video.ts, README.md}）
// - 定位：弱模型的「脚手架」——与其从零写 DSL，不如 template.apply 一个完整可跑的成片再改文案/配色/数据
// - 发现：repo 根 templates/（本文件位于 packages/server/src/chat/ → 上溯四级，与 skills.ts BUILTIN_SKILLS_DIR 同模式）
// - 容错：坏模板跳过 + console.warn，绝不抛错（与 loadSkills 同纪律）
// - 注册：本模块只导出不注册；由 state.ts / gate.ts 的后续接线任务（11-c）统一挂载
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { asVapSession, createVapContext, type VapContext } from "@videoos/agent";
import type { VapTool, VapToolArgs, VapToolResult } from "@videoos/agent";

// ---------------------------------------------------------------- 契约

/** 模板清单（templates/<name>/template.json 的形状） */
export interface TemplateManifest {
  name: string;
  /** 中文标题 */
  title: string;
  /** 中文描述（≤120 字符，说明产出什么） */
  description: string;
  /** 英文小写检索标签 */
  tags: string[];
  durationSeconds: number;
  aspect: "16:9" | "1:1" | "9:16";
  /** 中文使用场景（2-4 条） */
  useCases: string[];
}

/** 加载后的完整模板记录（inspect/apply 的数据源） */
export interface TemplateRecord {
  manifest: TemplateManifest;
  /** video.project.json 原文解析结果（未做形状校验，仅透传） */
  projectJson: unknown;
  /** src/video.ts 源码全文 */
  source: string;
  /** 模板目录绝对路径 */
  dir: string;
}

// ---------------------------------------------------------------- 常量与内部工具

/** 内置模板目录：repo 根 templates/（本文件位于 packages/server/src/chat/ → 上溯四级） */
const BUILTIN_TEMPLATES_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "templates");

/** template.list 响应内模板条数上限（保持上下文紧凑；全量用 inspect 逐个看） */
const LIST_LIMIT = 12;

/** 合法画幅 */
const ASPECTS: readonly string[] = ["16:9", "1:1", "9:16"];

/** 内置模板目录（导出供测试/诊断） */
export function builtinTemplatesDir(): string {
  return BUILTIN_TEMPLATES_DIR;
}

/** 非空字符串数组（tags/useCases 的形状校验） */
function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 &&
    value.every((v) => typeof v === "string" && v.trim().length > 0)
  );
}

/** 单个模板目录 → TemplateRecord；任何缺失/畸形 → null（调用方 warn + 跳过） */
async function loadTemplateDir(dir: string, dirName: string): Promise<TemplateRecord | null> {
  const manifestPath = join(dir, "template.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (err) {
    console.warn(`[videoos/server] template skipped (${manifestPath}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const m = manifest as Partial<TemplateManifest> & { name?: unknown; title?: unknown; description?: unknown; tags?: unknown; durationSeconds?: unknown; aspect?: unknown; useCases?: unknown };
  const invalid = (why: string): null => {
    console.warn(`[videoos/server] template skipped (${manifestPath}): ${why}`);
    return null;
  };
  if (typeof m.name !== "string" || m.name.length === 0) return invalid("name must be a non-empty string");
  if (m.name !== dirName) return invalid(`name (${JSON.stringify(m.name)}) must match directory name (${JSON.stringify(dirName)})`);
  if (typeof m.title !== "string" || m.title.length === 0) return invalid("title must be a non-empty string");
  if (typeof m.description !== "string" || m.description.length === 0) return invalid("description must be a non-empty string");
  if (!isNonEmptyStringArray(m.tags)) return invalid("tags must be a non-empty string array");
  if (typeof m.durationSeconds !== "number" || !Number.isFinite(m.durationSeconds) || m.durationSeconds <= 0) {
    return invalid("durationSeconds must be a positive finite number");
  }
  if (typeof m.aspect !== "string" || !ASPECTS.includes(m.aspect)) return invalid(`aspect must be one of ${ASPECTS.join(" / ")}`);
  if (!isNonEmptyStringArray(m.useCases)) return invalid("useCases must be a non-empty string array");

  let source: string;
  try {
    source = await readFile(join(dir, "src", "video.ts"), "utf8");
  } catch (err) {
    console.warn(`[videoos/server] template skipped (${join(dir, "src", "video.ts")}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  let projectJson: unknown;
  try {
    projectJson = JSON.parse(await readFile(join(dir, "video.project.json"), "utf8"));
  } catch (err) {
    console.warn(`[videoos/server] template skipped (${join(dir, "video.project.json")}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return {
    manifest: {
      name: m.name, title: m.title, description: m.description, tags: m.tags,
      durationSeconds: m.durationSeconds, aspect: m.aspect, useCases: m.useCases,
    },
    projectJson,
    source,
    dir,
  };
}

/**
 * 从指定目录加载全部模板（内部实现 + 测试入口；生产行走 loadTemplates()）。
 * 坏模板（清单缺失/畸形、src 或 project 不可读）跳过 + console.warn，绝不抛错；按 name 排序稳定输出。
 */
export async function loadTemplatesFromDir(dir: string): Promise<TemplateRecord[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 目录缺失 → 静默空（与 loadSkillsFromDir 同语义）
  }
  const out: TemplateRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const record = await loadTemplateDir(join(dir, entry.name), entry.name);
    if (record !== null) out.push(record);
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** 全量内置模板加载（每次读盘，新增/修复模板即时生效——与 loadSkills 同策略） */
export async function loadTemplates(): Promise<TemplateRecord[]> {
  return loadTemplatesFromDir(BUILTIN_TEMPLATES_DIR);
}

// ---------------------------------------------------------------- VAP 工具

/**
 * 模板三工具（template.list / template.inspect / template.apply）。
 * 只导出不注册——接线（state.ts 注册 + gate.ts 分类 + orchestrator 提示）由 11-c 完成。
 */
export function createTemplateTools(): VapTool[] {
  /** 按名查找；未找到时给出带可用清单的错误串 */
  const findOrError = (templates: TemplateRecord[], name: string): { record: TemplateRecord } | { error: string } => {
    const record = templates.find((t) => t.manifest.name === name);
    if (record === undefined) {
      return { error: `TEMPLATE_NOT_FOUND: ${JSON.stringify(name)} (available: ${templates.map((t) => t.manifest.name).join(", ") || "<none>"})` };
    }
    return { record };
  };

  const templateList: VapTool = {
    name: "template.list",
    description: "列出内置视频模板（可按关键词过滤 name/标题/标签/描述）；先用本工具选模板，再 template.inspect 看源码，最后 template.apply 应用",
    schema: z.object({
      query: z.string().optional().describe("关键词（子串匹配 name/title/tags/description，大小写不敏感；缺省列出全部）"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const templates = await loadTemplates();
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const matched = query.length === 0
        ? templates
        : templates.filter((t) =>
          `${t.manifest.name} ${t.manifest.title} ${t.manifest.tags.join(" ")} ${t.manifest.description}`.toLowerCase().includes(query),
        );
      return {
        ok: true,
        data: {
          matched: matched.length,
          templates: matched.slice(0, LIST_LIMIT).map((t) => ({
            name: t.manifest.name,
            title: t.manifest.title,
            description: t.manifest.description,
            durationSeconds: t.manifest.durationSeconds,
            aspect: t.manifest.aspect,
            tags: t.manifest.tags,
          })),
          hint: "先用 template.inspect { name } 阅读完整 video.ts 源码与工程配置，改文案/配色/数据后再 template.apply；apply 会覆盖入口文件，迭代试错前建议 transaction.begin。",
        },
      };
    },
  };

  const templateInspect: VapTool = {
    name: "template.inspect",
    description: "查看单个模板的完整内容：manifest + video.project.json + src/video.ts 全文（据此决定选型与定制点）",
    schema: z.object({
      name: z.string().describe("模板名（template.list 返回的 name）"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const name = String(args.name ?? "");
      const templates = await loadTemplates();
      const found = findOrError(templates, name);
      if ("error" in found) return { ok: false, error: found.error };
      return {
        ok: true,
        data: { manifest: found.record.manifest, projectJson: found.record.projectJson, source: found.record.source },
      };
    },
  };

  const templateApply: VapTool = {
    name: "template.apply",
    description: "把模板 src/video.ts 写入项目入口并立即编译验证（会覆盖入口文件！迭代改写前建议先 transaction.begin 以便 rollback）",
    schema: z.object({
      name: z.string().describe("模板名（template.list 返回的 name）"),
      entryPath: z.string().optional().describe("写入目标（缺省 = 当前入口 src/video.ts；相对路径按项目根解析）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const name = String(args.name ?? "");
      const templates = await loadTemplates();
      const found = findOrError(templates, name);
      if ("error" in found) return { ok: false, error: found.error };
      const session = asVapSession(ctx);
      // 写入目标：显式 entryPath（绝对或相对项目根）→ 缺省当前会话入口
      const target = typeof args.entryPath === "string" && args.entryPath.length > 0
        ? (isAbsolute(args.entryPath) ? args.entryPath : join(session.workspace.root, args.entryPath))
        : session.entryPath;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, found.record.source, "utf8");
      try {
        // 默认入口：走会话自身 compile（刷新 lastCompile/vir.json，后续 render/test 直接可用）
        // 显式 entryPath 且非当前入口：临时会话按该文件编译验证（不动原会话状态）
        const result = target === session.entryPath
          ? await session.compile()
          : await (await createVapContext({ workspace: session.workspace, entryPath: target })).compile();
        return {
          ok: true,
          data: {
            template: found.record.manifest,
            entryPath: target,
            diagnostics: result.diagnostics,
            scenes: result.vir.scenes.length,
            durationSeconds: result.vir.meta.duration,
          },
        };
      } catch (err) {
        return { ok: false, error: `COMPILE_REJECTED: ${err instanceof Error ? err.message : String(err)}（源码已写入；可 transaction.rollback）` };
      }
    },
  };

  return [templateList, templateInspect, templateApply];
}
