// Studio server 状态与事件枢纽：单项目会话 + VapEvent 环形缓冲 + WS 广播。
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
  type VapEvent,
  type VapSession,
} from "@videoos/agent";
import { projectToWorkspace } from "@videoos/mcp";
import { ProjectWorkspace, createProjectTemplate, WorkspaceError } from "@videoos/workspace";
import { ServerError } from "./errors";
import { SettingsStore } from "./settings/store";

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
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string };

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
  private current: ProjectSession | null = null;
  private readonly renderState: RenderJobState = {
    running: false, startedAt: null, scene: null, progress: null, error: null,
  };

  constructor(dataDir?: string) {
    this.hub = new EventHub();
    this.settings = new SettingsStore(resolveDataDir(dataDir));
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
