// plugin-kit 宿主测试：manifest 校验 / discover+start+listTools / callTool 错误隔离 /
// 权限门禁 / 事件总线 / 内置 8 插件全家桶 / stop 逆序 deactivate + 幂等。
// 夹具策略：mkdtemp 临时目录动态写入 plugin.json + index.ts，宿主动态 import 真 TS 入口（无 mock）。
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPluginHost,
  loadManifest,
  PluginHost,
  type PluginLogEvent,
  type PluginToolResult,
} from "./index";

const REPO_PLUGINS = join(import.meta.dir, "..", "..", "..", "plugins");

/** 断言失败结果并返回 error（TS 判别联合收窄辅助） */
function errorOf(result: PluginToolResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failed result");
  return result.error;
}

/** 断言成功结果并返回 data（收窄辅助） */
function dataOf<T>(result: PluginToolResult): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a successful result");
  return result.data as T;
}

// ---------------------------------------------------------------- 夹具构造

interface ManifestInput {
  id: string;
  permissions: string[];
  tools?: string[];
  hooks?: string[];
}

function manifestJson(input: ManifestInput): string {
  return JSON.stringify(
    {
      id: input.id,
      name: input.id,
      version: "0.1.0",
      description: `test fixture plugin ${input.id}`,
      apiVersion: "0.1",
      permissions: input.permissions,
      provides: {
        ...(input.tools !== undefined ? { tools: input.tools } : {}),
        ...(input.hooks !== undefined ? { hooks: input.hooks } : {}),
      },
      entry: "index.ts",
    },
    null,
    2,
  );
}

function writePlugin(root: string, input: ManifestInput, code: string): string {
  const dir = join(root, input.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), manifestJson(input));
  writeFileSync(join(dir, "index.ts"), code);
  return dir;
}

function writeRawManifest(dir: string, json: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(json, null, 2));
  return dir;
}

/** 基准夹具：echo 工具 + seen 工具（记录收到的事件）+ 订阅 kick/plugin.loaded/host.started */
const HELPER_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

const seen: Array<{ event: string; payload: unknown }> = [];

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "helper.echo",
    description: "echo the payload back",
    schema: ctx.z.object({ payload: ctx.z.string() }),
    run: ({ payload }) => ({ ok: true, data: { echo: payload } }),
  });
  ctx.registerTool({
    name: "helper.seen",
    description: "events this plugin recorded",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: { seen } }),
  });
  for (const event of ["helper.kick", "plugin.loaded", "host.started"]) {
    ctx.on(event, (payload) => {
      seen.push({ event, payload: payload ?? null });
    });
  }
}
`;

const BOMB_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "bomb.explode",
    description: "always throws",
    schema: ctx.z.object({}),
    run: () => {
      throw new Error("boom: intentional test failure");
    },
  });
}
`;

const SLEEPER_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "sleeper.mark",
    description: "never loaded (disabled)",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: { plugin: "sleeper" } }),
  });
}
`;

/** 无 tools 权限却调 registerTool → activate 抛错 → skipped */
const NO_TOOLS_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "no-tools.sneaky",
    description: "registered without permission",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: {} }),
  });
}
`;

/** 有 tools 权限、注册成功后误用 ctx.on（无 events 权限）→ skipped 且 staged 工具不得入库 */
const NO_EVENTS_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "no-events.echo",
    description: "registers fine, then misuses ctx.on",
    schema: ctx.z.object({ payload: ctx.z.string() }),
    run: ({ payload }) => ({ ok: true, data: { echo: payload } }),
  });
  ctx.on("some.event", () => {});
}
`;

/** registerTool 用了别人的前缀 → E_NAME 拒绝 */
const BAD_PREFIX_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "other.tool",
    description: "foreign prefix",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: {} }),
  });
}
`;

/** 模块顶层抛错 → 动态 import 拒绝 → skipped */
const BROKEN_CODE = `
throw new Error("module blew up at import time");
`;

/** 事件总线夹具：ping 三个订阅者（第 2 个抛错）+ pong 回环 */
const BUS_CODE = `
import type { PluginContext } from "@videoos/plugin-kit";

const seen: Array<{ event: string; payload: unknown }> = [];

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "bus.seen",
    description: "events recorded by the bus fixture",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: { seen } }),
  });
  ctx.on("bus.ping", (payload) => {
    seen.push({ event: "bus.ping-first", payload: payload ?? null });
  });
  ctx.on("bus.ping", () => {
    throw new Error("bus handler exploded (intentional)");
  });
  ctx.on("bus.ping", async (payload) => {
    await ctx.emit("bus.pong", { back: payload ?? null });
  });
  ctx.on("bus.pong", (payload) => {
    seen.push({ event: "bus.pong", payload: payload ?? null });
  });
}
`;

