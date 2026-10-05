// Studio HTTP API（SPEC §10：packages/server 提供 REST + WS 给 React UI / 外部工具）。
// 设计：单项目会话；JSON 错误统一 { error: "CODE: message" }；PNG/静态走二进制响应。
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname, basename } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { AgentExecutor, ModelRouter, ProviderError } from "@videoos/agent";
import type { CompileResult } from "@videoos/compiler";
import type { QaReport } from "@videoos/qa";
import type { VideoCodec } from "@videoos/encode";
import { ServerError, ServerState, type ProjectSession } from "./state";
import {
  createProviderEntry,
  deleteProviderEntry,
  listProviders,
  testProviderConnection,
  updateProviderEntry,
} from "./settings/providers";
import { setSkillEnabled, skillsSnapshot, updateSkillsSettings } from "./chat/skills";
import { errorDetail, mcpHint } from "./server-messages";
import { STUDIO_TYPINGS } from "./typings";

export interface StudioAppOptions {
  /** Studio 构建产物目录（存在时以 SPA 形式挂载到 /） */
  studioDistDir?: string;
}

export function createStudioApp(state: ServerState, options: StudioAppOptions = {}): Hono {
  const app = new Hono();

  // ---- 错误包装：ServerError → 状态码 + {error}；其余 → 500 ----
  app.onError((err, c) => {
    if (err instanceof ServerError) {
      // 用户可见错误详情随设置语言本地化（错误码标题由客户端 i18n 映射，见 server-messages.ts）
      return c.json({ error: errorDetail(state.settings.get(), err.message) }, err.status as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `SERVER_INTERNAL: ${message}` }, 500);
  });

  const requireProject = (): ProjectSession => state.requireSession();

  /** 项目内路径安全解析（拒绝越界） */
  const safeProjectPath = (rel: string): string => {
    const session = requireProject();
    const root = resolve(session.project.root);
    const full = resolve(root, rel);
    if (full !== root && !full.startsWith(root + "/") && !full.startsWith(root + "\\")) {
      throw new ServerError("SERVER_PATH_ESCAPE", `path escapes project root: ${rel}`, 403);
    }
    return full;
  };

  // ---------------------------------------------------------------- health
  app.get("/api/health", (c) => c.json({
    ok: true,
    server: "videoos-studio",
    version: "0.1.0",
    project: state.projectSession?.project.root ?? null,
    render: state.render,
    agent: state.agentConfig(),
    wsConnections: state.hub.connections,
  }));

  app.get("/api/events", (c) => c.json({ events: state.hub.recent() }));

  // ---------------------------------------------------------------- project
  app.post("/api/project/open", async (c) => {
    const body = await c.req.json<{ root?: string }>();
    if (typeof body.root !== "string" || body.root.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.root required");
    }
    const session = await state.open(body.root);
    const testFiles = await session.session.listTestFiles().catch(() => [] as string[]);
    return c.json({
      root: session.project.root,
      name: session.project.manifest.name,
      entry: session.project.manifest.entry,
      testFiles,
      mcp: { command: "videoos mcp", cwd: session.project.root },
    });
  });

  app.post("/api/project/init", async (c) => {
    const body = await c.req.json<{ parentDir?: string; name?: string }>();
    if (typeof body.parentDir !== "string" || typeof body.name !== "string") {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.parentDir + body.name required");
    }
    const session = await state.init(body.parentDir, body.name);
    const testFiles = await session.session.listTestFiles().catch(() => [] as string[]);
    return c.json({
      root: session.project.root,
      name: session.project.manifest.name,
      entry: session.project.manifest.entry,
      testFiles,
      mcp: { command: "videoos mcp", cwd: session.project.root },
    });
  });

  app.post("/api/project/close", (c) => {
    state.close();
    return c.json({ ok: true });
  });

  app.get("/api/project", async (c) => {
    const session = requireProject();
    const testFiles = await session.session.listTestFiles().catch(() => [] as string[]);
    return c.json({
      root: session.project.root,
      name: session.project.manifest.name,
      entry: session.project.manifest.entry,
      testFiles,
      mcp: { command: "videoos mcp", cwd: session.project.root },
    });
  });

  app.get("/api/assets", async (c) => {
    const assets = await state.listAssets();
    return c.json({ assets });
  });

  // ---------------------------------------------------------------- compile
  app.post("/api/compile", async (c) => {
    const session = requireProject();
    const summary = await compileAndSummarize(state, session);
    return c.json(summary);
  });

  // ---------------------------------------------------------------- frames
  app.get("/api/frame/:n", async (c) => {
    const session = requireProject();
    const n = parseFrameParam(c.req.param("n"));
    await session.session.ensureCompiled();
    const png = await session.session.renderPreviewPng(n);
    return binaryResponse(c, new Uint8Array(png), "image/png");
  });

  app.get("/api/frame/:n/ops", async (c) => {
    const session = requireProject();
    const n = parseFrameParam(c.req.param("n"));
    const compile = await session.session.ensureCompiled();
    const plan = compile.framePlan(n);
    return c.json({ frame: plan.frame, sceneId: plan.sceneId, background: plan.background, commands: plan.commands });
  });

  // ---------------------------------------------------------------- files
  app.get("/api/file", async (c) => {
    const rel = c.req.query("path");
    if (rel === undefined) throw new ServerError("SERVER_INVALID_PARAMS", "?path= required");
    const full = safeProjectPath(rel);
    if (!existsSync(full)) throw new ServerError("SERVER_FILE_NOT_FOUND", rel, 404);
    const content = await readFile(full, "utf8");
    return c.json({ path: rel, content });
  });

  app.put("/api/file", async (c) => {
    const body = await c.req.json<{ path?: string; content?: string; recompile?: boolean }>();
    if (typeof body.path !== "string" || typeof body.content !== "string") {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.path + body.content required");
    }
    const full = safeProjectPath(body.path);
    await mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}-${Date.now().toString(36)}`;
    await writeFile(tmp, body.content, "utf8");
    await rename(tmp, full);
    if (body.recompile === false) return c.json({ ok: true, compiled: false });
    const summary = await compileAndSummarize(state, requireProject());
    return c.json({ compiled: true, ...summary });
  });

  // ---------------------------------------------------------------- tests
  app.get("/api/tests", async (c) => {
    const session = requireProject();
    const files = await session.session.listTestFiles();
    return c.json({ files });
  });

  app.post("/api/tests/run", async (c) => {
    const session = requireProject();
    const body = await c.req.json<{ updateGolden?: boolean }>().catch(() => ({}) as { updateGolden?: boolean });
    const report = await session.session.runTests(body.updateGolden === true ? { updateGolden: true } : undefined);
    state.hub.emit({ type: "test-done", totalPassed: report.totalPassed, totalFailed: report.totalFailed });
    return c.json(sanitizeReport(report));
  });

  // ---------------------------------------------------------------- render
  app.post("/api/render/start", async (c) => {
    const session = requireProject();
    if (state.render.running) {
      throw new ServerError("SERVER_RENDER_BUSY", "渲染进行中（v1 单任务）", 409);
    }
    const body = await c.req.json<{ scene?: string; codec?: string; crf?: number; preset?: string }>().catch(() => ({}) as Record<string, never>);
    const codec: VideoCodec = body.codec === "vp9" ? "vp9" : "h264";
    const crf = typeof body.crf === "number" && Number.isFinite(body.crf) ? Math.min(51, Math.max(0, Math.round(body.crf))) : 18;
    const preset = typeof body.preset === "string" && body.preset.length > 0 ? body.preset : "medium";

    state.setRender({ running: true, startedAt: new Date().toISOString(), scene: body.scene ?? null, progress: null, error: null });
    // 后台执行；进度与结果经 WS 广播
    void (async () => {
      try {
        const result = await session.session.renderFinal({
          ...(body.scene !== undefined && body.scene.length > 0 ? { scene: body.scene } : {}),
          encoder: { codec, crf, preset },
          onProgress: (p) => {
            state.setRender({ progress: { phase: p.phase, frame: p.frame, totalFrames: p.totalFrames } });
            state.hub.emit({ type: "render-progress", phase: p.phase, frame: p.frame, totalFrames: p.totalFrames });
          },
        });
        state.setRender({ running: false, progress: null });
        state.hub.emit({
          type: "render-done",
          video: result.video,
          frames: result.frames,
          cacheHits: result.cacheHits,
          cacheMisses: result.cacheMisses,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.setRender({ running: false, progress: null, error: message });
        state.hub.emit({ type: "render-error", error: message });
      }
    })();
    return c.json({ ok: true, startedAt: state.render.startedAt });
  });

  app.get("/api/render/status", (c) => c.json({ ...state.render }));

  // ---------------------------------------------------------------- agent
  app.get("/api/agent/config", (c) => c.json(state.agentConfig()));

  app.post("/api/agent/exec", async (c) => {
    const session = requireProject();
    const body = await c.req.json<{ prompt?: string; maxSteps?: number }>();
    if (typeof body.prompt !== "string" || body.prompt.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.prompt required");
    }
    // issue #46 桥：settings 配置的 enabled provider 优先 → v0.1 env 配置回退
    const providers = state.resolveProviders();
    if (providers.length === 0) {
      throw new ServerError(
        "SERVER_NO_PROVIDER",
        "未配置模型 Provider（在设置中心添加 /api/providers，或环境变量 VIDEOOS_PROVIDERS / VIDEOOS_PROVIDER_<ID>_KEY）",
        409,
      );
    }
    const router = new ModelRouter(providers);
    const executor = new AgentExecutor({
      router,
      registry: session.registry,
      context: session.session,
      ...(typeof body.maxSteps === "number" && Number.isInteger(body.maxSteps) && body.maxSteps > 0 ? { maxSteps: body.maxSteps } : {}),
    });
    try {
      const result = await executor.run(body.prompt);
      const summary = result.steps
        .filter((s) => s.role === "assistant" && s.content.length > 0)
        .map((s) => s.content)
        .join("\n\n");
      state.hub.emit({ type: "agent-done", ok: true, toolCallCount: result.toolCallCount, summary: summary.slice(0, 4000) });
      return c.json({
        ok: true,
        toolCallCount: result.toolCallCount,
        steps: result.steps.map((s) => ({ role: s.role, content: s.content.slice(0, 2000), tools: s.toolCalls?.map((t) => t.name) ?? [] })),
        summary,
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new ServerError("SERVER_PROVIDER_ERROR", err.message, 502);
      }
      throw err;
    }
  });

  app.post("/api/agent/tool", async (c) => {
    const session = requireProject();
    const body = await c.req.json<{ name?: string; args?: Record<string, unknown> }>();
    if (typeof body.name !== "string" || body.name.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.name required");
    }
    const result = await session.registry.call(body.name, body.args ?? {}, session.session);
    return c.json(result);
  });

  app.get("/api/tools", (c) => {
    const session = requireProject();
    return c.json({ tools: session.registry.list() });
  });

  // ---------------------------------------------------------------- typings
  app.get("/api/typings", (c) => c.json({ files: STUDIO_TYPINGS }));

  app.get("/api/mcp", (c) => {
    const session = state.projectSession;
    return c.json({
      command: "videoos mcp",
      cwd: session?.project.root ?? null,
      // 16-r4：用户可见文案双语（settings.general.language 驱动，见 server-messages.ts）
      hint: mcpHint(state.settings.get()),
    });
  });

  // ---------------------------------------------------------------- settings（v0.2 §5：九大类，见 src/settings/）
  app.get("/api/settings", (c) => c.json(state.settings.get()));

  app.put("/api/settings", async (c) => {
    const body = await readSettingsBody(c);
    return c.json(state.settings.replace(body));
  });

  app.patch("/api/settings", async (c) => {
    const body = await readSettingsBody(c);
    return c.json(state.settings.update(body));
  });

  app.post("/api/settings/reset", async (c) => {
    // body 可选：缺省/空 sections → 全部恢复默认
    const body = (await c.req.json<unknown>().catch(() => undefined)) as { sections?: unknown } | undefined;
    let sections: string[] | undefined;
    if (body?.sections !== undefined) {
      if (!Array.isArray(body.sections) || body.sections.some((s) => typeof s !== "string")) {
        throw new ServerError("SETTINGS_INVALID", "body.sections must be an array of settings section names");
      }
      sections = body.sections;
    }
    return c.json(state.settings.reset(sections));
  });

  // ---------------------------------------------------------------- providers（issue #46/#47：供应商 CRUD + 连通性测试；逻辑在 src/settings/providers.ts）
  app.get("/api/providers", (c) => c.json(listProviders(state.settings, state.secure)));

  app.post("/api/providers", async (c) => {
    const body = await readSettingsBody(c);
    return c.json(createProviderEntry(state.settings, state.secure, body));
  });

  app.post("/api/providers/test", async (c) => {
    const body = await readSettingsBody(c);
    return c.json(await testProviderConnection(state.settings, state.secure, body));
  });

  app.put("/api/providers/:id", async (c) => {
    const body = await readSettingsBody(c);
    return c.json(updateProviderEntry(state.settings, state.secure, c.req.param("id"), body));
  });

  app.delete("/api/providers/:id", (c) => {
    return c.json(deleteProviderEntry(state.settings, state.secure, c.req.param("id")));
  });

  // ---------------------------------------------------------------- sessions（issue #50：对话会话一等公民；逻辑在 src/chat/sessions.ts）
  // 响应体与 apps/studio api.ts 冻结契约一致：列表 → 裸数组，单条 → 裸记录
  app.get("/api/sessions", (c) => c.json(state.sessions.list()));

  app.post("/api/sessions", async (c) => {
    const body = await readJsonObject(c);
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.length > 200)) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.title must be a non-empty string (≤200 chars)");
    }
    if (body.projectRoot !== undefined && body.projectRoot !== null && (typeof body.projectRoot !== "string" || body.projectRoot.length === 0)) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.projectRoot must be a non-empty string or null");
    }
    const explicitRoot = body.projectRoot;
    return c.json(
      state.sessions.create({
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        // 缺省 = 当前打开的项目根；显式 null = 不绑定（前端在无项目时创建的会话）
        projectRoot:
          typeof explicitRoot === "string"
            ? explicitRoot
            : explicitRoot === null
              ? null
              : (state.projectSession?.project.root ?? null),
      }),
    );
  });

  app.get("/api/sessions/:id", (c) => c.json(state.sessions.get(c.req.param("id"))));

  app.patch("/api/sessions/:id", async (c) => {
    const body = await readJsonObject(c);
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.title (non-empty string) required");
    }
    return c.json(state.sessions.rename(c.req.param("id"), body.title));
  });

  app.delete("/api/sessions/:id", (c) => {
    state.sessions.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- 对话 Agent 循环（issue #49；逻辑在 src/chat/orchestrator.ts）
  app.post("/api/agent/chat", async (c) => {
    const body = await readJsonObject(c);
    if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.sessionId required");
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.message required");
    }
    let maxSteps: number | undefined;
    if (body.maxSteps !== undefined) {
      if (typeof body.maxSteps !== "number" || !Number.isInteger(body.maxSteps) || body.maxSteps < 1) {
        throw new ServerError("SERVER_INVALID_PARAMS", "body.maxSteps must be a positive integer");
      }
      maxSteps = body.maxSteps;
    }
    const { runId } = await state.chat.start({
      sessionId: body.sessionId,
      message: body.message,
      ...(maxSteps !== undefined ? { maxSteps } : {}),
    });
    return c.json({ runId });
  });

  app.post("/api/agent/stop", async (c) => {
    const body = await readJsonObject(c);
    const runId = typeof body.runId === "string" && body.runId.length > 0 ? body.runId : undefined;
    return c.json(state.chat.stop(runId));
  });

  app.get("/api/agent/run/active", (c) => c.json(state.chat.activeRun()));

  // ---------------------------------------------------------------- 确认流（issue #54；挂起确认的会合点）
  app.post("/api/agent/resolve", async (c) => {
    const body = await readJsonObject(c);
    if (typeof body.confirmId !== "string" || body.confirmId.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.confirmId required");
    }
    if (body.decision !== "allow" && body.decision !== "always" && body.decision !== "deny") {
      throw new ServerError("SERVER_INVALID_PARAMS", 'body.decision must be one of "allow" | "always" | "deny"');
    }
    if (!state.confirms.resolve(body.confirmId, body.decision)) {
      throw new ServerError("CONFIRM_NOT_FOUND", `confirm "${body.confirmId}" 不存在或已被裁决（超时/停止/已处理）`, 404);
    }
    return c.json({ resolved: true });
  });

  // ---------------------------------------------------------------- skills（issue #52；逻辑在 src/chat/skills.ts；契约与 Studio 冻结）
  app.get("/api/skills", async (c) => c.json(await skillsSnapshot(state.settings)));

  app.patch("/api/skills/:name", async (c) => {
    const body = await readJsonObject(c);
    if (typeof body.enabled !== "boolean") {
      throw new ServerError("SERVER_INVALID_PARAMS", "body.enabled (boolean) required");
    }
    return c.json(await setSkillEnabled(state.settings, c.req.param("name"), body.enabled));
  });

  app.patch("/api/skills", async (c) => {
    const body = await readJsonObject(c);
    return c.json(updateSkillsSettings(state.settings, { autoTrigger: body.autoTrigger, customDir: body.customDir }));
  });

  // ---------------------------------------------------------------- mcp（issue #53；optional peer @videoos/mcp-host；逻辑在 src/chat/mcp.ts）
  // host 模块不可用 → 全部 501 MCP_HOST_UNAVAILABLE（UI 据此隐藏 MCP 面板）
  app.get("/api/mcp/status", async (c) => c.json(await state.mcp.status()));

  app.get("/api/mcp/servers", async (c) => c.json(await state.mcp.listServers()));

  app.put("/api/mcp/servers", async (c) => {
    const body = await readJsonObject(c);
    return c.json(await state.mcp.putServers(body));
  });

  app.post("/api/mcp/servers/:id/start", async (c) => c.json(await state.mcp.startServer(c.req.param("id"))));

  app.post("/api/mcp/servers/:id/stop", async (c) => c.json(await state.mcp.stopServer(c.req.param("id"))));

  app.get("/api/mcp/tools", async (c) => c.json(await state.mcp.listTools()));

  // ---------------------------------------------------------------- static
  const session_ = () => state.projectSession;
  app.get("/renders/*", (c) => {
    const s = session_();
    const rel = c.req.path.slice("/renders/".length);
    if (s === null) throw new ServerError("SERVER_NO_PROJECT", "no project open", 409);
    return streamFile(c, join(s.project.paths.renders, rel));
  });
  app.get("/assets/*", (c) => {
    const s = session_();
    const rel = c.req.path.slice("/assets/".length);
    if (s === null) throw new ServerError("SERVER_NO_PROJECT", "no project open", 409);
    return streamFile(c, join(s.project.root, "assets", rel));
  });

  if (options.studioDistDir !== undefined && existsSync(options.studioDistDir)) {
    const dist = resolve(options.studioDistDir);
    app.get("*", (c) => {
      const rel = c.req.path.slice(1);
      if (rel.length > 0 && !rel.includes("..")) {
        const full = resolve(dist, rel);
        if (full.startsWith(dist) && existsSync(full)) {
          const st = statSyncOrNull(full);
          if (st !== null && st.isFile()) return streamFile(c, full);
        }
      }
      return streamFile(c, join(dist, "index.html"));
    });
  }

  return app;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function statSyncOrNull(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function parseFrameParam(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new ServerError("SERVER_INVALID_FRAME", `frame must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/** 设置/供应商路由 JSON 体读取：非 JSON 体 → 400 SETTINGS_INVALID（而非 500） */
async function readSettingsBody(c: Context): Promise<unknown> {
  return c.req.json<unknown>().catch(() => {
    throw new ServerError("SETTINGS_INVALID", "request body must be valid JSON");
  });
}

/** 会话/对话路由 JSON 体读取：空体 → {}；非 JSON / 非对象 → 400 SERVER_INVALID_PARAMS */
async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text().catch(() => "");
  if (text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ServerError("SERVER_INVALID_PARAMS", "request body must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ServerError("SERVER_INVALID_PARAMS", "request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function binaryResponse(c: Context, bytes: Uint8Array, contentType: string): Response {
  void c;
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Response(ab, { status: 200, headers: { "content-type": contentType, "cache-control": "no-store" } });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** 静态文件（流式 + 目录穿越防护 + ETag 禁缓存简化版） */
function streamFile(c: Context, unsafePath: string): Response {
  const full = resolve(unsafePath);
  const dir = dirname(full);
  const file = basename(full);
  const target = join(dir, file);
  const st = statSyncOrNull(target);
  if (st === null || !st.isFile()) {
    return c.json({ error: `SERVER_FILE_NOT_FOUND: ${file}` }, 404);
  }
  const nodeStream = createReadStream(target);
  return c.newResponse(
    // Hono (node-server) 接受 Node Readable 作为 Body
    nodeStream as unknown as ReadableStream,
    200,
    { "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" },
  );
}

/** QaReport JSON 化（Buffer → 占位；diff 图走 /renders 静态路径） */
function sanitizeReport(report: QaReport): unknown {
  return JSON.parse(JSON.stringify(report, (_k, v: unknown) => {
    if (v instanceof Uint8Array) return `<binary ${v.byteLength} bytes>`;
    if (v !== null && typeof v === "object" && (v as { type?: string }).type === "Buffer") return "<binary>";
    return v;
  }));
}

/** 编译 + 广播 + 摘要（compile-on-save / 显式编译共用） */
async function compileAndSummarize(state: ServerState, session: ProjectSession) {
  let compile: CompileResult;
  try {
    compile = await session.session.compile();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.hub.emit({ type: "compile", ok: false, totalFrames: 0, durationSeconds: 0 });
    return { ok: false, error: message, vir: null, diagnostics: [], totalFrames: 0, durationSeconds: 0 };
  }
  const totalFrames = compile.semantic.totalFrames;
  const durationSeconds = compile.semantic.totalDuration;
  const ok = compile.diagnostics.every((d) => d.level !== "error");
  state.hub.emit({ type: "compile", ok, totalFrames, durationSeconds });
  return {
    ok,
    vir: compile.vir,
    diagnostics: compile.diagnostics,
    totalFrames,
    durationSeconds,
    fps: compile.vir.meta.fps,
    width: compile.vir.meta.width,
    height: compile.vir.meta.height,
  };
}


export type { ServerState };
