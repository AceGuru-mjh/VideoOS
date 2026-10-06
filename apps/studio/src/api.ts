// VideoOS Studio — typed API client. Single source of truth for every request
// and response shape of @videoos/server (packages/server/src/app.ts).
// Base URL is "" (same origin): dev via the Vite proxy, prod served by the server.
import type { SettingsPatch, SettingsValues } from "./settings";

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
  // v0.2 §3 chat agent loop (S3)
  | "agent-run-start"
  | "agent-text"
  | "agent-tool"
  | "agent-run-done"
  // v0.2 §6 permission confirm flow (S4, issue #54)
  | "agent-confirm"
  | "agent-resolved";

export type ServerEvent =
  | { type: "server"; message: string }
  | { type: "vap"; event: VapEvent }
  | { type: "compile"; ok: boolean; totalFrames: number; durationSeconds: number }
  | { type: "render-progress"; phase: string; frame: number; totalFrames: number }
  | { type: "render-done"; video: string; frames: number; cacheHits: number; cacheMisses: number }
  | { type: "render-error"; error: string }
  | { type: "test-done"; totalPassed: number; totalFailed: number }
  | { type: "agent-done"; ok: boolean; toolCallCount: number; summary: string }
  | { type: "agent-run-start"; sessionId: string; runId: string }
  | { type: "agent-text"; sessionId: string; runId: string; text: string }
  | { type: "agent-tool"; sessionId: string; runId: string; name: string; args: unknown; status: "start" | "ok" | "error"; durationMs?: number; frame?: number; videoUrl?: string; error?: string; resultSummary?: string }
  | {
      type: "agent-run-done";
      sessionId: string;
      runId: string;
      ok: boolean;
      steps: number;
      usage?: { promptTokens: number; completionTokens: number };
      error?: string;
    }
  // v0.2 §6 确认流（S4）：confirm 类工具挂起 → 聊天内确认卡 → resolve
  | { type: "agent-confirm"; sessionId: string; runId: string; confirmId: string; tool: { name: string; args: unknown } }
  | { type: "agent-resolved"; confirmId: string; decision: "allow" | "always" | "deny" };

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
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // older servers fall back to the SPA index.html (HTTP 200, non-JSON)
    // for endpoints they don't know — surface it as a typed error
    throw new ApiError(res.status, `endpoint not available (non-JSON response): ${path}`);
  }
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

// --- settings (v0.2): tolerant — the endpoint may not exist yet, callers ----
// --- fall back to localStorage mirrors (see store.loadSettings) ------------

/** GET /api/settings → full settings object, or null when unavailable (404/network). */
export async function getSettings(): Promise<SettingsValues | null> {
  try {
    return await request<SettingsValues>("/api/settings");
  } catch {
    return null;
  }
}