/** deactivate 逆序见证夹具：停止时把自己的 id 追加进共享日志文件 */
function stoppableCode(id: string, logPath: string): string {
  return `
import { appendFileSync } from "node:fs";
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "${id}.mark",
    description: "marker tool",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: { plugin: "${id}" } }),
  });
}

export function deactivate(): void {
  appendFileSync(${JSON.stringify(logPath)}, "${id}");
}
`;
}

const HELPER_MANIFEST: ManifestInput = {
  id: "helper",
  permissions: ["tools", "events"],
  tools: ["helper.echo", "helper.seen"],
  hooks: ["helper.kick", "plugin.loaded", "host.started"],
};

// ---------------------------------------------------------------- manifest 校验

describe("plugin-kit manifest validation", () => {
  it("loads a valid manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const dir = writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    const result = loadManifest(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("helper");
      expect(result.manifest.version).toBe("0.1.0");
      expect(result.manifest.apiVersion).toBe("0.1");
      expect(result.manifest.permissions).toEqual(["tools", "events"]);
      expect(result.manifest.provides.tools).toEqual(["helper.echo", "helper.seen"]);
      expect(result.manifest.provides.hooks).toEqual(["helper.kick", "plugin.loaded", "host.started"]);
      expect(result.manifest.entry).toBe("index.ts");
    }
  }, 20_000);

  it("rejects unknown fields with a path (top level and nested)", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const base = JSON.parse(manifestJson(HELPER_MANIFEST)) as Record<string, unknown>;

    const topLevel = writeRawManifest(join(root, "helper"), { ...base, oops: true });
    const topLevelResult = loadManifest(topLevel);
    expect(topLevelResult.ok).toBe(false);
    if (!topLevelResult.ok) {
      expect(topLevelResult.error).toContain("oops");
    }

    const nested = writeRawManifest(join(root, "helper"), {
      ...base,
      provides: { tools: ["helper.echo"], extra: 1 },
    });
    const nestedResult = loadManifest(nested);
    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) {
      expect(nestedResult.error).toContain("provides");
      expect(nestedResult.error).toContain("extra");
    }
  }, 20_000);

  it("rejects permissions outside the whitelist", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const dir = writePlugin(
      root,
      { id: "helper", permissions: ["tools", "fs:execute"] },
      HELPER_CODE,
    );
    const result = loadManifest(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("permissions");
      expect(result.error).toContain("fs:execute");
    }
  }, 20_000);

  it("rejects a tool name without the plugin id prefix", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const dir = writePlugin(
      root,
      { id: "helper", permissions: ["tools"], tools: ["other.thing"] },
      HELPER_CODE,
    );
    const result = loadManifest(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("provides.tools");
      expect(result.error).toContain("helper.<name>");
    }
  }, 20_000);

  it("rejects id/directory mismatch and malformed version/apiVersion", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const base = JSON.parse(manifestJson(HELPER_MANIFEST)) as Record<string, unknown>;

    const mismatch = writeRawManifest(join(root, "helper"), { ...base, id: "mismatch" });
    const mismatchResult = loadManifest(mismatch);
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) {
      expect(mismatchResult.error).toContain("must equal the directory name");
      expect(mismatchResult.error).toContain("helper");
    }

    const malformed = writeRawManifest(join(root, "helper"), { ...base, version: "1.0", apiVersion: "0.2" });
    const malformedResult = loadManifest(malformed);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.error).toContain("version");
      expect(malformedResult.error).toContain("apiVersion");
    }
  }, 20_000);
});

// ---------------------------------------------------------------- discover / start / listTools

