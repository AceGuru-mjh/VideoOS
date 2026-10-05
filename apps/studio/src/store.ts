// VideoOS Studio — single zustand store: project, compile, editor, player,
// render, tests, events, ws, agent, assets. All server interactions flow
// through actions here; components subscribe via selectors.
import { create } from "zustand";
import * as api from "./api";
import { applyMonacoTheme } from "./monaco-theme";
import { DEFAULT_THEME, isThemeId } from "./themes";
import {
  localSettings,
  normalizeSettings,
  normalizeAgentSection,
  storeOnboardedMirror,
  storeThemeMirror,
  type AgentSection,
  type PermissionDecision,
  type SettingsValues,
} from "./settings";
import { CONFIRM_TIMEOUT_MS } from "./agent-permissions";

export type DockTab = "diagnostics" | "tests" | "agent" | "events";

export type UiMode = "chat" | "ide";

export interface AgentMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  toolCallCount?: number;
  error?: boolean;
}

/** Live tool call while a run is streaming ("start" rows only exist before ok/error). */
export interface LiveToolCall {
  name: string;
  args: unknown;
  status: "start" | "ok" | "error" | "stopped";
  durationMs: number;
  resultSummary?: string;
  frame?: number;
  videoUrl?: string;
  error?: string;
}

/** The chat agent run currently tracked by this client (single active run server-side). */
export interface ActiveRun {
  runId: string;
  sessionId: string;
  /** optimistic user message text (for synthesizing history if the API is down) */
  userText: string;
  status: "running" | "ok" | "error" | "stopped";
  toolCalls: LiveToolCall[];
  text: string;
  steps: number;
  usage: { promptTokens: number; completionTokens: number } | null;
  stopRequested: boolean;
  error: string | null;
}

export interface ChatErrorHint {
  code: string;
  message: string;
}

/** 确认卡（v0.2 §6 issue #54）：confirm 类工具挂起 → 三键裁决 → agent-resolved 同步 */
export interface PendingConfirm {
  confirmId: string;
  sessionId: string;
  runId: string;
  tool: { name: string; args: unknown };
  /** client arrival time of agent-confirm (server has no timestamp on the wire) */
  createdAt: number;
  status: "pending" | "resolved";
  decision?: "allow" | "always" | "deny";
  /** true when the resolution came from a local click (vs WS broadcast) */
  local?: boolean;
  /** heuristic: deny believed to be the 120s timeout (server sends no flag) */
  timeout?: boolean;
  /** run finished while still pending — card expires dimly */
  stale?: boolean;
  resolvedAt?: number;
}

/** drop expired entries (pending > timeout+10s → resolved deny; resolved kept ≤90s) */
function pruneConfirms(list: PendingConfirm[]): PendingConfirm[] {
  const now = Date.now();
  const out: PendingConfirm[] = [];
  for (const c of list) {
    if (c.status === "pending") {
      if (now - c.createdAt > CONFIRM_TIMEOUT_MS + 10_000) {
        out.push({ ...c, status: "resolved", decision: "deny", timeout: true, stale: true, resolvedAt: now });
      } else {
        out.push(c);
      }
    } else if (c.resolvedAt === undefined || now - c.resolvedAt < 90_000) {
      out.push(c);
    }
  }
  return out;
}

/** deny 判定为超时的启发式阈值（server 定时 120s；client 计时略晚于 server 创建） */
const CONFIRM_TIMEOUT_HEURISTIC_MS = 115_000;

export interface RenderResult {
  /** absolute filesystem path — display basename only */
  video: string;
  frames: number;
  cacheHits: number;
  cacheMisses: number;
}

const RECENTS_KEY = "videoos.recents";
const RECENTS_MAX = 8;
const EVENTS_MAX = 200;
const VAP_LOG_MAX = 300;
/** window during which a broadcast "compile" event is considered our own echo */
const COMPILE_ECHO_WINDOW_MS = 1500;
/** window during which a broadcast "agent-done" event is considered our own echo */
const AGENT_ECHO_WINDOW_MS = 1500;

let messageSeq = 0;
function nextMessageId(): number {
  messageSeq += 1;
  return messageSeq;
}

let localChatId = 0;
function nextLocalChatId(): string {
  localChatId += 1;
  return `local-${localChatId}`;
}

const UI_MODE_KEY = "videoos.uiMode";

function readUiMode(): UiMode {
  try {
    return window.localStorage.getItem(UI_MODE_KEY) === "ide" ? "ide" : "chat";
  } catch {
    return "chat";
  }
}

function writeUiMode(mode: UiMode): void {
  try {
    window.localStorage.setItem(UI_MODE_KEY, mode);
  } catch {
    // storage unavailable — mode persists per-session only
  }
}

function summaryOf(record: api.SessionRecord): api.SessionSummary {
  return {
    id: record.id,
    title: record.title,
    projectRoot: record.projectRoot,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
  };
}

function sortSessions(list: api.SessionSummary[]): api.SessionSummary[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** move a session to the top of the list with a fresh updatedAt */
function bumpSession(list: api.SessionSummary[], id: string): api.SessionSummary[] {
  const now = Date.now();
  return list
    .map((s) => (s.id === id ? { ...s, updatedAt: now } : s))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** merge streamed assistant text: a later event either extends the same turn
 *  (full-text-so-far) or starts a new turn — join turns with a blank line. */
function mergeStreamedText(prev: string, next: string): string {
  if (prev.length === 0) return next;
  if (next.startsWith(prev)) return next;
  return `${prev}\n\n${next}`;
}

function adoptRun(runId: string, sessionId: string): ActiveRun {
  return {
    runId,
    sessionId,
    userText: "",
    status: "running",
    toolCalls: [],
    text: "",
    steps: 0,
    usage: null,
    stopRequested: false,
    error: null,
  };
}

/** Build the persisted-shape assistant message from a finished live run. */
function synthAssistantMessage(run: ActiveRun): api.ChatMessageRecord {
  const toolCalls: api.ChatToolCallRecord[] = run.toolCalls.map((tc) => ({
    name: tc.name,
    args: tc.args,
    status: tc.status === "start" ? "stopped" : tc.status,
    durationMs: tc.durationMs,
    ...(tc.resultSummary !== undefined ? { resultSummary: tc.resultSummary } : {}),
    ...(tc.frame !== undefined ? { frame: tc.frame } : {}),
    ...(tc.videoUrl !== undefined ? { videoUrl: tc.videoUrl } : {}),
  }));
  return {
    id: `local-run-${run.runId}`,
    role: "assistant",
    content: run.text,
    createdAt: Date.now(),
    runId: run.runId,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(run.usage !== null ? { usage: run.usage } : {}),
  };
}

function chatErrorFrom(err: unknown): ChatErrorHint {
  return { code: api.errorCodePrefix(err) ?? "ERROR", message: api.errorMessage(err) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((v): v is string => typeof v === "string").slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    // storage unavailable (private mode) — recents just won't persist
  }
}

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const rest: Record<string, T> = {};
  for (const k of Object.keys(obj)) {
    if (k !== key) rest[k] = obj[k];
  }
  return rest;
}

function parseToolArgs(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const data: unknown = trimmed.length === 0 ? {} : JSON.parse(trimmed);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("args must be a JSON object");
  }
  return data as Record<string, unknown>;
}