/** PATCH /api/settings with per-section partials → saved object, or null on failure. */
export async function patchSettings(patch: SettingsPatch): Promise<SettingsValues | null> {
  try {
    return await request<SettingsValues>("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    return null;
  }
}

/**
 * PATCH /api/settings — throwing variant for the settings center (S6): callers
 * revert the optimistic UI and surface this ApiError as an inline message.
 */
export function patchSettingsStrict(patch: SettingsPatch): Promise<SettingsValues> {
  return request<SettingsValues>("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/**
 * PUT /api/settings — full replace (all nine sections required, strict schema).
 * Throws ApiError on failure. The permission matrix uses this to truly DELETE a
 * toolPermissions override key: PATCH merges per key and its enum schema rejects
 * null, so GET → delete key → PUT is the only removal path (server store.ts).
 */
export function putSettings(values: SettingsValues): Promise<SettingsValues> {
  return put<SettingsValues>("/api/settings", values);
}

/**
 * POST /api/settings/reset — restore sections (all nine when omitted) to the
 * server-side DEFAULT_SETTINGS. Throws ApiError on failure (S6 设置中心).
 */
export function resetSettings(sections?: string[]): Promise<SettingsValues> {
  return post<SettingsValues>("/api/settings/reset", sections === undefined ? {} : { sections });
}

/**
 * GET /api/events → the ring buffer (last 500 server events), or null when
 * unavailable (older server / network down) — the settings log viewer degrades.
 */
export async function fetchEventLog(): Promise<ServerEvent[] | null> {
  try {
    const res = await getEvents();
    return Array.isArray(res.events) ? res.events : [];
  } catch {
    return null;
  }
}

// --- providers (v0.2 S2, issues #46/#48): BYO-LLM provider CRUD + ----------
// --- connection diagnostics. The GET is tolerant (null when the endpoint ---
// --- is not deployed yet / network down) so the wizard can degrade to the -
// --- demo-mode path; mutations and tests throw ApiError with the server's -
// --- readable message. ------------------------------------------------------

export type ProviderType = "openai-compatible" | "anthropic" | "manual" | (string & {});

/** A configured provider as stored on the server (never includes the key). */
export interface ProviderEntry {
  id: string;
  type: ProviderType;
  label?: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  vision?: boolean;
  tools?: boolean;
  // ---- 采样参数与超时（v0.2 §5.2）：全部可选，缺省 = 服务端适配器默认 ----
  /** 采样温度（0-2；缺省用端点默认） */
  temperature?: number;
  /** 单次请求最大输出 token 数（≥1；缺省用端点默认） */
  maxTokens?: number;
  /** 核采样概率 top_p（0-1；缺省用端点默认） */
  topP?: number;
  /** 单次请求超时毫秒（1000-600000；缺省 120000） */
  timeoutMs?: number;
}

/** POST /api/providers entry payload — id/enabled may be omitted (server fills). */
export interface ProviderEntryInput extends Omit<ProviderEntry, "id" | "enabled"> {
  id?: string;
  enabled?: boolean;
}

/** PUT /api/providers/:id 局部更新体：采样参数额外接受 null = 清除（回退服务端默认） */
export type ProviderEntryPatch = Partial<Omit<ProviderEntry, "temperature" | "maxTokens" | "topP" | "timeoutMs">> & {
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  timeoutMs?: number | null;
};

/** One vendor preset from the catalog (server-side `loadCatalog()`). */
export interface CatalogEntry {
  id: string;
  label: string;
  labelZh: string;
  type: ProviderType;
  baseUrl: string;
  suggestedModels: string[];
  keyEnvHint: string;
  local?: boolean;
}

export interface ProviderEntryWithMask extends ProviderEntry {
  /** e.g. "sk-…ab12" — null when no key is stored */
  keyMask: string | null;
}

export interface ProvidersSnapshot {
  catalog: CatalogEntry[];
  entries: ProviderEntryWithMask[];
  defaultProvider: string | null;
  defaultModel: string | null;
  keyEnvHints: Record<string, string>;
}

export interface ProviderMutationResult {
  entry: ProviderEntryWithMask;
  keyMask: string | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: { code: string; message: string };
  hint?: string;
  models?: string[];
}

export type TestProviderBody = { id: string } | { entry: ProviderEntryInput; apiKey?: string };

/** GET /api/providers → catalog + entries + defaults, or null when unavailable
 *  (older server / network) — callers show the degraded banner instead. */
export async function getProviders(): Promise<ProvidersSnapshot | null> {
  try {
    return await request<ProvidersSnapshot>("/api/providers");
  } catch {
    return null;
  }
}

export function createProvider(entry: ProviderEntryInput, apiKey?: string): Promise<ProviderMutationResult> {
  return post<ProviderMutationResult>("/api/providers", { entry, apiKey: apiKey ?? "" });
}

/** PUT /api/providers/:id — apiKey: undefined/"" keeps the stored key, null deletes it; 采样参数传 null = 清除。 */
export function updateProvider(id: string, entry: ProviderEntryPatch, apiKey?: string | null): Promise<ProviderMutationResult> {
  const body: Record<string, unknown> = { entry };
  if (apiKey !== undefined) body.apiKey = apiKey;
  return put<ProviderMutationResult>(`/api/providers/${encodeURIComponent(id)}`, body);
}

export function deleteProvider(id: string): Promise<{ ok?: boolean }> {
  return request<{ ok?: boolean }>(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** POST /api/providers/test — a saved entry (`{id}`) or ad-hoc form values (`{entry, apiKey}`). */
export function testProvider(body: TestProviderBody): Promise<TestResult> {
  return post<TestResult>("/api/providers/test", body);
}

// --- sessions + agent chat (v0.2 S3, issue #49/#50/#51): persisted chat ---
// --- sessions and the async agent loop. GETs are tolerant (null when the ---
// --- endpoint is not deployed yet / network down) so the chat UI can -----
// --- degrade gracefully; mutations throw ApiError with the server's -----
// --- readable "CODE: message" body (409 codes: PROVIDER_NONE, ------------
// --- SESSION_NO_PROJECT, CHAT_RUN_ACTIVE). -------------------------------

/** One persisted tool call inside an assistant message. */
export interface ChatToolCallRecord {
  name: string;
  args: unknown;
  status: "ok" | "error" | "stopped";
  durationMs: number;
  resultSummary?: string;
  frame?: number;
  videoUrl?: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  runId?: string;
  toolCalls?: ChatToolCallRecord[];
  usage?: ChatUsage;
}

export interface SessionRecord {
  id: string;
  title: string;
  projectRoot: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessageRecord[];
}

/** GET /api/sessions list item (no message bodies). */
export interface SessionSummary {
  id: string;
  title: string;
  projectRoot: string | null;
  updatedAt: number;
  messageCount: number;
}

/** GET /api/sessions → list (updatedAt desc), or null when unavailable (older server / network). */
export async function getSessions(): Promise<SessionSummary[] | null> {
  try {
    const list = await request<SessionSummary[]>("/api/sessions");
    return Array.isArray(list) ? list : [];
  } catch {
    return null;
  }
}

/** GET /api/sessions/:id → full record, or null when unavailable. */
export async function getSession(id: string): Promise<SessionRecord | null> {
  try {
    return await request<SessionRecord>(`/api/sessions/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export function createSession(body: { title?: string; projectRoot?: string }): Promise<SessionRecord> {
  const payload: Record<string, string> = {};
  if (body.title !== undefined && body.title.length > 0) payload.title = body.title;
  if (body.projectRoot !== undefined && body.projectRoot.length > 0) payload.projectRoot = body.projectRoot;
  return post<SessionRecord>("/api/sessions", payload);
}

export function patchSession(id: string, patch: { title: string }): Promise<SessionRecord> {
  return request<SessionRecord>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new ApiError(res.status, await errorBody(res));
}

/** POST /api/agent/chat — starts an async run; resolves with {runId}. 4xx → ApiError "CODE: message". */
export function sendChat(body: { sessionId: string; message: string; maxSteps?: number }): Promise<{ runId: string }> {
  const payload: Record<string, unknown> = { sessionId: body.sessionId, message: body.message };
  if (body.maxSteps !== undefined) payload.maxSteps = body.maxSteps;
  return post<{ runId: string }>("/api/agent/chat", payload);
}

export function stopAgentRun(runId?: string): Promise<{ stopped: boolean }> {
  return post<{ stopped: boolean }>("/api/agent/stop", runId !== undefined ? { runId } : {});
}

/** GET /api/agent/run/active → the in-flight run, or null (none / endpoint missing / network down). */
export async function getActiveAgentRun(): Promise<{ runId: string; sessionId: string } | null> {
  try {
    const res = await fetch("/api/agent/run/active");
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trim().length === 0) return null;
    const data: unknown = JSON.parse(text);
    if (data === null || typeof data !== "object") return null;
    const rec = data as { runId?: unknown; sessionId?: unknown };
    if (typeof rec.runId === "string" && typeof rec.sessionId === "string") return { runId: rec.runId, sessionId: rec.sessionId };
    return null;
  } catch {
    return null;
  }
}

/** "CODE: message" error body → "CODE" (only UPPER_SNAKE prefixes), else null. */
export function errorCodePrefix(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const m = /^([A-Z][A-Z0-9_]{2,}):\s/.exec(err.message);
  return m === null ? null : m[1] ?? null;
}

// --- skills / mcp / agent-permissions (v0.2 S4, issues #52/#53/#54): --------
// --- contracts frozen with the S4 server (packages/server chat/skills.ts, ---
// --- chat/mcp.ts, chat/gate.ts, app.ts). GETs are tolerant where the -----
// --- caller degrades; mutations throw ApiError with readable bodies. -------

export interface SkillListItem {
  name: string;
  version: string;
  description: string;
  trigger: string;
  enabled: boolean;
  source: "builtin" | "custom";
}

export interface SkillsSnapshot {
  skills: SkillListItem[];
  autoTrigger: boolean;
  injectRecipes: boolean;
  customDir: string | null;
}

/** GET /api/skills → snapshot, or null when unavailable (older server / network). */
export async function getSkills(): Promise<SkillsSnapshot | null> {
  try {
    return await request<SkillsSnapshot>("/api/skills");
  } catch {
    return null;
  }
}

/** PATCH /api/skills/:name {enabled} → updated entry (404 SKILL_NOT_FOUND). */
export function toggleSkill(name: string, enabled: boolean): Promise<SkillListItem> {
  return request<SkillListItem>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

/** PATCH /api/skills {autoTrigger?, injectRecipes?, customDir?} → updated options. */
export function patchSkillsOptions(
  body: { autoTrigger?: boolean; injectRecipes?: boolean; customDir?: string | null },
): Promise<{ autoTrigger: boolean; injectRecipes: boolean; customDir: string | null }> {
  return request<{ autoTrigger: boolean; injectRecipes: boolean; customDir: string | null }>("/api/skills", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** MCP server status row (GET /api/mcp/status). */
export interface McpServerStatus {
  id: string;
  label?: string;
  enabled: boolean;
  running: boolean;
  toolCount: number;
  lastError?: string;
}

/** Full persisted MCP server entry (GET/PUT /api/mcp/servers). */
export interface McpServerEntry {
  id: string;
  label?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  whitelist: string[];
  timeoutMs: number;
}

/** GET /api/mcp/tools row (unprefixed; merged LLM name = mcp_<serverId>_<name>). */
export interface McpAggregatedTool {
  serverId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * GET /api/mcp/status → {available, servers} | null.
 * null = endpoint missing, network down, or 501 MCP_HOST_UNAVAILABLE
 * (host package absent) — callers treat everything null as “未安装/不可用”.
 */
export async function getMcpStatus(): Promise<{ available: boolean; servers: McpServerStatus[] } | null> {
  try {
    return await request<{ available: boolean; servers: McpServerStatus[] }>("/api/mcp/status");
  } catch {
    return null;
  }
}

export async function getMcpServers(): Promise<McpServerEntry[] | null> {
  try {
    const res = await request<{ servers: McpServerEntry[] }>("/api/mcp/servers");
    return Array.isArray(res.servers) ? res.servers : [];
  } catch {
    return null;
  }
}

/** PUT /api/mcp/servers {servers} — full-list replace; enabled servers (re)start. */
export function putMcpServers(servers: McpServerEntry[]): Promise<{ servers: McpServerEntry[] }> {
  return put<{ servers: McpServerEntry[] }>("/api/mcp/servers", { servers });
}

/** GET /api/mcp/presets → 内置推荐服务器（agent-kit 25 个，静态数据常驻可用，无需 mcp-host）；旧服务端 → null。 */
export async function getMcpPresets(): Promise<{ presets: McpServerEntry[] } | null> {
  try {
    return await request<{ presets: McpServerEntry[] }>("/api/mcp/presets");
  } catch {
    return null;
  }
}

export function mcpServerStart(id: string): Promise<void> {
  return post<void>(`/api/mcp/servers/${encodeURIComponent(id)}/start`);
}

export function mcpServerStop(id: string): Promise<void> {
  return post<void>(`/api/mcp/servers/${encodeURIComponent(id)}/stop`);
}

export async function getMcpTools(): Promise<McpAggregatedTool[] | null> {
  try {
    const tools = await request<McpAggregatedTool[]>("/api/mcp/tools");
    return Array.isArray(tools) ? tools : [];
  } catch {
    return null;
  }
}

/** POST /api/agent/resolve — settle a pending confirm (404 CONFIRM_NOT_FOUND when already settled). */
export function resolveAgentConfirm(confirmId: string, decision: "allow" | "always" | "deny"): Promise<{ resolved: boolean }> {
  return post<{ resolved: boolean }>("/api/agent/resolve", { confirmId, decision });
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