describe("plugin-kit discover + start + listTools", () => {
  it("discovers valid plugins and reports skipped candidates with reasons", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    mkdirSync(join(root, "no-manifest")); // 有目录无 plugin.json
    mkdirSync(join(root, ".hidden")); // 隐藏目录（内含合法 manifest 也不扫描）
    writeFileSync(join(root, ".hidden", "plugin.json"), manifestJson({ id: "hidden", permissions: ["tools"] }));

    const duplicateRoot = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(duplicateRoot, HELPER_MANIFEST, HELPER_CODE); // 跨 root 重复 id

    const host = new PluginHost({ roots: [root, duplicateRoot] });
    const { plugins, skipped } = host.discover();
    expect(plugins.map((p) => p.manifest.id)).toEqual(["helper"]);
    const reasons = skipped.map((s) => `${s.dir}|${s.reason}`);
    expect(reasons.some((r) => r.includes("no-manifest") && r.includes("plugin.json"))).toBe(true);
    expect(reasons.some((r) => r.includes(".hidden") && r.includes("ignored directory"))).toBe(true);
    expect(reasons.some((r) => r.includes("duplicate plugin id"))).toBe(true);
  }, 20_000);

  it("starts plugins, lists tools with JSON Schema parameters, and calls them", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    writePlugin(root, { id: "sleeper", permissions: ["tools"], tools: ["sleeper.mark"] }, SLEEPER_CODE);

    const logs: PluginLogEvent[] = [];
    const host = new PluginHost({ roots: [root], disabled: ["sleeper"], onLog: (event) => logs.push(event) });
    const { started, skipped } = await host.start();
    expect(started).toEqual(["helper"]);
    expect(skipped.some((s) => s.reason.includes("disabled"))).toBe(true);

    const tools = host.listTools();
    expect(tools.map((t) => t.name)).toEqual(["helper.echo", "helper.seen"]);
    expect(tools[0].plugin).toBe("helper");
    expect(tools[0].parameters).toEqual({
      type: "object",
      properties: { payload: { type: "string" } },
      required: ["payload"],
    });

    const echo = await host.callTool("helper.echo", { payload: "hi" });
    expect(echo).toEqual({ ok: true, data: { echo: "hi" } });

    const invalidArgs = await host.callTool("helper.echo", {});
    expect(errorOf(invalidArgs)).toContain("E_ARGS");

    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      expect(typeof entry.at).toBe("string");
      expect(["info", "warn", "error"]).toContain(entry.level);
      expect(typeof entry.message).toBe("string");
    }
    expect(logs.some((l) => l.plugin === "helper" && l.level === "info")).toBe(true);

    await host.stop();
  }, 20_000);

  it("start() is guarded against double starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    const host = new PluginHost({ roots: [root] });
    const first = await host.start();
    expect(first.started).toEqual(["helper"]);
    const second = await host.start();
    expect(second.started).toEqual([]);
    expect(host.isRunning).toBe(true);
    await host.stop();
  }, 20_000);

  it("emits plugin.loaded per plugin and host.started after start", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    const host = createPluginHost({ roots: [root] });
    await host.start();
    const result = await host.callTool("helper.seen", {});
    const events = dataOf<{ seen: Array<{ event: string; payload: unknown }> }>(result).seen;
    expect(events).toContainEqual({ event: "plugin.loaded", payload: { id: "helper" } });
    expect(events).toContainEqual({ event: "host.started", payload: {} });
    await host.stop();
  }, 20_000);
});

// ---------------------------------------------------------------- callTool 错误隔离

describe("plugin-kit callTool error isolation", () => {
  it("converts a throwing runner into PLUGIN_ERROR without hurting the host or other plugins", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, HELPER_MANIFEST, HELPER_CODE);
    writePlugin(root, { id: "bomb", permissions: ["tools"], tools: ["bomb.explode"] }, BOMB_CODE);

    const host = new PluginHost({ roots: [root] });
    const { started } = await host.start();
    expect(started.sort()).toEqual(["bomb", "helper"]);

    const exploded = await host.callTool("bomb.explode", {});
    const explodedError = errorOf(exploded);
    expect(explodedError).toContain("PLUGIN_ERROR");
    expect(explodedError).toContain("boom");

    const echo = await host.callTool("helper.echo", { payload: "still alive" });
    expect(echo).toEqual({ ok: true, data: { echo: "still alive" } });
    expect(host.listTools().length).toBe(3);

    const missing = await host.callTool("nope.nope", {});
    expect(errorOf(missing)).toContain("TOOL_NOT_FOUND");
    await host.stop();
  }, 20_000);
});

// ---------------------------------------------------------------- 权限门禁