interface StudioState {
  // boot / project
  booted: boolean;
  booting: boolean;
  serverVersion: string;
  project: api.ProjectInfo | null;
  recents: string[];
  projectError: string | null;

  // compile
  compile: api.CompileSummary | null;
  compiling: boolean;
  compileError: string | null;
  /** true while one of OUR requests is compiling server-side (WS echo guard) */
  compileInFlight: boolean;

  // editor
  openTabs: string[];
  activeTab: string | null;
  dirty: Record<string, boolean>;
  contents: Record<string, string>;
  fileErrors: Record<string, string>;
  saving: boolean;
  saveError: string | null;

  // player
  currentFrame: number;
  playing: boolean;
  loop: boolean;
  boundsEnabled: boolean;

  // dock
  dockTab: DockTab;

  // render
  renderDialogOpen: boolean;
  renderStatus: api.RenderStatus | null;
  renderStarting: boolean;
  lastRender: RenderResult | null;
  renderError: string | null;

  // tests
  tests: api.QaReport | null;
  testsRunning: boolean;
  updateGolden: boolean;
  testsError: string | null;

  // events / ws
  events: api.ServerEvent[];
  eventFilter: string;
  wsConnected: boolean;
  wsCount: number;

  // agent
  agentConfig: api.AgentConfig | null;
  agentMessages: AgentMessage[];
  agentRunning: boolean;
  /** true while our own /api/agent/exec is running (WS echo guard) */
  agentExecInFlight: boolean;
  vapLog: api.VapEvent[];
  tools: api.ToolInfo[] | null;
  toolsOpen: boolean;
  toolResult: { name: string; json: string } | null;
  toolError: string | null;

  // assets / mcp
  assets: api.AssetInfo[] | null;
  assetsLoading: boolean;
  mcpInfo: api.McpInfo | null;

  // settings (v0.2) + first-run wizard
  settings: { values: SettingsValues | null };
  wizardActive: boolean;

  // chat (v0.2 §3) — sessions, messages, live agent run, ui mode
  uiMode: UiMode;
  sessions: api.SessionSummary[];
  sessionsUnavailable: boolean;
  currentSessionId: string | null;
  currentSession: api.SessionRecord | null;
  sessionLoadError: string | null;
  messages: api.ChatMessageRecord[];
  activeRun: ActiveRun | null;
  chatError: ChatErrorHint | null;
  composerDraft: string;
  composerFocusToken: number;
  sending: boolean;

  // ---- S4 (v0.2 §6): skills / mcp / permissions / confirm flow ----
  /** skills slide-over panel (left footer chip) */
  skillsOpen: boolean;
  skills: { loading: boolean; attempted: boolean; error: string | null; snapshot: api.SkillsSnapshot | null };
  /** mcp slide-over panel + 未安装 popover (left footer chip) */
  mcpOpen: boolean;
  mcpPopoverOpen: boolean;
  mcp: {
    phase: "unknown" | "checking" | "unavailable" | "available";
    status: api.McpServerStatus[] | null;
    entries: api.McpServerEntry[] | null;
    tools: api.McpAggregatedTool[] | null;
    /** serverId currently being toggled / started / stopped */
    busy: string | null;
  };
  /** Agent 权限 modal (left footer chip) */
  permissionsOpen: boolean;
  permissionsError: string | null;
  /** in-chat confirm cards (per run; rendered under the live TaskCard) */
  pendingConfirms: PendingConfirm[];

  // ---- actions ----
  boot: () => Promise<void>;
  /** health + hydrate; never throws (surfaces via projectError) */
  bootServer: () => Promise<void>;
  loadSettings: () => Promise<void>;
  /** apply a theme globally (DOM + Monaco + localStorage mirror) and PATCH it */
  setTheme: (id: string) => void;
  setOnboarded: (value: boolean) => void;
  setWizardActive: (open: boolean) => void;
  setUiMode: (mode: UiMode) => void;
  hydrate: (info?: api.ProjectInfo) => Promise<void>;
  openProject: (root: string) => Promise<void>;
  initProject: (parentDir: string, name: string) => Promise<void>;
  closeProject: () => Promise<void>;
  runCompile: () => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  markDirty: (path: string, isDirty: boolean) => void;
  seekFrame: (n: number) => void;
  setPlaying: (playing: boolean) => void;
  toggleLoop: () => void;
  toggleBounds: () => void;
  setDockTab: (tab: DockTab) => void;
  openRenderDialog: (open: boolean) => void;
  startRender: (opts: api.RenderStartOptions) => Promise<void>;
  refreshRenderStatus: () => Promise<void>;
  runTests: () => Promise<void>;
  setUpdateGolden: (value: boolean) => void;
  loadAgentConfig: () => Promise<void>;
  execAgent: (prompt: string) => Promise<void>;
  loadTools: () => Promise<void>;
  setToolsOpen: (open: boolean) => void;
  invokeTool: (name: string, argsJson: string) => Promise<void>;
  loadAssets: () => Promise<void>;
  loadMcp: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  backfillEvents: () => Promise<void>;
  pushEvent: (e: api.ServerEvent) => void;
  handleEvent: (e: api.ServerEvent) => void;
  setWs: (connected: boolean) => void;
  setWsCount: (count: number) => void;
  setEventFilter: (filter: string) => void;

  // ---- chat (v0.2 §3) ----
  /** sessions + auto-select the most recent one + active-run catch-up (boot) */
  initChat: () => Promise<void>;
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  /** create a session (binds the currently open project when known) */
  newSession: (titleHint?: string) => Promise<api.SessionRecord | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopRun: () => Promise<void>;
  /** re-sync chat state after a ws gap (reconnect / refresh mid-run) */
  resyncChat: () => Promise<void>;
  /** internal: replace the live run with the persisted session record */
  finalizeRun: (runId: string) => Promise<void>;
  setComposerDraft: (text: string) => void;
  focusComposer: () => void;

