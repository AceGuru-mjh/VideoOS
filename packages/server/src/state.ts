// Studio server 状态与事件枢纽：单项目会话 + VapEvent 环形缓冲 + WS 广播。
// v0.2：装配 SettingsStore/SessionStore/SkillService/McpBridge/ChatOrchestrator（对话子系统），
//      并抽出 createProjectSession 供 IDE open() 与 chat 编排（会话绑定项目）共用。
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { WebSocket } from "ws";
import {
  asVapSession,
  createDefaultTools,
  createProvidersFromEnv,
  createVapContext,
  VapToolRegistry,
  type ModelProvider,
  type VapEvent,
  type VapSession,
} from "@videoos/agent";
import { projectToWorkspace } from "@videoos/mcp";
import { ProjectWorkspace, createProjectTemplate, WorkspaceError } from "@videoos/workspace";
import { SettingsStore, defaultDataDir } from "./settings";
import { SessionStore } from "./chat/sessions";
import { SkillService, defaultSkillsDirs } from "./chat/skills";
import { McpBridge } from "./chat/mcp-bridge";
import { ChatOrchestrator } from "./chat/orchestrator";
import type { AgentEventPayload } from "./chat/types";

/** 广播给 Studio 的事件（VapEvent 透传 + server 合成事件 + chat agent 频道） */
export type ServerEvent =
  | { type: "vap"; event: VapEvent }
  | { type: "server"; message: string }
  | { type: "compile"; ok: boolean; totalFrames: number; durationSeconds: number }
  | { type: "render-progress"; phase: string; frame: number; totalFrames: number }
  | { type: "render-done"; video: string; frames: number; cacheHits: number; cacheMisses: number }
  | { type: "render-error"; error: string }
  | { type: "test-done"; totalPassed: number; totalFailed: number }
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string }
  | ({ type: "agent-message" } & AgentEventPayload);

export class ServerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(`${code}: ${message}`);
    this.name = "ServerError";
    this.code = code;
    this.status = status;
  }
}

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

/** ServerState 构造选项（全部可选：new ServerState() 保持旧行为） */
export interface ServerStateOptions {
  /** 数据目录（settings/sessions 落盘根；缺省 defaultDataDir() → 仓根 .videoos-data） */
  dataDir?: string;
  /** Agent provider 工厂注入（测试/嵌入方覆盖 env 装配） */
  agentProviderFactory?: () => ModelProvider[];
}

export class ServerState {
  readonly hub: EventHub;
  /** 设置中心（语言/agent 自主性/工具权限/skills/mcp 配置；唯一事实源） */
  readonly settings: SettingsStore;
  /** 对话会话持久化 */
  readonly sessions: SessionStore;
  /** 技能发现/@引用/自动触发（13-b 实现完整版，签名冻结） */
  readonly skills: SkillService;
  /** MCP 桥（13-c 实现完整版，签名冻结；不可用时优雅降级） */
  readonly mcp: McpBridge;
  /** 对话式 agent 编排（#49） */
  readonly orchestrator: ChatOrchestrator;
  private current: ProjectSession | null = null;
  private readonly renderState: RenderJobState = {
    running: false, startedAt: null, scene: null, progress: null, error: null,
  };

  constructor(options: ServerStateOptions = {}) {
    this.hub = new EventHub();
    const dataDir = options.dataDir ?? defaultDataDir();
    this.settings = new SettingsStore(dataDir);
    this.sessions = new SessionStore(dataDir);
    this.skills = new SkillService({ defaultDirs: defaultSkillsDirs(), settings: this.settings });
    // 启动即预热技能目录（惰性 refresh 之外的兜底：重启后未发 GET /api/skills 前，
    // PATCH /api/skills/:name 与 orchestrator 注入也能命中已发现的技能）
    void this.skills.refresh().catch(() => undefined);
    this.mcp = new McpBridge({ settings: this.settings });
    this.orchestrator = new ChatOrchestrator({
      state: this,
      sessions: this.sessions,
      settings: this.settings,
      skills: this.skills,
      mcp: this.mcp,
      ...(options.agentProviderFactory !== undefined ? { createProviders: options.agentProviderFactory } : {}),
    });
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

  /**
   * 装配项目会话（ProjectWorkspace.open + VapContext + VAP 工具注册表）。
   * 供 open()（IDE 主会话）与 chat orchestrator（会话绑定项目）共用；
   * 不改变 IDE 当前会话（this.current），调用方自行决定是否接管。
   */
  async createProjectSession(root: string): Promise<ProjectSession> {
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
    return { project, session: asVapSession(session), registry };
  }

  async open(root: string): Promise<ProjectSession> {
    this.current = await this.createProjectSession(root);
    this.hub.emit({ type: "server", message: `project opened: ${this.current.project.root}` });
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

  /** Agent 配置探测（不抛错：未配置时 UI 显示引导） */
  agentConfig(): { configured: boolean; providers: string[] } {
    try {
      const providers = createProvidersFromEnv();
      return { configured: providers.length > 0, providers: providers.map((p) => p.id) };
    } catch {
      return { configured: false, providers: [] };
    }
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
