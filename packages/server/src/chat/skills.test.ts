// Skills 子系统测试（issue #52）：
// - 单元：frontmatter 解析 / 节提取 / loadSkills（5 个真实 SKILL.md + customDir + 坏文件跳过）
// - 单元：composeSkillSection（@引用 / 未知引用注记 / autoTrigger / 停用与花名册）
// - E2E（真实端口）：GET /api/skills / PATCH 启停 / PATCH 设置 / 404 / 400 / 系统提示注入（OpenAI 桩捕获）
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { startStudioServer, type StudioServerHandle } from "../index";
import {
  composeSkillSection,
  extractSection,
  loadSkills,
  parseSkillFrontmatter,
  type SkillRecord,
} from "./skills";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", ".."); // 仓库根（本文件位于 packages/server/src/chat/）

// ---------------------------------------------------------------- 单元：解析

describe("skills 解析单元", () => {
  test("parseSkillFrontmatter：字段/引号剥除/正文切分；无 frontmatter 或未闭合 → null", () => {
    const text = [
      "---",
      'name: "demo-skill"',
      "version: 1.2.3",
      "description: A demo skill",
      "trigger: user says \"demo\"",
      "---",
      "",
      "# Demo",
      "",
      "## Workflow",
      "1. compile.run",
    ].join("\n");
    const parsed = parseSkillFrontmatter(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.front).toEqual({ name: "demo-skill", version: "1.2.3", description: "A demo skill", trigger: 'user says "demo"' });
    expect(parsed?.body).toContain("# Demo");
    expect(parsed?.body).not.toContain("---");

    expect(parseSkillFrontmatter("# no frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\nname: x\nno closing")).toBeNull();
  });

  test("extractSection：按 heading 文本取节（到下一个 ## 为止）；未知节 → 空串", () => {
    const body = ["# Title", "", "## Workflow", "step one", "step two", "", "## Recipes", "```ts", "```", "", "## Anti-patterns", "don't"].join("\n");
    expect(extractSection(body, "workflow")).toBe("step one\nstep two");
    expect(extractSection(body, "anti-patterns")).toBe("don't");
    expect(extractSection(body, "missing")).toBe("");
  });

  test("loadSkills：已知内置技能全被发现（排序 / version / trigger / body）——数量无关（Agent Kit 并行扩充技能库）", async () => {
    const skills = await loadSkills(null);
    // 状态无关断言：主线自带 5 技能必须存在；并行项目（Agent Kit）追加的技能不视为失败
    const names = skills.map((s) => s.name);
    for (const known of ["cinematic-video", "data-motion", "product-demo", "short-video", "visual-qa"]) {
      expect(names).toContain(known);
    }
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const baseline = skills.find((s) => s.name === "product-demo");
    expect(baseline?.version).toBe("0.1.0");
    expect(baseline?.source).toBe("builtin");
    for (const skill of skills) {
      // 形状断言对全部技能生效；版本号仅对主线基线技能断言（上面已查）
      expect(skill.version.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.trigger.length).toBeGreaterThan(0);
      expect(skill.body).toContain("## Workflow");
      expect(skill.source).toBe("builtin");
    }
  });

  test("loadSkills：customDir 追加来源 custom；坏文件跳过不炸；缺失目录静默", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vos-skills-"));
    try {
      mkdirSync(join(dir, "my-custom"), { recursive: true });
      writeFileSync(
        join(dir, "my-custom", "SKILL.md"),
        ["---", "name: my-custom", "version: 0.2.0", "description: Custom skill for tests", "trigger: \"custom-kw\"", "---", "", "# My", "", "## Workflow", "do it", "", "## Anti-patterns", "nope"].join("\n"),
        "utf8",
      );
      mkdirSync(join(dir, "broken"), { recursive: true });
      writeFileSync(join(dir, "broken", "SKILL.md"), "no frontmatter at all", "utf8");
      mkdirSync(join(dir, "no-name"), { recursive: true });
      writeFileSync(join(dir, "no-name", "SKILL.md"), "---\ndescription: missing name\n---\nbody", "utf8");

      const skills = await loadSkills(dir);
      expect(skills.map((s) => s.name)).toContain("my-custom");
      const custom = skills.find((s) => s.name === "my-custom");
      expect(custom?.source).toBe("custom");
      expect(custom?.version).toBe("0.2.0");
      expect(skills.some((s) => s.name === "broken")).toBe(false);
      expect(skills.some((s) => s.name === "no-name")).toBe(false);

      // 目录缺失 → 静默空（builtin 仍在，数量与无 customDir 时一致——状态无关）
      const baseline = await loadSkills(null);
      const missing = await loadSkills(join(dir, "does-not-exist"));
      expect(missing.length).toBe(baseline.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- 单元：注入

const ALL_SKILLS = async (): Promise<SkillRecord[]> => loadSkills(null);

describe("composeSkillSection 单元", () => {
  test("autoTrigger：trigger 引号关键词命中 → 技能块（工作流 ≤1200 / 反模式 ≤400）；未命中只留花名册", async () => {
    const skills = await ALL_SKILLS();
    const lines = composeSkillSection({ message: "做一个 cinematic 预告片", skills, enabled: {}, autoTrigger: true }).join("\n");
    expect(lines).toContain("## 技能：cinematic-video（v0.1.0）");
    expect(lines).toContain("### 工作流");
    expect(lines).toContain("### 反模式");
    expect(lines).toContain("storyboard.plan"); // Workflow 节内容
    const workflow = /### 工作流\n([\s\S]*?)\n### 反模式/.exec(lines)?.[1] ?? "";
    expect(workflow.length).toBeLessThanOrEqual(1202); // 1200 + 省略号
    expect(lines).toContain("# 可用技能");
    expect(lines).toContain("- product-demo — ");

    // data-motion 的引号关键词 "data story"
    const dataStory = composeSkillSection({ message: "来一段 data story 动画", skills, enabled: {}, autoTrigger: true }).join("\n");
    expect(dataStory).toContain("## 技能：data-motion");

    // 不含关键词 → 无技能块
    const plain = composeSkillSection({ message: "随便聊聊", skills, enabled: {}, autoTrigger: true }).join("\n");
    expect(plain).not.toContain("## 技能：");
    expect(plain).toContain("# 可用技能");
  });

  test("autoTrigger=false → 仅 @引用生效", async () => {
    const skills = await ALL_SKILLS();
    const lines = composeSkillSection({ message: "做一个 cinematic 预告片", skills, enabled: {}, autoTrigger: false }).join("\n");
    expect(lines).not.toContain("## 技能：cinematic-video");
    const at = composeSkillSection({ message: "用 @cinematic-video 做预告片", skills, enabled: {}, autoTrigger: false }).join("\n");
    expect(at).toContain("## 技能：cinematic-video");
  });

  test("@引用：大小写不敏感；停用技能仍强制注入但花名册剔除；未知引用 → 系统注记", async () => {
    const skills = await ALL_SKILLS();
    const lines = composeSkillSection({ message: "@Short-Video 做个竖屏短片", skills, enabled: { "short-video": false }, autoTrigger: true }).join("\n");
    expect(lines).toContain("## 技能：short-video"); // 强制包含（显式意图优先）
    expect(lines).not.toContain("- short-video — "); // 花名册剔除停用项

    const unknown = composeSkillSection({ message: "@ghost-skill 帮我做视频", skills, enabled: {}, autoTrigger: false }).join("\n");
    expect(unknown).toContain("用户引用了不存在的技能 ghost-skill，请提示可用技能列表");
    expect(unknown).toContain("# 可用技能"); // 兜底附上可用列表
  });

  test("全部技能停用 → 空段（orchestrator 省略技能节）", async () => {
    const skills = await ALL_SKILLS();
    const disabled: Record<string, boolean> = {};
    for (const s of skills) disabled[s.name] = false;
    expect(composeSkillSection({ message: "做个视频", skills, enabled: disabled, autoTrigger: true })).toEqual([]);
    expect(composeSkillSection({ message: "做个视频", skills: [], enabled: {}, autoTrigger: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------- E2E（真实端口）

const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-demo", `skills-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "product-promo");

let handle: StudioServerHandle;
let base: string;

const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sendJson = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await send(method, path, body);
  if (res.status !== 200) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

interface SkillsApiBody {
  skills: Array<{ name: string; version: string; description: string; trigger: string; enabled: boolean; source: "builtin" | "custom" }>;
  autoTrigger: boolean;
  customDir: string | null;
}

// ---- 本地 OpenAI 桩（捕获 system prompt；模式同 orchestrator.test.ts）
function wire(body: { content: string }): string {
  return JSON.stringify({ choices: [{ message: { content: body.content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 30_000, what = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("Skills API E2E", () => {
  beforeAll(async () => {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    cpSync(join(REPO_ROOT, "examples", "product-promo"), PROJECT_ROOT, {
      recursive: true,
      filter: (src) => !src.includes(`${join(PROJECT_ROOT, ".video")}`),
    });
    handle = await startStudioServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "vos-skills-api-")), projectRoot: PROJECT_ROOT });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("GET /api/skills：已知内置技能在列 + autoTrigger + customDir（数量无关）", async () => {
    const body = await sendJson<SkillsApiBody>("GET", "/api/skills");
    const names = body.skills.map((s) => s.name);
    for (const known of ["cinematic-video", "data-motion", "product-demo", "short-video", "visual-qa"]) {
      expect(names).toContain(known);
    }
    expect(body.skills.length).toBeGreaterThanOrEqual(5);
    // 主线基线技能的既有字段约定
    const baseline = body.skills.filter((s) => names.includes(s.name) && ["cinematic-video", "data-motion", "product-demo", "short-video", "visual-qa"].includes(s.name));
    expect(baseline.every((s) => s.source === "builtin" && s.version === "0.1.0")).toBe(true);
    expect(body.skills.every((s) => s.enabled)).toBe(true);
    expect(body.autoTrigger).toBe(true);
    expect(body.customDir).toBeNull();
  });

  test("PATCH /api/skills/:name 启停：条目 + settings 持久化 + 回读", async () => {
    const patched = await sendJson<SkillsApiBody["skills"][number]>("PATCH", "/api/skills/visual-qa", { enabled: false });
    expect(patched.enabled).toBe(false);
    expect(patched.name).toBe("visual-qa");
    const after = await sendJson<SkillsApiBody>("GET", "/api/skills");
    expect(after.skills.find((s) => s.name === "visual-qa")?.enabled).toBe(false);
    expect(after.skills.find((s) => s.name === "product-demo")?.enabled).toBe(true); // 兄弟键不受影响
    const settings = await sendJson<{ skills: { enabled: Record<string, boolean> } }>("GET", "/api/settings");
    expect(settings.skills.enabled["visual-qa"]).toBe(false);

    const reEnabled = await sendJson<SkillsApiBody["skills"][number]>("PATCH", "/api/skills/visual-qa", { enabled: true });
    expect(reEnabled.enabled).toBe(true);
  });

  test("PATCH /api/skills/:name：未知 → 404 SKILL_NOT_FOUND；非法 body → 400", async () => {
    const notFound = await send("PATCH", "/api/skills/ghost", { enabled: true });
    expect(notFound.status).toBe(404);
    expect(await errorOf(notFound)).toContain("SKILL_NOT_FOUND");
    const bad = await send("PATCH", "/api/skills/product-demo", { enabled: "yes" });
    expect(bad.status).toBe(400);
    const missing = await send("PATCH", "/api/skills/product-demo", {});
    expect(missing.status).toBe(400);
  });

  test("PATCH /api/skills：autoTrigger / customDir 更新与校验", async () => {
    const updated = await sendJson<{ autoTrigger: boolean; customDir: string | null }>("PATCH", "/api/skills", { autoTrigger: false });
    expect(updated).toEqual({ autoTrigger: false, customDir: null });
    const snapshot = await sendJson<SkillsApiBody>("GET", "/api/skills");
    expect(snapshot.autoTrigger).toBe(false);

    // customDir 指向含自定义技能的目录 → 列表出现 source: custom
    const dir = mkdtempSync(join(tmpdir(), "vos-skills-custom-"));
    mkdirSync(join(dir, "my-custom"), { recursive: true });
    writeFileSync(
      join(dir, "my-custom", "SKILL.md"),
      "---\nname: my-custom\nversion: 0.3.0\ndescription: Custom entry\ntrigger: \"kw-custom\"\n---\n\n# My\n\n## Workflow\nstep\n",
      "utf8",
    );
    try {
      const withDir = await sendJson<SkillsApiBody>("PATCH", "/api/skills", { customDir: dir });
      expect(withDir.customDir).toBe(dir);
      const listed = await sendJson<SkillsApiBody>("GET", "/api/skills");
      const custom = listed.skills.find((s) => s.name === "my-custom");
      expect(custom?.source).toBe("custom");
      expect(custom?.enabled).toBe(true);
    } finally {
      await sendJson("PATCH", "/api/skills", { customDir: null });
      rmSync(dir, { recursive: true, force: true });
    }

    const empty = await send("PATCH", "/api/skills", {});
    expect(empty.status).toBe(400);
    const badDir = await send("PATCH", "/api/skills", { customDir: 123 });
    expect(badDir.status).toBe(400);
    // 恢复默认（不污染后续文件）
    await sendJson("POST", "/api/settings/reset", { sections: ["skills"] });
  });

  test("系统提示注入 E2E：@引用 → 技能块；未知 @ → 注记；autoTrigger 关闭 → 无自动块", async () => {
    await sendJson("POST", "/api/settings/reset", { sections: ["skills", "providers"] });
    const hits: string[] = [];
    const server: Server = createServer((req, res) => {
      if (req.method === "POST" && (req.url ?? "") === "/v1/chat/completions") {
        let data = "";
        req.on("data", (chunk) => (data += chunk as string));
        req.on("end", () => {
          hits.push(data);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(wire({ content: "收到。" }));
        });
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    const sockets = new Set<{ destroy(): void }>();
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const stubPort = (server.address() as { port: number }).port;
    const closeStub = (): Promise<void> => {
      for (const s of sockets) s.destroy();
      return new Promise<void>((r) => server.close(() => r()));
    };
    const systemOf = (index: number): string =>
      ((JSON.parse(hits[index] ?? "{}") as { messages?: Array<{ role: string; content: string }> }).messages ?? []).find((m) => m.role === "system")
        ?.content ?? "";
    try {
      await sendJson("POST", "/api/providers", {
        entry: { id: "stub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${stubPort}/v1`, model: "gpt-test" },
      });
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "技能注入" });

      // 1) @short-video 显式引用 → 技能块 + 花名册
      const run1 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "用 @short-video 做个竖屏视频" });
      await waitFor(() => hits.length >= 1, 20_000, "stub hit 1");
      expect(systemOf(0)).toContain("## 技能：short-video（v0.1.0）");
      expect(systemOf(0)).toContain("### 工作流");
      expect(systemOf(0)).toContain("# 可用技能");
      await waitForRunDone(run1.runId);

      // 2) 未知 @ghost-skill → 注记
      const run2 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "@ghost-skill 是什么" });
      await waitFor(() => hits.length >= 2, 20_000, "stub hit 2");
      expect(systemOf(1)).toContain("用户引用了不存在的技能 ghost-skill");
      await waitForRunDone(run2.runId);

      // 3) autoTrigger 关闭 → 关键词消息不注入技能块（花名册仍在）
      await sendJson("PATCH", "/api/skills", { autoTrigger: false });
      const run3 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "做一个 cinematic 预告片" });
      await waitFor(() => hits.length >= 3, 20_000, "stub hit 3");
      expect(systemOf(2)).not.toContain("## 技能：cinematic-video");
      expect(systemOf(2)).toContain("# 可用技能");
      await waitForRunDone(run3.runId);
    } finally {
      await closeStub();
      await sendJson("POST", "/api/settings/reset", { sections: ["skills", "providers"] });
    }
  }, 90_000);
});

async function waitForRunDone(runId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${base}/api/events`);
    const events = ((await res.json()) as { events: Array<{ type: string; runId?: string }> }).events;
    if (events.some((e) => e.type === "agent-run-done" && e.runId === runId)) return;
    if (Date.now() > deadline) throw new Error(`waitFor run-done timeout: ${runId}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}
