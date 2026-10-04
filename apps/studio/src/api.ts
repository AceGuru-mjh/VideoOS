// VideoOS Studio — typed API client. Single source of truth for every request
// and response shape of @videoos/server (packages/server/src/app.ts).
// Base URL is "" (same origin): dev via the Vite proxy, prod served by the server.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// shared response shapes (match the server exactly)
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  root: string;
  name: string;
  entry: string;
  /** absolute paths (server walks the project tree) */
  testFiles: string[];
  mcp: { command: string; cwd: string | null };
}

export interface Diagnostic {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  scene?: string;
  layer?: string;
}

export interface VirMeta {
  title: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  seed: number;
}

export interface VirLayerInfo {
  id: string;
  type: string;
  name?: string;
  [k: string]: unknown;
}

export interface VirBeat {
  id: string;
  name: string;
  at: number;
  description?: string;
}

export interface VirScene {
  id: string;
  name: string;
  start: number;
  duration: number;
  background?: string;
  layers: VirLayerInfo[];
  beats: VirBeat[];
}

export interface VirTransition {
  type: string;
  duration: number;
  /** scene names */
  between: [string, string];
}

export interface VirAsset {
  id: string;
  type: string;
  src: string;
  [k: string]: unknown;
}

export interface Vir {
  virVersion: "1.0";
  meta: VirMeta;
  scenes: VirScene[];
  transitions: VirTransition[];
  audio: unknown[];
  assets: VirAsset[];
  graphs: unknown;
}

export interface CompileSummary {
  ok: boolean;
  vir: Vir | null;
  diagnostics: Diagnostic[];
  totalFrames: number;
  durationSeconds: number;
  fps?: number;
  width?: number;
  height?: number;
  error?: string;
}

/** PUT /api/file response: `{compiled:true}` merged with the CompileSummary fields. */
export interface SaveFileResult {
  compiled: boolean;
  ok?: boolean;
  vir?: Vir | null;
  diagnostics?: Diagnostic[];
  totalFrames?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
  height?: number;
  error?: string;
}

export interface FrameCommand {
  op: "draw-rect" | "draw-ellipse" | "draw-text" | "draw-image";
  layerId: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  content?: string;
  [k: string]: unknown;
}

export interface FrameOps {
  frame: number;
  /** null when no scene is active at this frame */
  sceneId: string | null;
  background: string;
  commands: FrameCommand[];
}

export interface QaTestResult {
  name: string;
  suite: string;
  status: "pass" | "fail" | "skip";
  message?: string;
  details?: Record<string, unknown>;
}

export interface QaSuite {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  results: QaTestResult[];
  durationMs: number;
}

export interface QaReport {
  suites: QaSuite[];
  totalPassed: number;
  totalFailed: number;
  durationMs: number;
  virHash?: string;
}

export type VapEventKind = "tool-call" | "tool-result" | "compile" | "render" | "test" | "transaction";

export interface VapEvent {
  at: string;
  kind: VapEventKind;
  tool?: string;
  detail?: unknown;
}

export type ServerEventType =
  | "server"
  | "vap"
  | "compile"
  | "render-progress"
  | "render-done"
  | "render-error"
  | "test-done"
  | "agent-done";

export type ServerEvent =
  | { type: "server"; message: string }
  | { type: "vap"; event: VapEvent }
  | { type: "compile"; ok: boolean; totalFrames: number; durationSeconds: number }
  | { type: "render-progress"; phase: string; frame: number; totalFrames: number }
  | { type: "render-done"; video: string; frames: number; cacheHits: number; cacheMisses: number }
  | { type: "render-error"; error: string }
  | { type: "test-done"; totalPassed: number; totalFailed: number }
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string };

export interface RenderStatus {
  running: boolean;
  startedAt: string | null;
  scene: string | null;
  progress: { phase: string; frame: number; totalFrames: number } | null;
  error: string | null;
}

export interface AssetInfo {
  /** project-relative, includes the leading "assets/" segment */
  rel: string;
  kind: "image" | "audio" | "font";
  size: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentConfig {
  configured: boolean;
  providers: string[];
}

export interface Health {
  ok: boolean;
  server: string;
  version: string;
  project: string | null;
  render: RenderStatus;
  agent: AgentConfig;
  wsConnections: number;
}

export interface AgentExecResult {
  ok: boolean;
  toolCallCount: number;
  steps: Array<{ role: string; content: string; tools: string[] }>;
  summary: string;
}

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface TypingFile {
  path: string;
  content: string;
}

export interface McpInfo {
  command: string;
  cwd: string | null;
  hint: string;
}

export interface RenderStartOptions {
  scene?: string;
  codec?: "h264" | "vp9";
  crf?: number;
  preset?: string;
}

export interface FileContent {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// fetch plumbing
// ---------------------------------------------------------------------------

async function errorBody(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data !== null && typeof data === "object") {
      const err = (data as { error?: unknown }).error;
      if (typeof err === "string") return err;
    }
  } catch {
    // non-JSON body — fall through to the status line
  }
  return `${res.status} ${res.statusText.length > 0 ? res.statusText : "request failed"}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(0, `network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ApiError(res.status, await errorBody(res));
  const data: unknown = await res.json();
  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}

