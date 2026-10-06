// Knowledge 子系统（v0.2.1 任务 11-b）：普通模型 → Opus 级视频的「大脑」三入口四工具。
// - pattern.search / pattern.get：动效模式库检索与全文取回（抄代码而非发明代码）
// - skill.read：内置技能 SKILL.md 的全文/分节阅读（品类方法论）
// - dsl.reference：DSL 分主题速查（引擎事实，源码实读，docs 可能滞后）
// 数据全部来自 ./knowledge-data（MOTION_PATTERNS 34 条 + DSL_TOPICS 9 主题）；
// 本模块只导出不注册——接线（state.ts 注册 + gate.ts 分类 + orchestrator 提示）由 11-c 完成。
import { z } from "zod";
import type { VapTool, VapToolArgs, VapToolResult } from "@videoos/agent";
import { DSL_TOPIC_KEYS, DSL_TOPICS, MOTION_PATTERNS } from "./knowledge-data";
import { extractSection, loadSkills } from "./skills";

// ---------------------------------------------------------------- 常量

/** pattern.search 默认返回条数（保持上下文紧凑；全量逐条 pattern.get） */
const SEARCH_DEFAULT_LIMIT = 8;
/** pattern.search 返回条数上限 */
const SEARCH_MAX_LIMIT = 20;
/** 错误信息里 available 清单最多列出的名字数（余者用 … 省略） */
const AVAILABLE_SAMPLE = 15;
/** skill.read 合法节名（extractSection 按 ## 标题前缀匹配；"qa" 命中 "## QA gates"） */
const SKILL_SECTIONS = ["goal", "workflow", "recipes", "qa", "anti-patterns"] as const;

/** available 清单（前 15 个 + 省略号 + 总数；与 skills.ts / templates.ts 错误文案同风格） */
function availableList(names: string[]): string {
  const shown = names.slice(0, AVAILABLE_SAMPLE).join(", ");
  return `${shown}${names.length > AVAILABLE_SAMPLE ? "…" : ""}, 共 ${names.length} 个`;
}

/** 模式摘要（search 命中项：不含 code/notes，紧凑） */
function patternSummary(pattern: (typeof MOTION_PATTERNS)[number]): Record<string, unknown> {
  return { id: pattern.id, name: pattern.name, tags: pattern.tags, description: pattern.description };
}

// ---------------------------------------------------------------- 工具

/**
 * 知识四工具（pattern.search / pattern.get / skill.read / dsl.reference）。
 * 全部为纯读工具（不写文件、不依赖会话状态）；skill.read 每次读盘（技能修复即时生效）。
 */
