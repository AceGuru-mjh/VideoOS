// Template 子系统测试（任务 11-a）：
// - 单元：loadTemplates 恰好 8 个 + manifest 全字段合法；坏模板目录跳过不炸（loadTemplatesFromDir）
// - 工具：template.list 过滤 / template.inspect 全文与未知名 / template.apply 覆盖入口 + 真编译
// - 核心质量门禁：8 个模板逐个复制进临时项目（repo 子树内 → @videoos/dsl 可解析，模式同 orchestrator.test.ts）
//   → createVapContext → compile() → 零 error 级诊断
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  asVapSession,
  createTestWorkspace,
  createVapContext,
  VapToolRegistry,
  type VapContext,
  type VapSession,
  type VapToolResult,
} from "@videoos/agent";
import {
  builtinTemplatesDir,
  createTemplateTools,
  loadTemplates,
  loadTemplatesFromDir,
  type TemplateRecord,
} from "./templates";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", ".."); // 仓库根（本文件位于 packages/server/src/chat/）
const BUILTIN = builtinTemplatesDir();
const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-demo", `templates-test-${process.pid}`);
/** 全部 8 个内置模板（字母序 = loadTemplates 输出序） */
const EXPECTED = [
  "comparison", "countdown", "data-dashboard", "kinetic-typography",
  "logo-reveal", "product-intro", "quote-card", "tech-intro",
];

// ---------------------------------------------------------------- 助手

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

/** 在 FIXTURE_ROOT 下建临时项目；seed = 预置 entry 源码（缺省无） */
async function makeSession(projectName: string, seed?: string): Promise<VapSession> {
  const root = join(FIXTURE_ROOT, projectName);
  mkdirSync(join(root, "src"), { recursive: true });
  if (seed !== undefined) writeFileSync(join(root, "src", "video.ts"), seed, "utf8");
  const workspace = await createTestWorkspace(root);
  const ctx = await createVapContext({ workspace, entryPath: join(root, "src", "video.ts") });
  return asVapSession(ctx);
}

/** 注册了模板三工具的注册表 */
function templateRegistry(): VapToolRegistry {
  const registry = new VapToolRegistry();
  for (const tool of createTemplateTools()) registry.register(tool);
  return registry;
}

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 单元：加载与校验