describe("plugin-kit permission gates", () => {
  it("rejects registerTool without the tools permission (plugin skipped)", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, { id: "no-tools", permissions: ["events"], hooks: ["plugin.loaded"] }, NO_TOOLS_CODE);
    const host = new PluginHost({ roots: [root] });
    const { started, skipped } = await host.start();
    expect(started).toEqual([]);
    expect(skipped.some((s) => s.reason.includes("E_PERMISSION") && s.reason.includes("tools"))).toBe(true);
    expect(host.listTools()).toEqual([]);
    await host.stop();
  }, 20_000);

  it("rejects ctx.on without the events permission and discards staged tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, { id: "no-events", permissions: ["tools"], tools: ["no-events.echo"] }, NO_EVENTS_CODE);
    const host = new PluginHost({ roots: [root] });
    const { started, skipped } = await host.start();
    expect(started).toEqual([]);
    expect(skipped.some((s) => s.reason.includes("E_PERMISSION"))).toBe(true);
    // registerTool 在 ctx.on 抛错之前已执行 → staging 必须整体丢弃
    expect(host.listTools().map((t) => t.name)).toEqual([]);
    await host.stop();
  }, 20_000);

  it("rejects registerTool with a foreign name prefix", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, { id: "bad-prefix", permissions: ["tools"] }, BAD_PREFIX_CODE);
    const host = new PluginHost({ roots: [root] });
    const { started, skipped } = await host.start();
    expect(started).toEqual([]);
    expect(skipped.some((s) => s.reason.includes("E_NAME") && s.reason.includes("bad-prefix."))).toBe(true);
    await host.stop();
  }, 20_000);

  it("skips plugins whose module fails at import time", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(root, { id: "broken", permissions: ["tools"] }, BROKEN_CODE);
    const host = new PluginHost({ roots: [root] });
    const { started, skipped } = await host.start();
    expect(started).toEqual([]);
    expect(skipped.some((s) => s.reason.includes("activate failed") && s.reason.includes("module blew up"))).toBe(true);
    await host.stop();
  }, 20_000);
});

// ---------------------------------------------------------------- 事件总线

describe("plugin-kit event bus", () => {
  it("delivers events to all subscribers and isolates throwing handlers", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    writePlugin(
      root,
      { id: "bus", permissions: ["tools", "events"], tools: ["bus.seen"], hooks: ["bus.ping", "bus.pong"] },
      BUS_CODE,
    );
    const logs: PluginLogEvent[] = [];
    const host = new PluginHost({ roots: [root] });
    host.on("log", (event) => logs.push(event));
    await host.start();

    await host.emit("bus.ping", { n: 1 });

    const result = await host.callTool("bus.seen", {});
    const events = dataOf<{ seen: Array<{ event: string; payload: unknown }> }>(result).seen;
    // 第 1 个订阅者收到载荷；第 2 个抛错后第 3 个仍执行（其 emit 触发 pong 回环）
    expect(events).toContainEqual({ event: "bus.ping-first", payload: { n: 1 } });
    expect(events).toContainEqual({ event: "bus.pong", payload: { back: { n: 1 } } });
    // 抛错的 handler 被宿主记为 error 日志
    expect(logs.some((l) => l.level === "error" && l.message.includes("bus handler exploded"))).toBe(true);
    expect(logs.some((l) => l.plugin === "bus")).toBe(true);
    await host.stop();
  }, 20_000);
});

// ---------------------------------------------------------------- 内置 8 插件全家桶

