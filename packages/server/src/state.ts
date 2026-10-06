// Studio server 状态与事件枢纽：单项目会话 + VapEvent 环形缓冲 + WS 广播。
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { WebSocket } from "ws";
import {
  asVapSession,
  createDefaultTools,
  createVapContext,
  VapToolRegistry,
  type ModelProvider,
  type VapEvent,
  type VapSession,
} from "@videoos/agent";
import { projectToWorkspace } from "@videoos/mcp";
import { ProjectWorkspace, createProjectTemplate, WorkspaceError } from "@videoos/workspace";
import { ServerError } from "./errors";
import { SecureStore } from "./settings/secure";
import { resolveAgentProviders, type ProviderSource } from "./settings/providers";
import { SettingsStore } from "./settings/store";
import { ChatOrchestrator } from "./chat/orchestrator";
import { ConfirmCenter } from "./chat/gate";
import { createKnowledgeTools } from "./chat/knowledge";
import { McpManager } from "./chat/mcp";
import { SessionStore } from "./chat/sessions";
import { createTemplateTools } from "./chat/templates";

export { ServerError } from "./errors";

/** 广播给 Studio 的事件（VapEvent 透传 + server 合成事件） */
export type ServerEvent =
  | { type: "vap"; event: VapEvent }
  | { type: "server"; message: string }
  | { type: "compile"; ok: boolean; totalFrames: number; durationSeconds: number }
  | { type: "render-progress"; phase: string; frame: number; totalFrames: number }
  | { type: "render-done"; video: string; frames: number; cacheHits: number; cacheMisses: number }
  | { type: "render-error"; error: string }
  | { type: "test-done"; totalPassed: number; totalFailed: number }
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string }
  // ---- 对话 Agent 循环（issue #49，v0.2 §3；形状与 apps/studio api.ts 镜像冻结） ----
  | { type: "agent-run-start"; sessionId: string; runId: string }
  | { type: "agent-text"; sessionId: string; runId: string; text: string }
  | {
      type: "agent-tool";
      sessionId: string;
      runId: string;
      name: string;
      args: unknown;
      status: "start" | "ok" | "error";
      durationMs?: number;
      frame?: number;
      videoUrl?: string;
      error?: string;
      resultSummary?: string;
    }
  | {
      type: "agent-run-done";
      sessionId: string;
      runId: string;
      ok: boolean;
      steps: number;
      usage?: { promptTokens: number; completionTokens: number };
      error?: string;
    }
  // ---- 确认流（issue #54；agent-confirm 由 GatedRegistry 在 confirm 类工具挂起时发，agent-resolved 在裁决落地时发） ----
  | { type: "agent-confirm"; sessionId: string; runId: string; confirmId: string; tool: { name: string; args: unknown } }
  // 裁决结果（用户 resolve / 超时默认拒 / 停止拒绝；UI 确认卡据此同步消失）
  | { type: "agent-resolved"; confirmId: string; decision: "allow" | "always" | "deny" };

/** 对话 Agent 事件子集（前端可直接引用此类型镜像 WS 契约）；agent-confirm/agent-resolved 见 ServerEvent（issue #54 新增） */
export type ChatStreamEvent = Extract<ServerEvent, { type: "agent-run-start" | "agent-text" | "agent-tool" | "agent-run-done" }>;

/** ServerError 定义见 ./errors.ts（此处 re-export 保持既有导入路径兼容） */

/** WS 广播枢纽 + 事件环形缓冲（最近 500 条） */
export class EventHub {
  private readonly clients = new Set<WebSocket>();
  private readonly ring: ServerEvent[] = [];
  private static readonly RING_LIMIT = 500;

  add(ws: WebSocket): void {
    this.clients.add(ws);
  }
  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }
  get connections(): number {
    return this.clients.size;
  }
  recent(): ServerEvent[] {
    return [...this.ring];
  }
  emit(e: ServerEvent): void {
    this.ring.push(e);
    if (this.ring.length > EventHub.RING_LIMIT) this.ring.splice(0, this.ring.length - EventHub.RING_LIMIT);
    const text = JSON.stringify(e);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}

export interface RenderJobState {
  running: boolean;
  startedAt: string | null;
  scene: string | null;
  progress: { phase: string; frame: number; totalFrames: number } | null;
  error: string | null;
}

export interface ProjectSession {
  project: ProjectWorkspace;
  session: VapSession;
  registry: VapToolRegistry;
}

/** 设置数据目录解析：显式参数 → env VIDEOOS_DATA_DIR → <cwd>/.videoos（桌面 sidecar 以 userData 为 cwd，自动落位） */
export function resolveDataDir(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env.VIDEOOS_DATA_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(process.cwd(), ".videoos");
}