  // ---- S4: skills / mcp / permissions / confirm flow (v0.2 §6) ----
  /** load the skills snapshot once per session (composer autocomplete roster) */
  ensureSkills: () => Promise<void>;
  loadSkills: (force: boolean) => Promise<void>;
  openSkillsPanel: () => void;
  closeSkillsPanel: () => void;
  toggleSkill: (name: string, enabled: boolean) => Promise<void>;
  setSkillsAutoTrigger: (value: boolean) => Promise<void>;
  /** append `@name ` to the composer draft + focus (Skills panel @ 引用) */
  mentionSkill: (name: string) => void;
  /** chip click: status probe → open panel (available) or 未安装 popover */
  openMcpPanel: () => Promise<void>;
  closeMcpPanel: () => void;
  setMcpPopover: (open: boolean) => void;
  refreshMcp: () => Promise<void>;
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>;
  mcpStartServer: (id: string) => Promise<void>;
  mcpStopServer: (id: string) => Promise<void>;
  /** settings.mcp.mergeTools toggle (patchSettings) */
  setMcpMergeTools: (value: boolean) => void;
  openPermissions: () => void;
  closePermissions: () => void;
  setPermissionsError: (message: string | null) => void;
  /** merge a partial agent settings section (autonomy/confirmRender/dangerousPatterns/…) */
  updateAgent: (patch: Partial<AgentSection>) => Promise<void>;
  /** per-tool override; value=null clears (GET→PUT full replace — PATCH can't delete keys) */
  setToolPermission: (name: string, value: PermissionDecision | null) => Promise<void>;
  /** user clicked 允许本次/总是允许/拒绝 on a confirm card */
  resolveConfirm: (confirmId: string, decision: "allow" | "always" | "deny") => Promise<void>;
}