describe("plugin-kit built-in plugins", () => {
  it("starts all 8 built-ins and exposes >= 20 tools", async () => {
    const host = new PluginHost({ roots: [REPO_PLUGINS] });
    const { started, skipped } = await host.start();
    expect(started).toEqual([
      "asset-watcher",
      "brand-guard",
      "localization",
      "palette-forge",
      "render-guard",
      "starter",
      "subtitle-sync",
      "timing-audit",
    ]);
    expect(skipped).toEqual([]);
    const names = host.listTools().map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(20);
    const specTools = [
      "starter.hello",
      "brand-guard.brand.tokens",
      "brand-guard.brand.lint",
      "palette-forge.palette.fromSeed",
      "palette-forge.palette.contrast",
      "timing-audit.timing.report",
      "timing-audit.timing.estimate",
      "subtitle-sync.subtitle.fromBeats",
      "subtitle-sync.subtitle.cps",
      "asset-watcher.asset.scan",
      "asset-watcher.asset.summary",
      "render-guard.guard.checklist",
      "localization.i18n.extract",
      "localization.i18n.report",
    ];
    for (const name of specTools) {
      expect(names).toContain(name);
    }
    // 每个工具的 parameters 都是可序列化的 JSON Schema
    for (const tool of host.listTools()) {
      expect(() => JSON.stringify(tool.parameters)).not.toThrow();
      expect((tool.parameters as { type?: string }).type).toBe("object");
    }
    await host.stop();
  }, 20_000);

  it("brand.lint flags off-palette hex colors with file/line", async () => {
    const host = new PluginHost({ roots: [REPO_PLUGINS] });
    await host.start();
    const dir = mkdtempSync(join(tmpdir(), "plugin-kit-lint-"));
    writeFileSync(
      join(dir, "theme.ts"),
      [
        "// palette demo",
        'const onBrand = "#22d3ee";',
        'const off = "#ff0055";',
        'const upperCase = "#22D3EE";',
      ].join("\n"),
    );
    const result = await host.callTool("brand-guard.brand.lint", { path: dir });
    const data = dataOf<{ violations: Array<{ file: string; line: number; color: string }> }>(result);
    expect(data.violations).toEqual([{ file: join(dir, "theme.ts"), line: 3, color: "#ff0055" }]);

    const missing = await host.callTool("brand-guard.brand.lint", { path: join(dir, "nope.ts") });
    expect(errorOf(missing)).toContain("E_NOT_FOUND");
    await host.stop();
  }, 20_000);

  it("timing.report extracts scenes, durations, and beats from a video entry", async () => {
    const host = new PluginHost({ roots: [REPO_PLUGINS] });
    await host.start();
    const dir = mkdtempSync(join(tmpdir(), "plugin-kit-timing-"));
    const file = join(dir, "video.ts");
    writeFileSync(
      file,
      [
        'v.scene("intro", { duration: 2.5 }, (s) => {',
        '  s.beat("open", { at: 0 });',
        '  s.beat("land", { at: 1 });',
        "});",
        'v.scene("outro", { duration: 3 }, (s) => {',
        '  s.beat("close", { at: 0.5 });',
        "});",
      ].join("\n"),
    );
    const result = await host.callTool("timing-audit.timing.report", { path: file });
    const data = dataOf<{ scenes: Array<{ name: string; duration: number; beats: string[] }>; totalDuration: number }>(result);
    expect(data.scenes).toEqual([
      { name: "intro", duration: 2.5, beats: ["open", "land"] },
      { name: "outro", duration: 3, beats: ["close"] },
    ]);
    expect(data.totalDuration).toBe(5.5);
    await host.stop();
  }, 20_000);

  it("smoke-checks starter/palette/subtitle tools (defaults, WCAG, SRT)", async () => {
    const host = new PluginHost({ roots: [REPO_PLUGINS] });
    await host.start();

    const hello = await host.callTool("starter.hello", {});
    expect(hello).toEqual({ ok: true, data: { greeting: "Hello, world!", plugin: "starter", apiVersion: "0.1" } });

    const contrast = await host.callTool("palette-forge.palette.contrast", {
      foreground: "#000000",
      background: "#ffffff",
    });
    const contrastData = dataOf<{ ratio: number; aa: boolean; aaa: boolean }>(contrast);
    expect(contrastData.ratio).toBe(21);
    expect(contrastData.aa).toBe(true);
    expect(contrastData.aaa).toBe(true);

    const srt = await host.callTool("subtitle-sync.subtitle.fromBeats", {
      beats: [{ name: "open", atSeconds: 1, text: "Hello subtitles" }],
    });
    const srtData = dataOf<{ srt: string; cues: number }>(srt);
    expect(srtData.cues).toBe(1);
    expect(srtData.srt).toContain("00:00:01,000 --> 00:00:03,200");
    expect(srtData.srt).toContain("Hello subtitles");

    const fromSeed = await host.callTool("palette-forge.palette.fromSeed", { base: "#22d3ee" });
    const seedData = dataOf<{ colors: Array<{ role: string; hex: string }>; dsl: string }>(fromSeed);
    expect(seedData.colors.length).toBe(5);
    expect(seedData.colors[0]).toEqual({ role: "primary", hex: "#22d3ee" });
    expect(seedData.dsl).toContain('const BRAND = {');
    expect(seedData.dsl).toContain('primary: "#22d3ee",');
    await host.stop();
  }, 20_000);
});

// ---------------------------------------------------------------- stop

describe("plugin-kit stop", () => {
  it("deactivates in reverse start order, is idempotent, and clears the registry", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-kit-"));
    const logPath = join(root, "deactivate.log");
    writePlugin(root, { id: "alpha", permissions: ["tools"], tools: ["alpha.mark"] }, stoppableCode("alpha", logPath));
    writePlugin(root, { id: "beta", permissions: ["tools"], tools: ["beta.mark"] }, stoppableCode("beta", logPath));

    const host = new PluginHost({ roots: [root] });
    await host.start();
    expect(host.listTools().length).toBe(2);

    await host.stop();
    expect(readFileSync(logPath, "utf8")).toBe("betaalpha"); // 逆序：beta 先于 alpha

    await host.stop(); // 幂等：deactivate 不再触发
    expect(readFileSync(logPath, "utf8")).toBe("betaalpha");

    expect(host.listTools()).toEqual([]);
    expect(host.isRunning).toBe(false);
    const after = await host.callTool("alpha.mark", {});
    expect(errorOf(after)).toContain("TOOL_NOT_FOUND");
    await host.emit("any.event", {}); // 停机后 emit 仍是安全 no-op
  }, 20_000);
});