describe("templates 加载单元", () => {
  test("builtinTemplatesDir 指向仓库根 templates/", () => {
    expect(BUILTIN).toBe(join(REPO_ROOT, "templates"));
  }, 20_000);

  test("loadTemplates：恰好 8 个 + manifest 全字段合法 + 源码/工程文件在场", async () => {
    const templates = await loadTemplates();
    expect(templates.map((t) => t.manifest.name)).toEqual(EXPECTED);
    for (const t of templates) {
      const m = t.manifest;
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.description.length).toBeLessThanOrEqual(120);
      expect(m.tags.length).toBeGreaterThan(0);
      for (const tag of m.tags) {
        expect(tag).toBe(tag.toLowerCase());
        expect(tag).toMatch(/^[a-z0-9][a-z0-9 -]*$/);
      }
      expect(m.durationSeconds).toBeGreaterThan(0);
      expect(["16:9", "1:1", "9:16"]).toContain(m.aspect);
      expect(m.useCases.length).toBeGreaterThanOrEqual(2);
      expect(t.source).toContain("defineVideo");
      expect(t.dir).toContain(BUILTIN);
      expect((t.projectJson as { entry?: string }).entry).toBe("src/video.ts");
    }
    // 形状抽样：1:1 只有金句卡；30s 长片只有产品介绍
    expect(templates.find((t) => t.manifest.name === "quote-card")?.manifest.aspect).toBe("1:1");
    expect(templates.find((t) => t.manifest.name === "product-intro")?.manifest.durationSeconds).toBe(30);
  }, 20_000);

  test("loadTemplatesFromDir：坏模板跳过 + warn，好模板独存；缺失目录静默空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vos-templates-"));
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warns.push(String(msg));
    try {
      const write = (name: string, file: string, content: string): void => {
        mkdirSync(join(dir, name, ...file.split("/").slice(0, -1)), { recursive: true });
        writeFileSync(join(dir, name, file), content, "utf8");
      };
      // 好模板（最小合法形状）
      write("good", "template.json", JSON.stringify({
        name: "good", title: "好模板", description: "最小合法模板", tags: ["demo"],
        durationSeconds: 3, aspect: "16:9", useCases: ["测试一", "测试二"],
      }));
      write("good", "video.project.json", JSON.stringify({ name: "good", entry: "src/video.ts" }));
      write("good", "src/video.ts", "export default null; // 源码存在即可（本用例不编译）");
      // 坏模板 ×4：清单坏 JSON / tags 缺失 / 源码缺失 / name 与目录名不符
      write("bad-json", "template.json", "{ not json");
      write("bad-shape", "template.json", JSON.stringify({ name: "bad-shape", title: "x", description: "y", durationSeconds: 1, aspect: "16:9", useCases: ["a", "b"] }));
      write("no-src", "template.json", JSON.stringify({ name: "no-src", title: "x", description: "y", tags: ["t"], durationSeconds: 1, aspect: "16:9", useCases: ["a", "b"] }));
      write("name-mismatch", "template.json", JSON.stringify({ name: "other-name", title: "x", description: "y", tags: ["t"], durationSeconds: 1, aspect: "16:9", useCases: ["a", "b"] }));
      // 隐藏目录（.开头）不参与加载
      write(".hidden", "template.json", "{}");

      const loaded = await loadTemplatesFromDir(dir);
      expect(loaded.map((t: TemplateRecord) => t.manifest.name)).toEqual(["good"]);
      expect(warns.length).toBeGreaterThanOrEqual(4); // 四类坏模板各 warn 一次，绝不抛错
      expect(warns.every((w) => w.includes("[videoos/server] template skipped"))).toBe(true);

      // 目录缺失 → 静默空数组
      expect(await loadTemplatesFromDir(join(dir, "does-not-exist"))).toEqual([]);
    } finally {
      console.warn = originalWarn;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

// ---------------------------------------------------------------- 核心质量门禁：8 模板真实编译

describe("templates 全量编译门禁", () => {
  for (const name of EXPECTED) {
    test(`模板 ${name} 复制进临时项目 → compile 零 error 诊断`, async () => {
      const templates = await loadTemplates();
      const record = templates.find((t) => t.manifest.name === name);
      expect(record).toBeDefined();
      // 模板目录整体拷入临时项目（video.project.json + src/；repo 子树内 → @videoos/dsl 可解析）
      const root = join(FIXTURE_ROOT, "compile", name);
      cpSync(record!.dir, root, { recursive: true });
      const session = await makeSession(`compile/${name}`, record!.source);
      const result = await session.compile();
      // 门禁：零 error（warning 也要求为零——模板是质量基线，不是宽容区）
      expect(result.diagnostics.filter((d) => d.level === "error")).toEqual([]);
      expect(result.diagnostics.filter((d) => d.level === "warning")).toEqual([]);
      expect(result.vir.scenes.length).toBeGreaterThan(0);
      // manifest 的 durationSeconds 与真实编译时长一致（±0.05s 容差）
      expect(Math.abs(result.vir.meta.duration - record!.manifest.durationSeconds)).toBeLessThanOrEqual(0.05);
      // 编译产物落盘
      expect(existsSync(session.virPath)).toBe(true);
    }, 30_000);
  }
});

// ---------------------------------------------------------------- 工具：list / inspect / apply

describe("template 工具", () => {
  let ctx: VapContext;
  let registry: VapToolRegistry;
  let entryPath: string;

  beforeAll(async () => {
    // 种子项目：以 tech-intro 源码作为初始 entry（apply 用例验证覆盖语义）
    const seeded = await loadTemplates().then((ts) => ts.find((t) => t.manifest.name === "tech-intro")!.source);
    const session = await makeSession("apply-demo", seeded);
    ctx = session as unknown as VapContext;
    entryPath = session.entryPath;
    registry = templateRegistry();
  }, 30_000);

  test("template.list：无 query → 8 个；中文/英文关键词命中；无命中 → 空", async () => {
    const all = expectOk(await registry.call("template.list", {}, ctx));
    expect(all.matched).toBe(8);
    expect((all.templates as Array<{ name: string }>).map((t) => t.name)).toEqual(EXPECTED);
    expect(typeof all.hint).toBe("string");
    expect(String(all.hint)).toContain("template.inspect");

    const zh = expectOk(await registry.call("template.list", { query: "倒计时" }, ctx));
    expect((zh.templates as Array<{ name: string }>).map((t) => t.name)).toEqual(["countdown"]);

    const en = expectOk(await registry.call("template.list", { query: "typography" }, ctx));
    expect((en.templates as Array<{ name: string }>).map((t) => t.name)).toEqual(["kinetic-typography"]);

    const none = expectOk(await registry.call("template.list", { query: "zzz" }, ctx));
    expect(none.matched).toBe(0);
    expect(none.templates).toEqual([]);
  }, 20_000);

  test("template.list：标签命中（tag 是检索字段之一）", async () => {
    const byTag = expectOk(await registry.call("template.list", { query: "count-up" }, ctx));
    const names = (byTag.templates as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("data-dashboard"); // data-dashboard 标签含 count-up
  }, 20_000);

  test("template.inspect：已知 → manifest + projectJson + 全文源码；未知 → TEMPLATE_NOT_FOUND + 可用清单", async () => {
    const data = expectOk(await registry.call("template.inspect", { name: "quote-card" }, ctx));
    const manifest = data.manifest as { name: string; aspect: string };
    expect(manifest.name).toBe("quote-card");
    expect(manifest.aspect).toBe("1:1");
    expect(String(data.source)).toContain("defineVideo");
    expect(String(data.source)).toContain("1080");
    expect((data.projectJson as { entry: string }).entry).toBe("src/video.ts");

    const err = expectError(await registry.call("template.inspect", { name: "ghost" }, ctx));
    expect(err).toContain("TEMPLATE_NOT_FOUND");
    expect(err).toContain("countdown");
    expect(err).toContain("tech-intro");
  }, 20_000);

  test("template.apply：写入当前入口 + 真编译（entry 内容 === 模板源码；诊断/场景/时长在场）", async () => {
    const data = expectOk(await registry.call("template.apply", { name: "countdown" }, ctx));
    const applied = readFileSync(entryPath, "utf8");
    const template = await loadTemplates().then((ts) => ts.find((t) => t.manifest.name === "countdown")!);
    expect(applied).toBe(template.source); // 覆盖写入（原 tech-intro 源码已被替换）
    expect(data.entryPath).toBe(entryPath);
    expect((data.template as { name: string }).name).toBe("countdown");
    expect(Array.isArray(data.diagnostics)).toBe(true); // 编译确实发生
    expect(data.scenes).toBe(2); // tick + lockup
    expect(data.durationSeconds).toBe(5); // 与 manifest 一致
    expect(existsSync(join(join(entryPath, "..", ".."), ".video", "vir.json"))).toBe(true);
  }, 30_000);

  test("template.apply：显式 entryPath 写旁路文件，不动当前入口", async () => {
    const before = readFileSync(entryPath, "utf8");
    const data = expectOk(await registry.call("template.apply", { name: "logo-reveal", entryPath: "src/alt.ts" }, ctx));
    const root = join(entryPath, "..", "..");
    expect(readFileSync(join(root, "src", "alt.ts"), "utf8")).toContain("logo");
    // logo-reveal 模板源码全文落盘 + 旁路编译成功（单场景 5s）
    const template = await loadTemplates().then((ts) => ts.find((t) => t.manifest.name === "logo-reveal")!);
    expect(readFileSync(join(root, "src", "alt.ts"), "utf8")).toBe(template.source);
    expect(readFileSync(entryPath, "utf8")).toBe(before); // 当前入口未被触碰
    expect(data.scenes).toBe(1);
    expect(data.durationSeconds).toBe(5);
    expect(String(data.entryPath)).toBe(join(root, "src", "alt.ts"));
  }, 30_000);

  test("template.apply：未知模板 → TEMPLATE_NOT_FOUND（不写任何文件）", async () => {
    const before = readFileSync(entryPath, "utf8");
    const err = expectError(await registry.call("template.apply", { name: "ghost" }, ctx));
    expect(err).toContain("TEMPLATE_NOT_FOUND");
    expect(readFileSync(entryPath, "utf8")).toBe(before);
  }, 20_000);
});
