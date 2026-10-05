// Knowledge 子系统测试（任务 11-b）：
// - 数据完整性：MOTION_PATTERNS（≥30 / id 唯一 / 每条恰一个类目标签 / 描述 ≤80 / 代码 8-30 行 / 7 类目全覆盖）
//   与 DSL_TOPICS（恰好 9 规定键 / key=Record 键 / 别名不撞他键 / related 全合法 / content ≤3500）
// - 工具：pattern.search（命中 / limit / 空 query SCHEMA / 无命中建议）、pattern.get（全文 / 未知名清单）、
//   skill.read（全文 / 分节 / SECTION_EMPTY / 未知名 / 坏节值 SCHEMA）、dsl.reference（全主题 / 别名 / 未知）
// - 编译门禁（核心）：21 条零素材模式（覆盖全部 7 类目）包进最小 defineVideo → 真编译零 error 诊断
//   （模式同 templates.test.ts：临时项目必须放 repo 子树内 → @videoos/dsl 可解析）
// - 注册表接线：四工具注册进 VapToolRegistry，经 registry.call 真调（zod 校验 + 审计事件）
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { VIDEO_EFFECTS } from "@videoos/dsl";
import {
  VapToolRegistry,
  createTestWorkspace,
  createVapContext,
  asVapSession,
  type VapContext,
  type VapEvent,
  type VapSession,
  type VapToolResult,
} from "@videoos/agent";
import { createKnowledgeTools } from "./knowledge";
import { DSL_TOPIC_KEYS, DSL_TOPICS, MOTION_PATTERNS, type MotionPattern } from "./knowledge-data";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", ".."); // 仓库根（本文件位于 packages/server/src/chat/）
const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-knowledge", `knowledge-test-${process.pid}`);

/** 7 个类目标签（每条模式必须恰含其一） */
const CATEGORIES = ["hook", "rhythm", "text", "data", "visual", "transition", "ending"] as const;
/** 9 个速查主题的规定键序 */
const TOPIC_KEYS = ["builder", "text", "effects", "camera", "transition", "timing", "geometry", "diagnostics", "workflow"];

// ---------------------------------------------------------------- 助手（模式同 templates.test.ts）

/** VapToolResult 判别联合收窄（断言 + 类型双保险） */
function expectOk(result: VapToolResult): Record<string, unknown> {
  expect(result.ok).toBe(true);
  return result.data as Record<string, unknown>;
}
function expectError(result: VapToolResult): string {
  expect(result.ok).toBe(false);
  expect(typeof result.error).toBe("string");
  return result.error as string;
}

/** 最小 VapContext 桩（知识四工具全部纯读，不触碰会话状态；审计事件落到本地数组） */
function stubContext(): { ctx: VapContext; events: VapEvent[] } {
  const events: VapEvent[] = [];
  const ctx = {
    events: {
      emit: (e: VapEvent): void => {
        events.push(e);
      },
      all: (): VapEvent[] => [...events],
    },
  } as unknown as VapContext;
  return { ctx, events };
}

/** 注册了知识四工具的注册表（懒加载单例；本文件全部工具用例共用） */
let registryRef: VapToolRegistry | null = null;
function knowledgeRegistry(): VapToolRegistry {
  if (registryRef === null) {
    registryRef = new VapToolRegistry();
    for (const tool of createKnowledgeTools()) registryRef.register(tool);
  }
  return registryRef;
}

/** 在 FIXTURE_ROOT 下建临时项目并写入 entry 源码 → 返回会话（repo 子树内 → @videoos/dsl 可解析） */
async function makeSession(projectName: string, source: string): Promise<VapSession> {
  const root = join(FIXTURE_ROOT, projectName);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "video.ts"), source, "utf8");
  const workspace = await createTestWorkspace(root);
  const ctx = await createVapContext({ workspace, entryPath: join(root, "src", "video.ts") });
  return asVapSession(ctx);
}

/**
 * 模式片段 → 最小可编译整程序：
 * - 场景体形态（只含 s.* 调用）→ 包进 v.scene("test", { duration }, (s) => { ... })
 * - 整程序形态（含 v.scene/v.transition，按代码形态识别而非类目——如 cut-on-beat 属 rhythm 类）→ 直接嵌入 builder 回调
 */