export function getEvents(): Promise<{ events: ServerEvent[] }> {
  return request<{ events: ServerEvent[] }>("/api/events");
}

export function openProject(root: string): Promise<ProjectInfo> {
  return post<ProjectInfo>("/api/project/open", { root });
}

export function initProject(parentDir: string, name: string): Promise<ProjectInfo> {
  return post<ProjectInfo>("/api/project/init", { parentDir, name });
}

export function closeProjectRequest(): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/project/close");
}

export function getProject(): Promise<ProjectInfo> {
  return request<ProjectInfo>("/api/project");
}

export function compile(): Promise<CompileSummary> {
  return post<CompileSummary>("/api/compile");
}

export function getFrameOps(frame: number): Promise<FrameOps> {
  return request<FrameOps>(`/api/frame/${frame}/ops`);
}

/** PNG binary → ImageBitmap (for the preview canvas). */
export async function fetchFrameBitmap(frame: number): Promise<ImageBitmap> {
  let res: Response;
  try {
    res = await fetch(`/api/frame/${frame}`);
  } catch (err) {
    throw new ApiError(0, `network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ApiError(res.status, await errorBody(res));
  const blob = await res.blob();
  return createImageBitmap(blob);
}

export function getFile(path: string): Promise<FileContent> {
  return request<FileContent>(`/api/file?path=${encodeURIComponent(path)}`);
}

export function putFile(path: string, content: string, recompile?: boolean): Promise<SaveFileResult> {
  return put<SaveFileResult>("/api/file", { path, content, ...(recompile === false ? { recompile: false } : {}) });
}

export function getTestFiles(): Promise<{ files: string[] }> {
  return request<{ files: string[] }>("/api/tests");
}

export function runTests(updateGolden: boolean): Promise<QaReport> {
  return post<QaReport>("/api/tests/run", updateGolden ? { updateGolden: true } : {});
}

export function startRender(opts: RenderStartOptions): Promise<{ ok: boolean; startedAt: string }> {
  const body: Record<string, unknown> = {};
  if (opts.scene !== undefined) body.scene = opts.scene;
  if (opts.codec !== undefined) body.codec = opts.codec;
  if (opts.crf !== undefined) body.crf = opts.crf;
  if (opts.preset !== undefined) body.preset = opts.preset;
  return post<{ ok: boolean; startedAt: string }>("/api/render/start", body);
}

export function getRenderStatus(): Promise<RenderStatus> {
  return request<RenderStatus>("/api/render/status");
}

export function getAgentConfig(): Promise<AgentConfig> {
  return request<AgentConfig>("/api/agent/config");
}

export function execAgent(prompt: string, maxSteps?: number): Promise<AgentExecResult> {
  return post<AgentExecResult>("/api/agent/exec", { prompt, ...(maxSteps !== undefined ? { maxSteps } : {}) });
}

export function invokeTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return post<ToolCallResult>("/api/agent/tool", { name, args });
}

export function getTools(): Promise<{ tools: ToolInfo[] }> {
  return request<{ tools: ToolInfo[] }>("/api/tools");
}

export function getTypings(): Promise<{ files: TypingFile[] }> {
  return request<{ files: TypingFile[] }>("/api/typings");
}

export function getAssets(): Promise<{ assets: AssetInfo[] }> {
  return request<{ assets: AssetInfo[] }>("/api/assets");
}

export function getMcp(): Promise<McpInfo> {
  return request<McpInfo>("/api/mcp");
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/**
 * Connect to `ws(s)://<host>/ws` with 2s auto-reconnect.
 * The server broadcasts one ServerEvent JSON object per message.
 * Returns a dispose function.
 */
export function connectWs(
  onEvent: (e: ServerEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let disposed = false;
  let retryTimer: number | undefined;

  const connect = (): void => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.onopen = () => {
      if (!disposed) onStatus?.(true);
    };
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : "";
        const data: unknown = JSON.parse(text);
        if (data !== null && typeof data === "object" && typeof (data as { type?: unknown }).type === "string") {
          onEvent(data as ServerEvent);
        }
      } catch {
        // malformed frame — ignore
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      onStatus?.(false);
      console.warn("[videoos-studio] ws connection lost — reconnecting in 2s");
      retryTimer = window.setTimeout(connect, 2000);
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();
  return () => {
    disposed = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    ws?.close();
  };
}

// ---------------------------------------------------------------------------
// path helpers (server returns absolute paths in several places)
// ---------------------------------------------------------------------------

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s.length > 0);
  return parts.at(-1) ?? p;
}

/** Absolute path inside a project → project-relative path (input already relative passes through). */
export function toProjectRel(p: string, root: string): string {
  const norm = p.replace(/\\/g, "/");
  const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (norm.startsWith(rootNorm + "/")) return norm.slice(rootNorm.length + 1);
  return norm;
}

/** Static URL for a project asset. AssetInfo.rel already starts with "assets/". */
export function assetUrl(rel: string): string {
  return rel.startsWith("assets/") ? `/${rel}` : `/assets/${rel}`;
}
