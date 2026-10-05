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
  | "agent-done"
  | "agent-message";

export type ServerEvent =
  | { type: "server"; message: string }
  | { type: "vap"; event: VapEvent }
  | { type: "compile"; ok: boolean; totalFrames: number; durationSeconds: number }
  | { type: "render-progress"; phase: string; frame: number; totalFrames: number }
  | { type: "render-done"; video: string; frames: number; cacheHits: number; cacheMisses: number }
  | { type: "render-error"; error: string }
  | { type: "test-done"; totalPassed: number; totalFailed: number }
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string }
  | ({ type: "agent-message" } & AgentMessageEventPayload);

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

function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
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
// settings（语言/Agent/Skills/MCP 配置；v0.2 设置中心）
// ---------------------------------------------------------------------------

export type LanguageCode = "zh" | "en";
export type ToolPermissionMode = "allow" | "confirm" | "deny";

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  whitelist: string[];
  timeoutMs: number;
}

export interface StudioSettings {
  language: LanguageCode;
  agent: {
    autonomyLevel: 1 | 2 | 3 | 4;
    maxSteps: number;
    toolPermissions: Record<string, ToolPermissionMode>;
    dangerousCommandPatterns: string[];
  };
  skills: {
    enabled: Record<string, boolean>;
    customDir: string | null;
    autoTrigger: boolean;
  };
  mcp: {
    servers: Record<string, McpServerEntry>;
    mergeTools: boolean;
  };
}

export function getSettings(): Promise<{ settings: StudioSettings }> {
  return request<{ settings: StudioSettings }>("/api/settings");
}

/** 深合并补丁（未提供字段保持不变） */
export function putSettings(patch: Partial<StudioSettings> | Record<string, unknown>): Promise<{ settings: StudioSettings }> {
  return put<{ settings: StudioSettings }>("/api/settings", patch);
}

// ---------------------------------------------------------------------------
// agent WS 频道（agent-message 事件负载；与 packages/server/src/chat/types.ts 同形）
// ---------------------------------------------------------------------------

export type ChatArtifactType = "code" | "preview-frame" | "qa" | "video" | "text";

export interface ChatArtifact {
  type: ChatArtifactType;
  title?: string;
  content?: string;
  language?: string;
  pngBase64?: string;
  report?: unknown;
  path?: string;
}

export type TaskCardStatus = "pending" | "running" | "done" | "failed";

export interface TaskCardEntry {
  id: string;
  step: string;
  label: string;
  status: TaskCardStatus;
  startedAt?: string;
  durationMs?: number;
  artifacts?: ChatArtifact[];
}

export interface ChatUsageMeta {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatToolCallRecord {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: string;
}

export type AgentEventKind = "text" | "tool-start" | "tool-end" | "card" | "done" | "error";

export interface AgentMessageEventPayload {
  sessionId: string;
  runId: string;
  kind: AgentEventKind;
  text?: string;
  tool?: { name: string; args?: unknown };
  toolResult?: { name: string; ok: boolean; durationMs: number; summary?: string; artifact?: ChatArtifact };
  card?: TaskCardEntry;
  ok?: boolean;
  stopped?: boolean;
  usage?: ChatUsageMeta;
  messageId?: string;
  error?: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  runId?: string;
  artifacts?: ChatArtifact[];
  taskCards?: TaskCardEntry[];
  toolCalls?: ChatToolCallRecord[];
  usage?: ChatUsageMeta;
  error?: string;
  stopped?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  projectRoot: string | null;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  projectRoot: string | null;
  updatedAt: string;
  messageCount: number;
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

// ---------------------------------------------------------------------------
// chat sessions / skills / mcp（#51/#52/#53 REST 客户端，追加段 — 不改动上方任何导出）
// ---------------------------------------------------------------------------

/** GET /api/skills 列表项（与 packages/server/src/chat/skills.ts SkillInfo 同形） */
export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  trigger: string;
  /** SKILL.md 所在目录（绝对路径） */
  dir: string;
  source: "builtin" | "custom";
  enabled: boolean;
}

/** MCP 工具摘要（与 packages/server/src/chat/mcp-bridge.ts 同形） */
export interface McpToolSummary {
  name: string;
  description: string;
  server: string;
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  toolCount: number;
  tools: McpToolSummary[];
}

export interface McpBridgeStatus {
  /** @videoos/mcp-host 可解析（false → 面板入口自隐藏，#53） */
  available: boolean;
  running: boolean;
  servers: McpServerStatus[];
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  return request<{ sessions: SessionSummary[] }>("/api/sessions");
}

export function createSession(body: { title?: string; projectRoot?: string }): Promise<{ session: ChatSession }> {
  return post<{ session: ChatSession }>("/api/sessions", body);
}

export function getSession(id: string): Promise<{ session: ChatSession }> {
  return request<{ session: ChatSession }>(`/api/sessions/${encodeURIComponent(id)}`);
}

export function patchSession(id: string, body: { title?: string; projectRoot?: string }): Promise<{ session: ChatSession }> {
  return patch<{ session: ChatSession }>(`/api/sessions/${encodeURIComponent(id)}`, body);
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`);
}

/** 202 异步启动：响应即返回，assistant 内容经 WS agent-message 事件流式回填 */
export function startAgentChat(sessionId: string, message: string): Promise<{ runId: string; sessionId: string; userMessageId: string }> {
  return post<{ runId: string; sessionId: string; userMessageId: string }>("/api/agent/chat", { sessionId, message });
}

export function stopAgentRun(runId: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/agent/stop", { runId });
}

export function listSkills(): Promise<{ skills: SkillInfo[] }> {
  return request<{ skills: SkillInfo[] }>("/api/skills");
}

export function patchSkill(name: string, enabled: boolean): Promise<{ skill: SkillInfo }> {
  return patch<{ skill: SkillInfo }>(`/api/skills/${encodeURIComponent(name)}`, { enabled });
}

export function getMcpStatus(): Promise<{ status: McpBridgeStatus }> {
  return request<{ status: McpBridgeStatus }>("/api/mcp/status");
}

export function getMcpServers(): Promise<{ servers: Record<string, McpServerEntry> }> {
  return request<{ servers: Record<string, McpServerEntry> }>("/api/mcp/servers");
}

export function putMcpServers(servers: Record<string, McpServerEntry>): Promise<{ servers: Record<string, McpServerEntry> }> {
  return put<{ servers: Record<string, McpServerEntry> }>("/api/mcp/servers", { servers });
}