function wrapPattern(pattern: MotionPattern, duration: number): string {
  const isWholeProgram = pattern.code.includes("v.scene(");
  const lines = isWholeProgram
    ? pattern.code.split("\n")
    : [`  v.scene("test", { duration: ${duration} }, (s) => {`, ...pattern.code.split("\n").map((l) => `  ${l}`), "  });"];
  return [`import { defineVideo } from \"@videoos/dsl\";`, "", `// 模式 ${pattern.id} 的编译门禁包装`, `export default defineVideo({ title: "pattern-${pattern.id}" }, (v) => {`, ...lines, "});"].join("\n");
}

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
}, 30_000);

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await rm(join(REPO_ROOT, ".tmp-knowledge"), { recursive: true, force: true }); // 本测试专用根，一并清掉防残留
}, 30_000);

// ---------------------------------------------------------------- 数据完整性

describe("knowledge 数据完整性", () => {
  test("MOTION_PATTERNS：≥30 条、id 唯一、每条恰一个类目标签、标签全小写、描述 ≤80 字符、代码 8-30 行、7 类目全覆盖", () => {
    expect(MOTION_PATTERNS.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    const cats = new Set<string>();
    for (const p of MOTION_PATTERNS) {
      expect(ids.has(p.id)).toBe(false); // id 唯一
      ids.add(p.id);
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); // kebab-case
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeLessThanOrEqual(80); // 描述 ≤80 字符
      expect(p.notes.length).toBeGreaterThan(0); // 陷阱必填
      const codeLines = p.code.split("\n").length;
      expect(codeLines).toBeGreaterThanOrEqual(8); // 代码 8-30 行
      expect(codeLines).toBeLessThanOrEqual(30);
      expect(p.tags.length).toBeGreaterThan(0);
      for (const tag of p.tags) expect(tag).toMatch(/^[a-z0-9-]+$/); // 英文小写
      const own = p.tags.filter((t) => (CATEGORIES as readonly string[]).includes(t));
      expect(own.length).toBe(1); // 恰一个类目标签
      cats.add(own[0]!);
    }
    expect([...cats].sort()).toEqual([...CATEGORIES].sort()); // 7 类目全覆盖
  }, 20_000);

  test("DSL_TOPICS：恰好 9 个规定键、key 与 Record 键一致、别名不撞任何键、related 全合法、content 非空且 ≤3500", () => {
    expect(DSL_TOPIC_KEYS).toEqual(TOPIC_KEYS);
    expect(new Set(DSL_TOPIC_KEYS).size).toBe(9); // 键唯一
    for (const key of DSL_TOPIC_KEYS) {
      const topic = DSL_TOPICS[key]!;
      expect(topic.key).toBe(key); // key 字段 = Record 键
      expect(topic.title.length).toBeGreaterThan(0); // 中文标题必填
      expect(topic.content.length).toBeGreaterThan(0);
      expect(topic.content.length).toBeLessThanOrEqual(3500); // ≤3500 字符
      expect(topic.related.length).toBeGreaterThan(0);
      for (const r of topic.related) expect(DSL_TOPIC_KEYS).toContain(r); // related 必为合法键
      for (const alias of topic.aliases) {
        expect(DSL_TOPIC_KEYS.includes(alias)).toBe(false); // 别名不得遮蔽主题键
      }
    }
  }, 20_000);
});

// ---------------------------------------------------------------- pattern.search / pattern.get