export function createKnowledgeTools(): VapTool[] {
  const patternSearch: VapTool = {
    name: "pattern.search",
    description:
      "搜索动效模式库（34 条可抄 DSL 片段：开场钩子/节奏/文字/数据/画面/转场/结尾）。按 id/中文名/标签/描述子串匹配（大小写不敏感）；命中后用 pattern.get 取完整代码与引擎陷阱",
    schema: z.object({
      query: z.string().min(1).describe("关键词（子串匹配 id/name/tags/description，大小写不敏感；如 hook、stagger、转场、柱状图）"),
      limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional().describe(`返回条数上限（缺省 ${SEARCH_DEFAULT_LIMIT}，最大 ${SEARCH_MAX_LIMIT}）`),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const query = String(args.query ?? "").trim().toLowerCase();
      const limit = typeof args.limit === "number" ? args.limit : SEARCH_DEFAULT_LIMIT;
      const matched = MOTION_PATTERNS.filter((p) =>
        `${p.id} ${p.name} ${p.tags.join(" ")} ${p.description}`.toLowerCase().includes(query),
      );
      if (matched.length === 0) {
        return {
          ok: true,
          data: {
            patterns: [],
            total: 0,
            hint:
              `无命中「${String(args.query ?? "")}」：换更宽泛的词试试——类目（hook/rhythm/text/data/visual/transition/ending）、` +
              "效果名（fade/slide/blur/scale-pop/typewriter）或中文关键词（标题/列表/计数/柱状图/分屏/转场/结尾）",
          },
        };
      }
      return {
        ok: true,
        data: {
          patterns: matched.slice(0, limit).map(patternSummary),
          total: matched.length,
          hint: `pattern.get(<id>) 查看完整代码（如 pattern.get ${JSON.stringify(matched[0]!.id)}）`,
        },
      };
    },
  };

  const patternGet: VapTool = {
    name: "pattern.get",
    description:
      "取回单个动效模式全文：真实 DSL 片段（场景体形态只含 s.* 调用，直接粘贴进 v.scene 回调；转场类为整程序形态）+ 1-3 条引擎陷阱（带 why）。id 来自 pattern.search",
    schema: z.object({
      id: z.string().describe("模式 id（pattern.search 返回的 kebab-case 标识，如 stagger-list）"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const id = String(args.id ?? "");
      const pattern = MOTION_PATTERNS.find((p) => p.id === id);
      if (pattern === undefined) {
        return {
          ok: false,
          error: `PATTERN_NOT_FOUND: ${JSON.stringify(id)} (available: ${availableList(MOTION_PATTERNS.map((p) => p.id))})`,
        };
      }
      return {
        ok: true,
        data: {
          pattern: {
            id: pattern.id, name: pattern.name, tags: pattern.tags,
            description: pattern.description, code: pattern.code, notes: pattern.notes,
          },
        },
      };
    },
  };

  const skillRead: VapTool = {
    name: "skill.read",
    description:
      "阅读内置技能的 SKILL.md（品类方法论：工作流/配方/质检门/反模式）。缺省返回全文；给 section 只取一节（goal/workflow/recipes/qa/anti-patterns）",
    schema: z.object({
      name: z.string().describe("技能名（如 tech-intro、countdown；大小写不敏感精确匹配）"),
      section: z.enum(SKILL_SECTIONS).optional().describe("只取该节（## 标题匹配；qa 对应「## QA gates」）；缺省返回全文"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const wanted = String(args.name ?? "").trim().toLowerCase();
      const skills = await loadSkills(null);
      const skill = skills.find((s) => s.name.toLowerCase() === wanted);
      if (skill === undefined) {
        return {
          ok: false,
          error: `SKILL_NOT_FOUND: ${JSON.stringify(String(args.name ?? ""))} (available: ${availableList(skills.map((s) => s.name))})`,
        };
      }
      let body = skill.body;
      if (args.section !== undefined) {
        // extractSection 按「## 标题文本前缀」匹配（startswith）："qa" 命中 "## QA gates"
        body = extractSection(skill.body, String(args.section));
        if (body.length === 0) {
          return {
            ok: false,
            error:
              `SECTION_EMPTY: 技能 ${skill.name} 无「${String(args.section)}」节` +
              "（以正文 ## 标题为准，常见节：Workflow / Recipes / QA gates / Anti-patterns；Goal 常为正文段而非标题）",
          };
        }
      }
      return {
        ok: true,
        data: {
          skill: { name: skill.name, version: skill.version, description: skill.description, trigger: skill.trigger, body },
        },
      };
    },
  };

  const dslReference: VapTool = {
    name: "dsl.reference",
    description:
      "DSL 分主题速查（源码实读的引擎事实）：builder 构建器 / text 文字层 / effects 效果与缓动 / camera 相机 / transition 过渡 / timing 时间窗 / geometry 几何 / diagnostics 诊断码 / workflow 代理工作流",
    schema: z.object({
      topic: z.string().describe("主题键或别名（大小写不敏感，如 timing、easings、fonts）"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const wanted = String(args.topic ?? "").trim().toLowerCase();
      const key = DSL_TOPIC_KEYS.find(
        (k) => k.toLowerCase() === wanted || DSL_TOPICS[k]!.aliases.some((a) => a.toLowerCase() === wanted),
      );
      if (key === undefined) {
        return {
          ok: false,
          error: `DSL_TOPIC_NOT_FOUND: ${String(args.topic ?? "")} (available: ${DSL_TOPIC_KEYS.join(", ")})`,
        };
      }
      const topic = DSL_TOPICS[key]!;
      return { ok: true, data: { topic: key, content: topic.content, related: topic.related } };
    },
  };

  return [patternSearch, patternGet, skillRead, dslReference];
}