export class ServerState {
  readonly hub: EventHub;
  /** 设置中心存储（<dataDir>/settings.json，v0.2 §5） */
  readonly settings: SettingsStore;
  /** API Key 安全存储（<dataDir>/settings.secure.json，issue #46） */
  readonly secure: SecureStore;
  /** 对话会话存储（<dataDir>/sessions/<id>.json，issue #50） */
  readonly sessions: SessionStore;
  /** 对话 Agent 编排（多轮循环 + WS 流式 + 停止，issue #49；全局单运行） */
  readonly chat: ChatOrchestrator;
  /** 挂起确认登记簿（issue #54：agent-confirm ↔ POST /api/agent/resolve 会合点） */
  readonly confirms: ConfirmCenter;
  /** MCP optional-peer 桥（issue #53：@videoos/mcp-host 缺失时全部端点 501） */
  readonly mcp: McpManager;
  private current: ProjectSession | null = null;
  private readonly renderState: RenderJobState = {
    running: false, startedAt: null, scene: null, progress: null, error: null,
  };

  constructor(dataDir?: string) {
    const resolved = resolveDataDir(dataDir);
    this.hub = new EventHub();
    this.settings = new SettingsStore(resolved);
    this.secure = new SecureStore(resolved);
    this.sessions = new SessionStore(resolved);
    // agent-resolved 广播接线：用户裁决 / 超时默认拒 / 停止拒绝三路都经 settle → 单一出口
    this.confirms = new ConfirmCenter((confirmId, decision) => {
      this.hub.emit({ type: "agent-resolved", confirmId, decision });
    });
    this.mcp = new McpManager({ settings: this.settings, hub: this.hub });
    this.chat = new ChatOrchestrator(this);
  }

  get projectSession(): ProjectSession | null {
    return this.current;
  }
  get render(): Readonly<RenderJobState> {
    return this.renderState;
  }
  setRender(patch: Partial<RenderJobState>): void {
    Object.assign(this.renderState, patch);
  }

  requireSession(): ProjectSession {
    if (this.current === null) {
      throw new ServerError("SERVER_NO_PROJECT", "no project open (POST /api/project/open first)", 409);
    }
    return this.current;
  }

  async open(root: string): Promise<ProjectSession> {
    const project = await ProjectWorkspace.open(root).catch((err) => {
      if (err instanceof WorkspaceError) throw new ServerError("SERVER_OPEN_FAILED", err.message, 404);
      throw err;
    });
    const session = await createVapContext({
      workspace: projectToWorkspace(project),
      entryPath: join(project.root, project.manifest.entry),
      onEvent: (e: VapEvent) => this.hub.emit({ type: "vap", event: e }),
    });
    const registry = new VapToolRegistry();
    for (const tool of createDefaultTools()) registry.register(tool);
    // 模板脚手架 + 知识库工具（v0.2.1 任务 11-a/11-b，11-c 接线）：
    // template.list/inspect/apply + pattern.search/get + skill.read + dsl.reference
    for (const tool of createTemplateTools()) registry.register(tool);
    for (const tool of createKnowledgeTools()) registry.register(tool);
    this.current = { project, session: asVapSession(session), registry };
    this.hub.emit({ type: "server", message: `project opened: ${project.root}` });
    return this.current;
  }

  async init(parentDir: string, name: string): Promise<ProjectSession> {
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) {
      throw new ServerError("SERVER_INVALID_NAME", `非法项目名：${JSON.stringify(name)}`);
    }
    const root = join(parentDir, name);
    if (ProjectWorkspace.isProject(root)) {
      throw new ServerError("SERVER_ALREADY_INITIALIZED", `${root} 已是 VideoOS 项目`, 409);
    }
    await ProjectWorkspace.init(root, { name });
    await createProjectTemplate(root, name);
    return this.open(root);
  }

  close(): void {
    this.current = null;
    this.hub.emit({ type: "server", message: "project closed" });
  }

  /** Agent provider 装配（issue #46 桥）：settings enabled 条目优先 → v0.1 env 配置回退 */
  resolveProviders(): ModelProvider[] {
    return resolveAgentProviders(this.settings.get(), this.secure).providers;
  }

  /** Agent 配置探测（不抛错：未配置时 UI 显示引导；source 标记来源供 UI 区分引导文案） */
  agentConfig(): { configured: boolean; providers: string[]; source: ProviderSource } {
    const { providers, source } = resolveAgentProviders(this.settings.get(), this.secure);
    return { configured: providers.length > 0, providers: providers.map((p) => p.id), source };
  }

  /** 资产清单（images/audio/fonts 递归） */
  async listAssets(): Promise<Array<{ rel: string; kind: "image" | "audio" | "font"; size: number }>> {
    const session = this.requireSession();
    const out: Array<{ rel: string; kind: "image" | "audio" | "font"; size: number }> = [];
    for (const kind of ["images", "audio", "fonts"] as const) {
      const dir = join(session.project.root, "assets", kind);
      const files = await listFilesRecursive(dir);
      const mapped = kind === "images" ? "image" : kind === "audio" ? "audio" : "font";
      for (const f of files) out.push({ rel: `assets/${kind}/${f.rel}`, kind: mapped, size: f.size });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }
}

async function listFilesRecursive(dir: string): Promise<Array<{ rel: string; size: number }>> {
  const out: Array<{ rel: string; size: number }> = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await listFilesRecursive(full);
      for (const s of sub) out.push({ rel: `${e.name}/${s.rel}`, size: s.size });
    } else {
      const st = await stat(full).catch(() => null);
      out.push({ rel: e.name, size: st?.size ?? 0 });
    }
  }
  return out;
}