describe("pattern 工具", () => {
  test("pattern.search：hook ≥2 命中；stagger 命中 stagger-list；命中项含 id/name/tags/description 且不含 code", async () => {
    const { ctx } = stubContext();
    const hooks = expectOk(await knowledgeRegistry().call("pattern.search", { query: "hook" }, ctx));
    expect(hooks.total as number).toBeGreaterThanOrEqual(2);
    const hookList = hooks.patterns as Array<Record<string, unknown>>;
    expect(hookList.length).toBeGreaterThanOrEqual(2);
    expect(hookList.every((p) => (p.tags as string[]).includes("hook"))).toBe(true);
    expect(hookList.some((p) => p.id === "question-hook")).toBe(true);
    for (const p of hookList) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(p.code).toBeUndefined(); // 摘要不含代码
    }
    expect(String(hooks.hint)).toContain("pattern.get");

    const staggers = expectOk(await knowledgeRegistry().call("pattern.search", { query: "stagger" }, ctx));
    expect((staggers.patterns as Array<{ id: string }>).map((p) => p.id)).toContain("stagger-list");
  }, 20_000);

  test("pattern.search：limit 生效（hook 5 命中 → 只返回 2 条，total 仍为全量）；limit 上界由 schema 拒绝", async () => {
    const { ctx } = stubContext();
    const limited = expectOk(await knowledgeRegistry().call("pattern.search", { query: "hook", limit: 2 }, ctx));
    expect((limited.patterns as unknown[]).length).toBe(2);
    expect(limited.total as number).toBe(5); // 全量 5 条 hook 模式
    const overMax = await knowledgeRegistry().call("pattern.search", { query: "hook", limit: 21 }, ctx);
    expect(overMax.ok).toBe(false);
    expect(String(overMax.error)).toMatch(/^SCHEMA:/);
  }, 20_000);

  test("pattern.search：空 query / 缺 query → SCHEMA 拒绝（zod min(1) 前置校验）", async () => {
    const { ctx } = stubContext();
    const empty = await knowledgeRegistry().call("pattern.search", { query: "" }, ctx);
    expect(empty.ok).toBe(false);
    expect(String(empty.error)).toMatch(/^SCHEMA:/);
    const missing = await knowledgeRegistry().call("pattern.search", {}, ctx);
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toMatch(/^SCHEMA:/);
  }, 20_000);

  test("pattern.search：无命中 → ok:true 空列表 + 更宽泛词建议（不是错误）", async () => {
    const { ctx } = stubContext();
    const none = expectOk(await knowledgeRegistry().call("pattern.search", { query: "zzz-no-such-pattern" }, ctx));
    expect(none.patterns).toEqual([]);
    expect(none.total).toBe(0);
    expect(String(none.hint)).toContain("hook"); // 建议里给类目词
    expect(String(none.hint)).toContain("转场");
  }, 20_000);

  test("pattern.get：已知 id → 全文（code 含 s. 调用 + 首行时长注释；notes 非空）；未知 → PATTERN_NOT_FOUND + 可用清单", async () => {
    const { ctx } = stubContext();
    const data = expectOk(await knowledgeRegistry().call("pattern.get", { id: "stagger-list" }, ctx));
    const pattern = data.pattern as Record<string, unknown>;
    expect(pattern.id).toBe("stagger-list");
    expect(pattern.name).toBe("交错列表");
    expect((pattern.tags as string[]).some((t) => t === "rhythm")).toBe(true);
    expect(String(pattern.code)).toContain("s."); // 真实 DSL 片段
    expect(String(pattern.code)).toContain("适用场景时长"); // 首行标注场景时长
    expect(String(pattern.notes).length).toBeGreaterThan(0); // 引擎陷阱必填

    const err = expectError(await knowledgeRegistry().call("pattern.get", { id: "ghost-pattern" }, ctx));
    expect(err).toContain("PATTERN_NOT_FOUND");
    expect(err).toContain("typewriter-title"); // 可用清单含首个 id
    expect(err).toContain("…"); // 超过 15 个 → 省略号
    expect(err).toContain(`共 ${MOTION_PATTERNS.length} 个`);
  }, 20_000);
});

// ---------------------------------------------------------------- skill.read

