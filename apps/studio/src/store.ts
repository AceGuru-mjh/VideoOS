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
  storeOnboardedMirror,
  storeThemeMirror,
  type SettingsValues,
} from "./settings";

export type DockTab = "diagnostics" | "tests" | "agent" | "events";

export interface AgentMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  toolCallCount?: number;
  error?: boolean;
}

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

  // ---- actions ----
  boot: () => Promise<void>;
  /** health + hydrate; never throws (surfaces via projectError) */
  bootServer: () => Promise<void>;
  loadSettings: () => Promise<void>;
  /** apply a theme globally (DOM + Monaco + localStorage mirror) and PATCH it */
  setTheme: (id: string) => void;
  setOnboarded: (value: boolean) => void;
  setWizardActive: (open: boolean) => void;
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
    }
  },

  setWs: (connected) => set({ wsConnected: connected }),
  setWsCount: (count) => set({ wsCount: count }),
  setEventFilter: (filter) => set({ eventFilter: filter }),
}));