export const useStudio = create<StudioState>()((set, get) => ({
  booted: false,
  booting: false,
  serverVersion: "",
  project: null,
  recents: [],
  projectError: null,

  compile: null,
  compiling: false,
  compileError: null,
  compileInFlight: false,

  openTabs: [],
  activeTab: null,
  dirty: {},
  contents: {},
  fileErrors: {},
  saving: false,
  saveError: null,

  currentFrame: 0,
  playing: false,
  loop: true,
  boundsEnabled: false,

  dockTab: "diagnostics",

  renderDialogOpen: false,
  renderStatus: null,
  renderStarting: false,
  lastRender: null,
  renderError: null,

  tests: null,
  testsRunning: false,
  updateGolden: false,
  testsError: null,

  events: [],
  eventFilter: "all",
  wsConnected: false,
  wsCount: 0,

  agentConfig: null,
  agentMessages: [],
  agentRunning: false,
  agentExecInFlight: false,
  vapLog: [],
  tools: null,
  toolsOpen: false,
  toolResult: null,
  toolError: null,

  assets: null,
  assetsLoading: false,
  mcpInfo: null,

  settings: { values: null },
  wizardActive: false,

  uiMode: readUiMode(),
  sessions: [],
  sessionsUnavailable: false,
  currentSessionId: null,
  currentSession: null,
  sessionLoadError: null,
  messages: [],
  activeRun: null,
  chatError: null,
  composerDraft: "",
  composerFocusToken: 0,
  sending: false,

  skillsOpen: false,
  skills: { loading: false, attempted: false, error: null, snapshot: null },
  mcpOpen: false,
  mcpPopoverOpen: false,
  mcp: { phase: "unknown", status: null, entries: null, tools: null, busy: null },
  permissionsOpen: false,
  permissionsError: null,
  pendingConfirms: [],

  // ---- boot -------------------------------------------------------------
  boot: async () => {
    set({ booting: true, recents: readRecents() });
    // settings first — theme applies ASAP; server boot continues after
    await get().loadSettings();
    const values = get().settings.values ?? localSettings();
    const forcedWizard = new URLSearchParams(window.location.search).get("wizard") === "1";
    if (forcedWizard || !values.general.onboarded) {
      // show the wizard right away; keep booting the server in the background
      // so the workspace is ready the moment the wizard exits
      set({ wizardActive: true });
      void get()
        .bootServer()
        .finally(() => set({ booted: true, booting: false }));
      return;
    }
    await get().bootServer();
    set({ booted: true, booting: false });
  },

  bootServer: async () => {
    try {
      const health = await api.getHealth();
      set({ serverVersion: health.version, wsCount: health.wsConnections });
      if (health.project !== null) await get().hydrate();
    } catch (err) {
      set({ projectError: `cannot reach videoos server: ${api.errorMessage(err)}` });
    }
    // chat state loads in the background — chat-first shell renders as soon as boot ends
    void get().initChat();
  },

  // ---- settings / theme --------------------------------------------------
  loadSettings: async () => {
    const remote = await api.getSettings(); // tolerant → null on 404/network
    const values = remote === null ? localSettings() : normalizeSettings(remote);
    const theme = isThemeId(values.general.theme) ? values.general.theme : DEFAULT_THEME;
    values.general.theme = theme;
    document.documentElement.dataset.theme = theme;
    applyMonacoTheme(theme, values.interface.codeTheme.length > 0 ? values.interface.codeTheme : "auto");
    set({ settings: { values } });
  },

  setTheme: (id) => {
    const theme = isThemeId(id) ? id : DEFAULT_THEME;
    document.documentElement.dataset.theme = theme;
    storeThemeMirror(theme);
    set((s) => {
      const values = s.settings.values ?? localSettings();
      return {
        settings: { values: { ...values, general: { ...values.general, theme } } },
      };
    });
    const codeTheme = useStudio.getState().settings.values?.interface.codeTheme ?? "auto";
    applyMonacoTheme(theme, codeTheme);
    // best-effort persist; the localStorage mirror already covers the failure case
    void api.patchSettings({ general: { theme } });
  },

  setOnboarded: (value) => {
    storeOnboardedMirror(value);
    set((s) => {
      const values = s.settings.values ?? localSettings();
      return {
        settings: { values: { ...values, general: { ...values.general, onboarded: value } } },
        wizardActive: false,
      };
    });
    void api.patchSettings({ general: { onboarded: value } });
  },

  setWizardActive: (open) => set({ wizardActive: open }),

  setUiMode: (mode) => {
    writeUiMode(mode);
    set({ uiMode: mode });
  },

  /** Load everything a workspace needs once a project is open. */
  hydrate: async (info) => {
    let project: api.ProjectInfo;
    try {
      project = info ?? await api.getProject();
    } catch (err) {
      // health claimed a project but it's gone (409) — back to Welcome
      set({ project: null, projectError: api.errorMessage(err) });
      return;
    }
    set({
      project,
      projectError: null,
      openTabs: [project.entry],
      activeTab: project.entry,
      dirty: {},
      contents: {},
      fileErrors: {},
      compile: null,
      compileError: null,
      tests: null,
      testsError: null,
      currentFrame: 0,
      playing: false,
      lastRender: null,
      renderStatus: null,
      renderError: null,
      agentMessages: [],
      vapLog: [],
      tools: null,
      assets: null,
      mcpInfo: null,
    });
    const recents = [project.root, ...readRecents().filter((r) => r !== project.root)].slice(0, RECENTS_MAX);
    writeRecents(recents);
    set({ recents });
    await get().loadFile(project.entry);
    await get().runCompile();
    await Promise.allSettled([get().loadAssets(), get().loadAgentConfig(), get().loadMcp()]);
  },

  openProject: async (root) => {
    set({ projectError: null });
    try {
      const info = await api.openProject(root);
      await get().hydrate(info);
    } catch (err) {
      set({ projectError: api.errorMessage(err) });
    }
  },

  initProject: async (parentDir, name) => {
    set({ projectError: null });
    try {
      const info = await api.initProject(parentDir, name);
      await get().hydrate(info);
    } catch (err) {
      set({ projectError: api.errorMessage(err) });
    }
  },

  closeProject: async () => {
    try {
      await api.closeProjectRequest();
    } catch {
      // server may already have closed it
    }
    set({
      project: null,
      compile: null,
      compileError: null,
      openTabs: [],
      activeTab: null,
      dirty: {},
      contents: {},
      fileErrors: {},
      currentFrame: 0,
      playing: false,
      tests: null,
      testsError: null,
      lastRender: null,
      renderStatus: null,
      renderError: null,
      agentMessages: [],
      vapLog: [],
      tools: null,
      assets: null,
      mcpInfo: null,
    });
  },

  // ---- compile ----------------------------------------------------------
  runCompile: async () => {
    set({ compiling: true, compileError: null, compileInFlight: true });
    try {
      const summary = await api.compile();
      set({ compile: summary, compileError: summary.ok ? null : (summary.error ?? null) });
    } catch (err) {
      set({ compileError: api.errorMessage(err) });
    } finally {
      set({ compiling: false });
      window.setTimeout(() => set({ compileInFlight: false }), COMPILE_ECHO_WINDOW_MS);
    }
  },

  saveFile: async (path, content) => {
    set({ saving: true, saveError: null, compileInFlight: true });
    try {
      const res = await api.putFile(path, content);
      set((s) => ({ contents: { ...s.contents, [path]: content } }));
      if (res.compiled) {
        set({
          compile: {
            ok: res.ok ?? false,
            vir: res.vir ?? null,
            diagnostics: res.diagnostics ?? [],
            totalFrames: res.totalFrames ?? 0,
            durationSeconds: res.durationSeconds ?? 0,
            fps: res.fps,
            width: res.width,
            height: res.height,
            error: res.error,
          },
          compileError: (res.ok ?? false) ? null : (res.error ?? null),
        });
      }
    } catch (err) {
      set({ saveError: api.errorMessage(err) });
    } finally {
      set({ saving: false });
      window.setTimeout(() => set({ compileInFlight: false }), COMPILE_ECHO_WINDOW_MS);
    }
  },

  // ---- editor -----------------------------------------------------------
  loadFile: async (path) => {
    set((s) => ({
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activeTab: path,
    }));
    try {
      const file = await api.getFile(path);
      set((s) => ({ contents: { ...s.contents, [path]: file.content }, fileErrors: omitKey(s.fileErrors, path) }));
    } catch (err) {
      set((s) => ({ fileErrors: { ...s.fileErrors, [path]: api.errorMessage(err) } }));
    }
  },

  openTab: (path) => {
    set((s) => ({
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activeTab: path,
    }));
  },

  closeTab: (path) => {
    set((s) => {
      const tabs = s.openTabs.filter((t) => t !== path);
      const activeTab = s.activeTab === path ? (tabs.length > 0 ? tabs[tabs.length - 1] : null) : s.activeTab;
      return { openTabs: tabs, activeTab };
    });
  },

  setActiveTab: (path) => set({ activeTab: path }),

  markDirty: (path, isDirty) => set((s) => ({ dirty: { ...s.dirty, [path]: isDirty } })),

  // ---- player -----------------------------------------------------------
  seekFrame: (n) =>
    set((s) => {
      const total = s.compile?.totalFrames ?? 0;
      const max = Math.max(0, total - 1);
      return { currentFrame: Math.max(0, Math.min(Math.round(n), max)) };
    }),

  setPlaying: (playing) => set({ playing }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  toggleBounds: () => set((s) => ({ boundsEnabled: !s.boundsEnabled })),

  setDockTab: (dockTab) => set({ dockTab }),

  // ---- render -----------------------------------------------------------
  openRenderDialog: (open) => {
    set({ renderDialogOpen: open });
    if (open) void get().refreshRenderStatus();
  },

  startRender: async (opts) => {
    set({ renderStarting: true, renderError: null });
    try {
      await api.startRender(opts);
      set({
        renderStatus: { running: true, startedAt: new Date().toISOString(), scene: opts.scene ?? null, progress: null, error: null },
      });
    } catch (err) {
      set({ renderError: api.errorMessage(err) });
    } finally {
      set({ renderStarting: false });
    }
  },

  refreshRenderStatus: async () => {
    try {
      set({ renderStatus: await api.getRenderStatus() });
    } catch {
      // no project open — nothing to refresh
    }
  },

  // ---- tests ------------------------------------------------------------
  runTests: async () => {
    set({ testsRunning: true, testsError: null });
    try {
      set({ tests: await api.runTests(get().updateGolden) });
    } catch (err) {
      set({ testsError: api.errorMessage(err) });
    } finally {
      set({ testsRunning: false });
    }
  },

  setUpdateGolden: (value) => set({ updateGolden: value }),

  // ---- agent ------------------------------------------------------------
  loadAgentConfig: async () => {
    try {
      set({ agentConfig: await api.getAgentConfig() });
    } catch {
      // health check already surfaces server reachability
    }
  },

  execAgent: async (prompt) => {
    set((s) => ({
      agentMessages: [...s.agentMessages, { id: nextMessageId(), role: "user", text: prompt }],
      agentRunning: true,
      agentExecInFlight: true,
    }));
    try {
      const res = await api.execAgent(prompt);
      set((s) => ({
        agentMessages: [
          ...s.agentMessages,
          { id: nextMessageId(), role: "agent", text: res.summary.length > 0 ? res.summary : "(no summary)", toolCallCount: res.toolCallCount },
        ],
      }));
    } catch (err) {
      set((s) => ({
        agentMessages: [...s.agentMessages, { id: nextMessageId(), role: "agent", text: api.errorMessage(err), error: true }],
      }));
    } finally {
      set({ agentRunning: false });
      window.setTimeout(() => set({ agentExecInFlight: false }), AGENT_ECHO_WINDOW_MS);
    }
  },

  loadTools: async () => {
    if (get().tools !== null) return;
    try {
      const res = await api.getTools();
      set({ tools: res.tools });
    } catch {
      // tools list is optional — invoker stays empty
    }
  },

  setToolsOpen: (open) => set({ toolsOpen: open }),

  invokeTool: async (name, argsJson) => {
    set({ toolError: null, toolResult: null });
    let args: Record<string, unknown>;
    try {
      args = parseToolArgs(argsJson);
    } catch (err) {
      set({ toolError: `invalid args JSON: ${api.errorMessage(err)}` });
      return;
    }
    try {
      const res = await api.invokeTool(name, args);
      if (res.ok) {
        set({ toolResult: { name, json: JSON.stringify(res.data ?? res, null, 2) } });
      } else {
        set({ toolError: res.error ?? "tool call failed", toolResult: { name, json: JSON.stringify(res, null, 2) } });
      }
    } catch (err) {
      set({ toolError: api.errorMessage(err) });
    }
  },

  // ---- assets / mcp ------------------------------------------------------
  loadAssets: async () => {
    set({ assetsLoading: true });
    try {
      set({ assets: (await api.getAssets()).assets });
    } catch {
      // assets stay empty on error
    } finally {
      set({ assetsLoading: false });
    }
  },

  loadMcp: async () => {
    try {
      set({ mcpInfo: await api.getMcp() });
    } catch {
      // hint stays hidden
    }
  },

  /** Re-fetch the content of every open, non-dirty tab (after agent edits). */
  refreshFiles: async () => {
    const s = get();
    if (s.project === null) return;
    const paths = s.openTabs.filter((p) => !(s.dirty[p] ?? false));
    for (const path of paths) {
      try {
        const file = await api.getFile(path);
        useStudio.setState((st) => ({ contents: { ...st.contents, [path]: file.content } }));
      } catch {
        // file may have been removed — keep the stale content
      }
    }
  },

  // ---- events / ws -------------------------------------------------------
  backfillEvents: async () => {
    try {
      const res = await api.getEvents();
      set({ events: res.events.slice(-EVENTS_MAX) });
    } catch {
      // backlog is best-effort
    }
  },

  pushEvent: (e) => set((s) => ({ events: [...s.events.slice(-(EVENTS_MAX - 1)), e] })),

  handleEvent: (e) => {
    get().pushEvent(e);
    switch (e.type) {
      case "server":
        break;
      case "vap": {
        set((s) => ({ vapLog: [...s.vapLog.slice(-(VAP_LOG_MAX - 1)), e.event] }));
        // agent-triggered compile (tool compile.run / file writes) → refresh
        if (e.event.kind === "compile" && !get().compileInFlight) {
          void get().runCompile();
          void get().refreshFiles();
        }
        break;
      }
      case "compile": {
        if (!get().compileInFlight) {
          void get().runCompile();
          void get().refreshFiles();
        }
        break;
      }
      case "render-progress": {
        set((s) => ({
          renderStatus: {
            running: true,
            startedAt: s.renderStatus?.startedAt ?? null,
            scene: s.renderStatus?.scene ?? null,
            progress: { phase: e.phase, frame: e.frame, totalFrames: e.totalFrames },
            error: null,
          },
        }));
        break;
      }
      case "render-done": {
        set({
          lastRender: { video: e.video, frames: e.frames, cacheHits: e.cacheHits, cacheMisses: e.cacheMisses },
          renderStatus: { running: false, startedAt: null, scene: null, progress: null, error: null },
          renderError: null,
        });
        break;
      }
      case "render-error": {
        set({
          renderError: e.error,
          renderStatus: { running: false, startedAt: null, scene: null, progress: null, error: e.error },
        });
        break;
      }
      case "test-done":
        break;
      case "agent-done": {
        if (!get().agentExecInFlight) {
          set((s) => ({
            agentMessages: [
              ...s.agentMessages,
              {
                id: nextMessageId(),
                role: "agent",
                text: e.summary.length > 0 ? e.summary : "(external agent run finished)",
                toolCallCount: e.toolCallCount,
                ...(e.ok ? {} : { error: true }),
              },
            ],
          }));
        }
        break;
      }
      // ---- chat agent loop (v0.2 §3): stream into the live run card ----
      case "agent-run-start": {
        set((s) => ({ sessions: bumpSession(s.sessions, e.sessionId) }));
        const cur = get().activeRun;
        if (cur !== null && cur.runId === e.runId) break;
        // don't resurrect a run whose result is already in the visible history
        // (event backlog replay after a ws reconnect)
        if (e.sessionId === get().currentSessionId && get().messages.some((m) => m.runId === e.runId)) break;
        set({ activeRun: adoptRun(e.runId, e.sessionId) });
        break;
      }
      case "agent-text": {
        const cur = get().activeRun;
        if (cur === null || cur.runId !== e.runId) break;
        set((s) => ({
          sessions: bumpSession(s.sessions, e.sessionId),
          activeRun: { ...cur, text: mergeStreamedText(cur.text, e.text) },
        }));
        break;
      }
      case "agent-tool": {
        const cur = get().activeRun;
        if (cur === null || cur.runId !== e.runId) break;
        const toolCalls = cur.toolCalls.slice();
        let openIdx = -1;
        for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
          if (toolCalls[i].name === e.name && toolCalls[i].status === "start") {
            openIdx = i;
            break;
          }
        }
        if (e.status === "start") {
          toolCalls.push({ name: e.name, args: e.args, status: "start", durationMs: 0 });
        } else {
          const row: LiveToolCall = {
            name: e.name,
            args: e.args,
            status: e.status,
            durationMs: e.durationMs ?? 0,
            ...(e.resultSummary !== undefined ? { resultSummary: e.resultSummary } : {}),
            ...(e.frame !== undefined ? { frame: e.frame } : {}),
            ...(e.videoUrl !== undefined ? { videoUrl: e.videoUrl } : {}),
            ...(e.error !== undefined ? { error: e.error } : {}),
          };
          if (openIdx >= 0) toolCalls[openIdx] = row;
          else toolCalls.push(row);
        }
        set((s) => ({
          sessions: bumpSession(s.sessions, e.sessionId),
          activeRun: { ...cur, toolCalls },
        }));
        break;
      }
      case "agent-run-done": {
        const cur = get().activeRun;
        if (cur !== null && cur.runId === e.runId) {
          const stopped = cur.stopRequested || /stop|abort|cancel|中断/i.test(e.error ?? "");
          set({
            activeRun: {
              ...cur,
              status: e.ok ? "ok" : stopped ? "stopped" : "error",
              steps: e.steps,
              usage: e.usage ?? cur.usage,
              error: e.error ?? null,
            },
          });
          void get().finalizeRun(e.runId);
        } else {
          set((s) => ({ sessions: bumpSession(s.sessions, e.sessionId) }));
        }
        break;
      }
      // ---- S4 确认流 (v0.2 §6)：confirm 类工具挂起 → 确认卡 → agent-resolved 同步 ----
      case "agent-confirm": {
        const entry: PendingConfirm = {
          confirmId: e.confirmId,
          sessionId: e.sessionId,
          runId: e.runId,
          tool: e.tool,
          createdAt: Date.now(),
          status: "pending",
        };
        set((s) => ({ pendingConfirms: pruneConfirms([...s.pendingConfirms, entry]) }));
        break;
      }
      case "agent-resolved": {
        set((s) => ({
          pendingConfirms: pruneConfirms(
            s.pendingConfirms.map((c) => {
              if (c.confirmId !== e.confirmId) return c;
              if (c.status === "resolved" && c.local !== true) return c; // already authoritative
              const fromLocal = c.local === true;
              return {
                ...c,
                status: "resolved" as const,
                decision: e.decision,
                local: false,
                timeout: e.decision === "deny" && !fromLocal && Date.now() - c.createdAt >= CONFIRM_TIMEOUT_HEURISTIC_MS,
                resolvedAt: Date.now(),
              };
            }),
          ),
        }));
        break;
      }
    }
  },

  setWs: (connected) => set({ wsConnected: connected }),
  setWsCount: (count) => set({ wsCount: count }),
  setEventFilter: (filter) => set({ eventFilter: filter }),

  // ---- chat (v0.2 §3) ----------------------------------------------------

  initChat: async () => {
    await get().loadSessions();
    const s = get();
    if (s.currentSessionId === null && s.sessions.length > 0) {
      await get().selectSession(s.sessions[0].id);
    }
    // skills roster loads in the background — the composer @ autocomplete
    // and the Skills panel both consume it
    void get().ensureSkills();
    // active-run catch-up: a run may be in flight (page refresh / second tab);
    // live events may be gone — the UI degrades to a "running" spinner card.
    const active = await api.getActiveAgentRun();
    if (active !== null && get().activeRun === null) {
      set({ activeRun: adoptRun(active.runId, active.sessionId) });
    }
  },

  loadSessions: async () => {
    const list = await api.getSessions();
    if (list === null) {
      set({ sessionsUnavailable: true });
      return;
    }
    set({ sessions: sortSessions(list), sessionsUnavailable: false });
  },

  selectSession: async (id) => {
    if (get().currentSessionId === id) return;
    set({ currentSessionId: id, currentSession: null, messages: [], sessionLoadError: null, chatError: null });
    const record = await api.getSession(id);
    if (useStudio.getState().currentSessionId !== id) return; // switched away while loading
    if (record === null) {
      // bare error code — localized at render time via t(`errors.SESSIONS_LOAD_FAILED`)
      set({ sessionLoadError: "SESSIONS_LOAD_FAILED" });
      return;
    }
    set({ currentSession: record, messages: record.messages, sessionLoadError: null });
  },

  newSession: async (titleHint) => {
    try {
      const projectRoot = get().project?.root;
      const record = await api.createSession({
        ...(titleHint !== undefined && titleHint.trim().length > 0 ? { title: titleHint.trim().slice(0, 24) } : {}),
        ...(projectRoot !== undefined ? { projectRoot } : {}),
      });
      set((s) => ({
        currentSessionId: record.id,
        currentSession: record,
        messages: record.messages,
        sessionLoadError: null,
        chatError: null,
        sessions: sortSessions([summaryOf(record), ...s.sessions.filter((x) => x.id !== record.id)]),
      }));
      return record;
    } catch (err) {
      set({ chatError: chatErrorFrom(err) });
      return null;
    }
  },

  renameSession: async (id, title) => {
    const clean = title.trim();
    if (clean.length === 0) return;
    try {
      const record = await api.patchSession(id, { title: clean });
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: record.title } : x)),
        currentSession: s.currentSession !== null && s.currentSession.id === id ? { ...s.currentSession, title: record.title } : s.currentSession,
      }));
    } catch (err) {
      set({ chatError: chatErrorFrom(err) });
    }
  },

  deleteSession: async (id) => {
    try {
      await api.deleteSession(id);
    } catch (err) {
      set({ chatError: chatErrorFrom(err) });
      return;
    }
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      ...(s.currentSessionId === id
        ? { currentSessionId: null, currentSession: null, messages: [], sessionLoadError: null }
        : {}),
    }));
    const next = get();
    if (next.currentSessionId === null && next.sessions.length > 0) {
      await get().selectSession(next.sessions[0].id);
    }
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || get().sending) return;
    const run = get().activeRun;
    if (run !== null && run.status === "running") {
      set({ chatError: { code: "CHAT_RUN_ACTIVE", message: "agent run active" } });
      return;
    }
    let sessionId = get().currentSessionId;
    if (sessionId === null) {
      // first message without a session — create one bound to the open project
      const created = await get().newSession(trimmed);
      if (created === null) return;
      sessionId = created.id;
    }
    const optimistic: api.ChatMessageRecord = {
      id: nextLocalChatId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    set((s) => ({
      messages: [...s.messages, optimistic],
      chatError: null,
      composerDraft: "",
      sending: true,
    }));
    try {
      const res = await api.sendChat({ sessionId, message: trimmed });
      // a ws agent-run-start may have landed first — keep any streamed content
      set((s) => ({
        sending: false,
        activeRun: s.activeRun !== null && s.activeRun.runId === res.runId ? s.activeRun : { ...adoptRun(res.runId, sessionId), userText: trimmed },
      }));
    } catch (err) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== optimistic.id),
        chatError: chatErrorFrom(err),
        sending: false,
      }));
    }
  },

  stopRun: async () => {
    const run = get().activeRun;
    if (run === null) return;
    set({ activeRun: { ...run, stopRequested: true } });
    try {
      await api.stopAgentRun(run.runId);
    } catch {
      // the run may have finished already — run-done (or resync) settles the state
    }
  },

  resyncChat: async () => {
    const active = await api.getActiveAgentRun();
    const local = get().activeRun;
    if (active === null) {
      if (local !== null && local.status === "running") {
        // finished while we were disconnected — settle from the persisted record
        await get().finalizeRun(local.runId);
      }
    } else if (local === null || local.runId !== active.runId) {
      set({ activeRun: adoptRun(active.runId, active.sessionId) });
    }
    // confirms whose run is no longer in flight are dead (settled while away)
    set((s) => ({
      pendingConfirms: pruneConfirms(s.pendingConfirms).map((c) =>
        c.status === "pending" && (active === null || active.runId !== c.runId)
          ? { ...c, status: "resolved" as const, decision: "deny" as const, stale: true, resolvedAt: Date.now() }
          : c,
      ),
    }));
    await get().loadSessions();
  },

  finalizeRun: async (runId) => {
    const s = get();
    const run = s.activeRun;
    if (run === null || run.runId !== runId) return; // already replaced / finalized
    const sessionId = run.sessionId;
    let record = await api.getSession(sessionId);
    if (record !== null && !record.messages.some((m) => m.runId === runId)) {
      // persistence may lag the ws event by a beat — one short retry
      await delay(500);
      record = await api.getSession(sessionId);
    }
    let finalMessages: api.ChatMessageRecord[];
    if (record !== null) {
      finalMessages = record.messages;
      if (run.userText.length > 0 && !finalMessages.some((m) => m.role === "user" && m.content === run.userText)) {
        finalMessages = [
          ...finalMessages,
          { id: nextLocalChatId(), role: "user", content: run.userText, createdAt: Date.now() },
        ];
      }
      if (!finalMessages.some((m) => m.runId === runId)) {
        finalMessages = [...finalMessages, synthAssistantMessage(run)];
      }
    } else {
      // API unreachable — keep the locally streamed run as the message history
      finalMessages = [...s.messages, synthAssistantMessage(run)];
    }
    if (get().currentSessionId !== sessionId) {
      // viewing another session — only the list metadata needs a touch-up
      set((st) => ({
        activeRun: st.activeRun !== null && st.activeRun.runId === runId ? null : st.activeRun,
        sessions: bumpSession(st.sessions, sessionId),
        // the live card (with its confirm cards) is no longer rendered here
        pendingConfirms: st.pendingConfirms.filter((c) => c.runId !== runId),
      }));
      return;
    }
    set((st) => ({
      currentSession: record ?? st.currentSession,
      messages: finalMessages,
      activeRun: st.activeRun !== null && st.activeRun.runId === runId ? null : st.activeRun,
      pendingConfirms: st.pendingConfirms.filter((c) => c.runId !== runId),
      sessions: bumpSession(
        st.sessions.map((x) => (x.id === sessionId ? { ...x, messageCount: finalMessages.length } : x)),
        sessionId,
      ),
    }));
  },

  setComposerDraft: (text) => set({ composerDraft: text }),

  focusComposer: () => set((s) => ({ composerFocusToken: s.composerFocusToken + 1 })),

  // ---- S4: skills / mcp / permissions / confirm flow (v0.2 §6) ------------

  ensureSkills: async () => {
    await get().loadSkills(false);
  },

  loadSkills: async (force) => {
    const s = get();
    if (s.skills.loading) return;
    if (!force && (s.skills.attempted || s.skills.snapshot !== null)) return;
    set({ skills: { ...s.skills, loading: true, ...(force ? { error: null } : {}) } });
    const snapshot = await api.getSkills();
    set(
      snapshot === null
        ? { skills: { loading: false, attempted: true, snapshot: null, error: "SKILLS_UNAVAILABLE" } }
        : { skills: { loading: false, attempted: true, snapshot, error: null } },
    );
  },

  openSkillsPanel: () => {
    set({ skillsOpen: true });
    void get().loadSkills(true);
  },

  closeSkillsPanel: () => set({ skillsOpen: false }),

  toggleSkill: async (name, enabled) => {
    const snap = get().skills.snapshot;
    if (snap === null) return;
    const prior = snap.skills.find((x) => x.name === name) ?? null;
    if (prior === null || prior.enabled === enabled) return;
    // optimistic row flip, restored on failure
    set({
      skills: {
        ...get().skills,
        snapshot: { ...snap, skills: snap.skills.map((x) => (x.name === name ? { ...x, enabled } : x)) },
      },
    });
    try {
      const entry = await api.toggleSkill(name, enabled);
      const cur = get().skills.snapshot;
      if (cur !== null) {
        set({ skills: { ...get().skills, snapshot: { ...cur, skills: cur.skills.map((x) => (x.name === name ? entry : x)) } } });
      }
    } catch (err) {
      const cur = get().skills.snapshot;
      set({
        skills: {
          ...get().skills,
          error: `SKILL_UPDATE_FAILED: ${name} — ${api.errorMessage(err)}`,
          ...(cur !== null && prior !== null
            ? { snapshot: { ...cur, skills: cur.skills.map((x) => (x.name === name ? prior : x)) } }
            : {}),
        },
      });
    }
  },

  setSkillsAutoTrigger: async (value) => {
    const snap = get().skills.snapshot;
    if (snap === null || snap.autoTrigger === value) return;
    set({ skills: { ...get().skills, snapshot: { ...snap, autoTrigger: value } } });
    try {
      const res = await api.patchSkillsOptions({ autoTrigger: value });
      const cur = get().skills.snapshot;
      if (cur !== null) set({ skills: { ...get().skills, snapshot: { ...cur, autoTrigger: res.autoTrigger } } });
    } catch (err) {
      const cur = get().skills.snapshot;
      set({
        skills: {
          ...get().skills,
          error: `SKILLS_AUTOTRIGGER_FAILED: ${api.errorMessage(err)}`,
          ...(cur !== null ? { snapshot: { ...cur, autoTrigger: snap.autoTrigger } } : {}),
        },
      });
    }
  },

  mentionSkill: (name) => {
    const draft = get().composerDraft;
    const ref = `@${name} `;
    const next = draft.length === 0 || /\s$/.test(draft) ? `${draft}${ref}` : `${draft} ${ref}`;
    set({ composerDraft: next });
    get().focusComposer();
  },

  openMcpPanel: async () => {
    if (get().mcpPopoverOpen) {
      set({ mcpPopoverOpen: false });
      return;
    }
    set((s) => ({ mcp: { ...s.mcp, phase: s.mcp.phase === "available" ? "available" : "checking" } }));
    const status = await api.getMcpStatus();
    if (status === null) {
      // 501 MCP_HOST_UNAVAILABLE (host package absent) / endpoint missing / network
      set((s) => ({ mcp: { ...s.mcp, phase: "unavailable", status: null }, mcpPopoverOpen: true }));
      return;
    }
    set((s) => ({ mcp: { ...s.mcp, phase: "available", status: status.servers }, mcpPopoverOpen: false, mcpOpen: true }));
    await get().refreshMcp();
  },

  closeMcpPanel: () => set({ mcpOpen: false }),

  setMcpPopover: (open) => set({ mcpPopoverOpen: open }),

  refreshMcp: async () => {
    const [status, entries, tools] = await Promise.all([api.getMcpStatus(), api.getMcpServers(), api.getMcpTools()]);
    if (status === null) {
      set((s) => ({ mcp: { ...s.mcp, phase: "unavailable", status: null, entries, tools } }));
      return;
    }
    set((s) => ({ mcp: { ...s.mcp, phase: "available", status: status.servers, entries, tools } }));
  },

  setMcpServerEnabled: async (id, enabled) => {
    const entries = get().mcp.entries;
    if (entries === null || get().mcp.busy !== null) return;
    const prior = entries.find((e) => e.id === id) ?? null;
    if (prior === null || prior.enabled === enabled) return;
    const next = entries.map((e) => (e.id === id ? { ...e, enabled } : e));
    set({ mcp: { ...get().mcp, busy: id, entries: next } });
    try {
      const res = await api.putMcpServers(next);
      set({ mcp: { ...get().mcp, entries: res.servers, busy: null } });
    } catch (err) {
      set({
        mcp: { ...get().mcp, entries, busy: null },
        permissionsError: `MCP_SERVER_UPDATE_FAILED: ${id} — ${api.errorMessage(err)}`,
      });
      return;
    }
    await get().refreshMcp();
  },

  mcpStartServer: async (id) => {
    if (get().mcp.busy !== null) return;
    set({ mcp: { ...get().mcp, busy: id } });
    try {
      await api.mcpServerStart(id);
    } catch (err) {
      set({ permissionsError: `MCP_SERVER_START_FAILED: ${id} — ${api.errorMessage(err)}` });
    } finally {
      set({ mcp: { ...get().mcp, busy: null } });
    }
    await get().refreshMcp();
  },

  mcpStopServer: async (id) => {
    if (get().mcp.busy !== null) return;
    set({ mcp: { ...get().mcp, busy: id } });
    try {
      await api.mcpServerStop(id);
    } catch (err) {
      set({ permissionsError: `MCP_SERVER_STOP_FAILED: ${id} — ${api.errorMessage(err)}` });
    } finally {
      set({ mcp: { ...get().mcp, busy: null } });
    }
    await get().refreshMcp();
  },

  setMcpMergeTools: (value) => {
    const values = get().settings.values;
    if (values === null) return;
    set({ settings: { values: { ...values, mcp: { ...(values.mcp ?? {}), mergeTools: value } } } });
    void api.patchSettings({ mcp: { mergeTools: value } }).then((saved) => {
      if (saved !== null) {
        useStudio.setState((st) => (st.settings.values === null ? {} : { settings: { values: normalizeSettings(saved) } }));
      }
    });
  },

  openPermissions: () => {
    set({ permissionsOpen: true, permissionsError: null });
    // fresh settings: "总是允许" during runs persists overrides server-side
    void get().loadSettings();
  },

  closePermissions: () => set({ permissionsOpen: false }),

  setPermissionsError: (message) => set({ permissionsError: message }),

  updateAgent: async (patch) => {
    const values = get().settings.values;
    if (values === null) return;
    const agent = { ...normalizeAgentSection(values.agent), ...patch };
    set({ settings: { values: { ...values, agent } } });
    const saved = await api.patchSettings({ agent: patch });
    if (saved !== null) {
      set((s) => (s.settings.values === null ? {} : { settings: { values: normalizeSettings(saved) } }));
    }
  },

  setToolPermission: async (name, value) => {
    const values = get().settings.values;
    if (values === null) return;
    const agent = normalizeAgentSection(values.agent);
    if (value === null) {
      // true key removal: PATCH merges per key and the enum schema rejects
      // null — the only deletion path is GET → mutate → PUT (full replace)
      set({ permissionsError: null });
      try {
        const fresh = await api.getSettings();
        if (fresh === null) throw new Error("SERVER_UNAVAILABLE");
        const next = normalizeSettings(fresh);
        const nextAgent = normalizeAgentSection(next.agent);
        const perms = { ...nextAgent.toolPermissions };
        delete perms[name];
        next.agent = { ...nextAgent, toolPermissions: perms };
        const saved = normalizeSettings(await api.putSettings(next));
        set({ settings: { values: saved }, permissionsError: null });
      } catch (err) {
        set({ permissionsError: `PERMISSION_CLEAR_FAILED: ${api.errorMessage(err)}` });
      }
      return;
    }
    // explicit override — per-key PATCH merge (toolPermissions replaced only locally)
    const optimistic: AgentSection = { ...agent, toolPermissions: { ...agent.toolPermissions, [name]: value } };
    set((s) => ({ settings: { values: { ...(s.settings.values ?? localSettings()), agent: optimistic } } }));
    const saved = await api.patchSettings({ agent: { toolPermissions: { [name]: value } } });
    if (saved !== null) {
      set((s) => (s.settings.values === null ? {} : { settings: { values: normalizeSettings(saved) } }));
    }
  },

  resolveConfirm: async (confirmId, decision) => {
    const entry = get().pendingConfirms.find((c) => c.confirmId === confirmId);
    if (entry === undefined || entry.status !== "pending") return;
    // optimistic settle; the ws agent-resolved broadcast confirms or corrects it
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((c) =>
        c.confirmId === confirmId ? { ...c, status: "resolved" as const, decision, local: true, resolvedAt: Date.now() } : c,
      ),
    }));
    try {
      await api.resolveAgentConfirm(confirmId, decision);
    } catch {
      // already settled server-side (timeout / stop / raced): the authoritative
      // outcome is deny — overwrite our optimistic local decision unless a ws
      // broadcast already claimed the entry
      set((s) => ({
        pendingConfirms: s.pendingConfirms.map((c) =>
          c.confirmId === confirmId && c.status === "resolved" && c.local === true
            ? { ...c, decision: "deny" as const, local: false, timeout: Date.now() - c.createdAt >= CONFIRM_TIMEOUT_HEURISTIC_MS }
            : c,
        ),
      }));
    }
  },
}));