describe("skill.read 工具", () => {
  test("全文模式：tech-intro（大小写不敏感）→ frontmatter 字段 + 正文含 Workflow / Recipes / QA gates", async () => {
    const { ctx } = stubContext();
    const data = expectOk(await knowledgeRegistry().call("skill.read", { name: "tech-intro" }, ctx));
    const skill = data.skill as Record<string, unknown>;
    expect(skill.name).toBe("tech-intro");
    expect(skill.version).toBe("0.1.0");
    expect(String(skill.description)).toContain("Tech-style");
    expect(String(skill.trigger).length).toBeGreaterThan(0);
    expect(String(skill.body)).toContain("## Workflow");
    expect(String(skill.body)).toContain("## Recipes");
    expect(String(skill.body)).toContain("## QA gates");

    const upper = expectOk(await knowledgeRegistry().call("skill.read", { name: "Tech-Intro" }, ctx));
    expect((upper.skill as Record<string, unknown>).name).toBe("tech-intro"); // 大小写不敏感精确匹配
  }, 20_000);

  test("分节模式：section=recipes → 只含该节（有 s. 调用，无其他节标题）；qa 节命中「## QA gates」标题", async () => {
    const { ctx } = stubContext();
    const recipes = expectOk(await knowledgeRegistry().call("skill.read", { name: "tech-intro", section: "recipes" }, ctx));
    const body = String((recipes.skill as Record<string, unknown>).body);
    expect(body).toContain("s."); // 配方里有真实 DSL 调用
    expect(body).not.toContain("## Workflow"); // 只有该节
    expect(body).not.toContain("## Anti-patterns");

    const qa = expectOk(await knowledgeRegistry().call("skill.read", { name: "countdown", section: "qa" }, ctx));
    expect(String((qa.skill as Record<string, unknown>).body)).toContain("toContainText"); // QA gates 节内容
  }, 20_000);

  test("SECTION_EMPTY：tech-intro 的 Goal 是正文段而非 ## 标题 → goal 节取不到 → 明确错误", async () => {
    const { ctx } = stubContext();
    const err = expectError(await knowledgeRegistry().call("skill.read", { name: "tech-intro", section: "goal" }, ctx));
    expect(err).toContain("SECTION_EMPTY");
    expect(err).toContain("tech-intro");
  }, 20_000);

  test("未知技能 → SKILL_NOT_FOUND + 可用清单；坏 section 枚举值 → SCHEMA 拒绝", async () => {
    const { ctx } = stubContext();
    const err = expectError(await knowledgeRegistry().call("skill.read", { name: "ghost-skill" }, ctx));
    expect(err).toContain("SKILL_NOT_FOUND");
    expect(err).toContain("countdown"); // 可用清单（字母序前 15 内）
    expect(err).toContain("…"); // 技能库超过 15 个 → 省略号

    const bad = await knowledgeRegistry().call("skill.read", { name: "tech-intro", section: "goals" }, ctx);
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toMatch(/^SCHEMA:/);
  }, 20_000);
});

// ---------------------------------------------------------------- dsl.reference

describe("dsl.reference 工具", () => {
  test("全部 9 主题：逐键真调 → 非空 content ≤3500 + related 全为合法键", async () => {
    const { ctx } = stubContext();
    for (const key of DSL_TOPIC_KEYS) {
      const data = expectOk(await knowledgeRegistry().call("dsl.reference", { topic: key }, ctx));
      expect(data.topic).toBe(key);
      expect(String(data.content).length).toBeGreaterThan(0);
      expect(String(data.content).length).toBeLessThanOrEqual(3500);
      for (const r of data.related as string[]) expect(DSL_TOPIC_KEYS).toContain(r);
    }
  }, 20_000);

  test("effects 主题：content 覆盖 VIDEO_EFFECTS 全部效果名 + 11 个合法缓动名", async () => {
    const { ctx } = stubContext();
    const data = expectOk(await knowledgeRegistry().call("dsl.reference", { topic: "effects" }, ctx));
    const content = String(data.content);
    for (const effect of VIDEO_EFFECTS) expect(content).toContain(effect); // 每个效果名都在场
    for (const easing of ["linear", "easeOutCubic", "easeOutExpo", "easeOutBack", "spring", "bounce"]) {
      expect(content).toContain(easing);
    }
  }, 20_000);

  test("别名命中（大小写不敏感）：EASINGS → effects；fonts → text；未知 → DSL_TOPIC_NOT_FOUND + available 清单", async () => {
    const { ctx } = stubContext();
    const byAlias = expectOk(await knowledgeRegistry().call("dsl.reference", { topic: "EASINGS" }, ctx));
    expect(byAlias.topic).toBe("effects");
    const fonts = expectOk(await knowledgeRegistry().call("dsl.reference", { topic: "fonts" }, ctx));
    expect(fonts.topic).toBe("text");

    const err = expectError(await knowledgeRegistry().call("dsl.reference", { topic: "gradient" }, ctx));
    expect(err).toContain("DSL_TOPIC_NOT_FOUND");
    expect(err).toContain("available: builder, text, effects, camera, transition, timing, geometry, diagnostics, workflow");
  }, 20_000);
});

// ---------------------------------------------------------------- 编译门禁（核心）：模式片段真实编译

/** 门禁覆盖：21 条零素材零音频模式（引用资产的 ken-burns-push / qr-panel / dip-to-black 不进门禁），全部 7 类目 */
const GATE_PATTERNS: Array<{ id: string; duration: number }> = [
  { id: "typewriter-title", duration: 4 }, // hook
  { id: "big-number-impact", duration: 3 }, // hook
  { id: "logo-stamp", duration: 3 }, // hook
  { id: "stagger-list", duration: 4 }, // rhythm
  { id: "beat-pop", duration: 4 }, // rhythm
  { id: "ticker-window", duration: 4 }, // rhythm
  { id: "word-wave", duration: 4 }, // text
  { id: "rolling-counter", duration: 4 }, // text
  { id: "highlight-underline", duration: 4 }, // text
  { id: "progress-bar-grow", duration: 4 }, // data
  { id: "bar-chart-rise", duration: 5 }, // data
  { id: "delta-badge", duration: 3 }, // data
  { id: "split-screen", duration: 4 }, // visual
  { id: "vignette-pulse", duration: 4 }, // visual
  { id: "grid-features", duration: 5 }, // visual
  { id: "cut-on-beat", duration: 0 }, // transition（整程序形态，duration 自带）
  { id: "crossfade-scene", duration: 0 }, // transition
  { id: "slide-handoff", duration: 0 }, // transition
  { id: "flash-cut", duration: 0 }, // transition
  { id: "cta-end-card", duration: 4 }, // ending
  { id: "freeze-fade-out", duration: 4 }, // ending
];

describe("模式编译门禁", () => {
  test("覆盖面：≥12 条且 7 类目全覆盖（数据驱动自检）", () => {
    expect(GATE_PATTERNS.length).toBeGreaterThanOrEqual(12);
    const cats = new Set<string>();
    for (const { id } of GATE_PATTERNS) {
      const pattern = MOTION_PATTERNS.find((p) => p.id === id);
      expect(pattern).toBeDefined(); // 门禁引用的模式必须存在
      const own = pattern!.tags.filter((t) => (CATEGORIES as readonly string[]).includes(t));
      expect(own.length).toBe(1);
      cats.add(own[0]!);
    }
    expect([...cats].sort()).toEqual([...CATEGORIES].sort());
  }, 20_000);

  for (const { id, duration } of GATE_PATTERNS) {
    test(`模式 ${id} 包进最小 defineVideo → compile 零 error 诊断`, async () => {
      const pattern = MOTION_PATTERNS.find((p) => p.id === id)!;
      const session = await makeSession(`compile/${id}`, wrapPattern(pattern, duration));
      const result = await session.compile();
      // 门禁：零 error（模式库是质量基线；窗口若越界会先在 builder 期抛 DslError）
      expect(result.diagnostics.filter((d) => d.level === "error")).toEqual([]);
      expect(result.diagnostics.filter((d) => d.level === "warning")).toEqual([]);
      expect(result.vir.scenes.length).toBeGreaterThan(0);
    }, 30_000);
  }
});

// ---------------------------------------------------------------- 注册表接线

describe("knowledge 工具注册表接线", () => {
  test("四工具全部注册（命名空间序）；pattern.search 经 registry.call 真调 + 审计事件", async () => {
    const registry = knowledgeRegistry();
    expect(registry.names()).toEqual(["dsl.reference", "pattern.get", "pattern.search", "skill.read"]);
    const { ctx, events } = stubContext();
    const result = await registry.call("pattern.search", { query: "transition" }, ctx); // 类目标签命中 4 条转场模式
    const data = expectOk(result);
    expect(data.total as number).toBe(4); // 4 条转场模式
    expect((data.patterns as Array<{ id: string }>).map((p) => p.id)).toContain("crossfade-scene");
    expect(events.length).toBeGreaterThanOrEqual(2); // tool-call + tool-result
    expect(events[0]!.kind).toBe("tool-call");
    expect(events[0]!.tool).toBe("pattern.search");
    expect(events.at(-1)!.kind).toBe("tool-result");
  }, 20_000);

  test("skill.read 经 registry.call 真调；schema 前置校验对空 query 同样生效", async () => {
    const registry = knowledgeRegistry();
    const { ctx } = stubContext();
    const result = await registry.call("skill.read", { name: "countdown", section: "workflow" }, ctx);
    const skill = expectOk(result).skill as Record<string, unknown>;
    expect(skill.name).toBe("countdown");
    expect(String(skill.body)).toContain("storyboard.plan"); // Workflow 节内容
    expect(String(skill.body)).not.toContain("## Recipes"); // 只取了 workflow 节

    const bad = await registry.call("pattern.search", { query: "" }, ctx);
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toMatch(/^SCHEMA:/);
  }, 20_000);
});
