// VideoOS Studio — settings types + defaults (v0.2 §2, issue #44/#45).
// Mirrors the @videoos/server `GET/PATCH /api/settings` contract: general and
// interface are fully typed; every other section stays a loose record so the
// settings center (S5) and wizard step 2 (S2) can extend them freely.
import { DEFAULT_THEME, isThemeId } from "./themes";

export interface GeneralSettings {
  theme: string;
  language: "zh" | "en";
  onboarded: boolean;
  startup: string;
}

/** settings.agent（v0.2 §6 issue #54；镜像 server settings/schema.ts agentShape） */
export type AutonomyLevel = "L1" | "L2" | "L3" | "L4";
export type PermissionDecision = "allow" | "confirm" | "deny";

export interface AgentSection {
  autonomy: AutonomyLevel;
  maxSteps: number;
  /** 逐工具显式覆盖（mcp_* 走 "mcp" 类目键；server gate.ts 语义） */
  toolPermissions: Record<string, PermissionDecision>;
  confirmRender: boolean;
  /** 危险参数正则黑名单（每行一个，new RegExp 编译；匹配 JSON.stringify(args) 硬拒） */
  dangerousPatterns: string[];
}

const DEFAULT_AGENT: AgentSection = {
  autonomy: "L3",
  maxSteps: 12,
  toolPermissions: {},
  confirmRender: true,
  dangerousPatterns: [],
};

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return v === "L1" || v === "L2" || v === "L3" || v === "L4";
}

function isPermissionDecision(v: unknown): v is PermissionDecision {
  return v === "allow" || v === "confirm" || v === "deny";
}

/** 任意 payload → 合法 AgentSection（非法键值剔除；mirrors DEFAULT_SETTINGS.agent） */
export function normalizeAgentSection(raw: unknown): AgentSection {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<Record<keyof AgentSection, unknown>>;
  const perms: Record<string, PermissionDecision> = {};
  if (src.toolPermissions !== null && typeof src.toolPermissions === "object") {
    for (const [k, v] of Object.entries(src.toolPermissions as Record<string, unknown>)) {
      if (isPermissionDecision(v)) perms[k] = v;
    }
  }
  const patterns = Array.isArray(src.dangerousPatterns) ? src.dangerousPatterns.filter((p): p is string => typeof p === "string") : [];
  return {
    autonomy: isAutonomyLevel(src.autonomy) ? src.autonomy : DEFAULT_AGENT.autonomy,
    maxSteps: typeof src.maxSteps === "number" && Number.isFinite(src.maxSteps) ? Math.max(1, Math.round(src.maxSteps)) : DEFAULT_AGENT.maxSteps,
    toolPermissions: perms,
    confirmRender: typeof src.confirmRender === "boolean" ? src.confirmRender : DEFAULT_AGENT.confirmRender,
    dangerousPatterns: patterns,
  };
}

/** settings.mcp（issue #53；servers 形状由 /api/mcp/servers 端点单独持有，settings 侧同形存储） */
export interface McpSection {
  mergeTools: boolean;
  servers?: unknown;
  [k: string]: unknown;
}

/** settings.render（v0.2 §5 S6；镜像 server settings/schema.ts renderShape） */
export type RenderPreset = "1080p30" | "720p30" | "vertical-1080x1920";

export interface RenderSection {
  outDir: string;
  preset: RenderPreset;
  concurrency: number;
  retries: number;
}

/** settings.skills（S6；与 GET /api/skills 快照同源存储） */
export interface SkillsSection {
  enabled: Record<string, boolean>;
  autoTrigger: boolean;
  customDir: string | null;
}

/** settings.interface（S6：四项全部即存即生效 — 字号/密度/代码主题/动效） */
export type FontSizePref = "sm" | "md" | "lg";
export type DensityPref = "cozy" | "compact";
export type CodeThemePref = "auto" | "dark" | "light";

export interface InterfaceSettings {
  fontSize: FontSizePref;
  density: DensityPref;
  /** "auto" follows the active theme's darkness; "dark"/"light" force an editor family */
  codeTheme: CodeThemePref;
  motion: boolean;
}

/** settings.privacy（S6；遥测默认关闭） */
export type LogLevelPref = "debug" | "info" | "warn" | "error";

export interface PrivacySection {
  telemetry: boolean;
  crashReports: boolean;
  logLevel: LogLevelPref;
  logRetentionDays: number;
  sessionRetentionDays: number;
}

/** settings.advanced（S6） */
export interface AdvancedSection {
  replayWizard: boolean;
}

/** 九大节名（JSON 编辑器校验 / 全部重置共用；镜像 server SETTINGS_SECTION_NAMES） */
export const SETTINGS_SECTIONS: readonly string[] = [
  "general",
  "providers",
  "agent",
  "render",
  "mcp",
  "skills",
  "interface",
  "privacy",
  "advanced",
];

export interface SettingsValues {
  general: GeneralSettings;
  interface: InterfaceSettings;
  providers?: Record<string, unknown>;
  agent?: AgentSection;
  render?: RenderSection;
  mcp?: McpSection;
  skills?: SkillsSection;
  privacy?: PrivacySection;
  advanced?: AdvancedSection;
  [k: string]: unknown;
}

/** PATCH body: per-section partial objects (server deep-merges). */
export interface SettingsPatch {
  general?: Partial<GeneralSettings>;
  interface?: Partial<InterfaceSettings>;
  [k: string]: unknown;
}

export const THEME_STORAGE_KEY = "videoos.theme";
export const ONBOARDED_STORAGE_KEY = "videoos.onboarded";

const DEFAULT_GENERAL: GeneralSettings = { theme: DEFAULT_THEME, language: "zh", onboarded: false, startup: "last-session" };
const DEFAULT_INTERFACE: InterfaceSettings = { fontSize: "md", density: "cozy", codeTheme: "auto", motion: true };
const DEFAULT_RENDER: RenderSection = { outDir: "renders", preset: "1080p30", concurrency: 1, retries: 1 };
const DEFAULT_SKILLS: SkillsSection = { enabled: {}, autoTrigger: true, customDir: null };
const DEFAULT_PRIVACY: PrivacySection = { telemetry: false, crashReports: true, logLevel: "info", logRetentionDays: 14, sessionRetentionDays: 90 };
const DEFAULT_ADVANCED: AdvancedSection = { replayWizard: false };

function isFontSizePref(v: unknown): v is FontSizePref {
  return v === "sm" || v === "md" || v === "lg";
}

function isDensityPref(v: unknown): v is DensityPref {
  return v === "cozy" || v === "compact";
}

function isCodeThemePref(v: unknown): v is CodeThemePref {
  return v === "auto" || v === "dark" || v === "light";
}

function isRenderPreset(v: unknown): v is RenderPreset {
  return v === "1080p30" || v === "720p30" || v === "vertical-1080x1920";
}

function isLogLevelPref(v: unknown): v is LogLevelPref {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** 任意 payload → 合法 RenderSection */
export function normalizeRenderSection(raw: unknown): RenderSection {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<RenderSection>;
  return {
    outDir: typeof src.outDir === "string" ? src.outDir : DEFAULT_RENDER.outDir,
    preset: isRenderPreset(src.preset) ? src.preset : DEFAULT_RENDER.preset,
    concurrency: clampInt(src.concurrency, 1, 4, DEFAULT_RENDER.concurrency),
    retries: clampInt(src.retries, 0, 3, DEFAULT_RENDER.retries),
  };
}

/** 任意 payload → 合法 SkillsSection */
export function normalizeSkillsSection(raw: unknown): SkillsSection {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<SkillsSection>;
  const enabled: Record<string, boolean> = {};
  if (src.enabled !== null && typeof src.enabled === "object") {
    for (const [k, v] of Object.entries(src.enabled as Record<string, unknown>)) {
      if (typeof v === "boolean") enabled[k] = v;
    }
  }
  return {
    enabled,
    autoTrigger: typeof src.autoTrigger === "boolean" ? src.autoTrigger : DEFAULT_SKILLS.autoTrigger,
    customDir: typeof src.customDir === "string" && src.customDir.length > 0 ? src.customDir : null,
  };
}

/** 任意 payload → 合法 InterfaceSettings（完整四字段） */
export function normalizeInterfaceSection(raw: unknown): InterfaceSettings {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<InterfaceSettings>;
  return {
    fontSize: isFontSizePref(src.fontSize) ? src.fontSize : DEFAULT_INTERFACE.fontSize,
    density: isDensityPref(src.density) ? src.density : DEFAULT_INTERFACE.density,
    codeTheme: isCodeThemePref(src.codeTheme) ? src.codeTheme : DEFAULT_INTERFACE.codeTheme,
    motion: typeof src.motion === "boolean" ? src.motion : DEFAULT_INTERFACE.motion,
  };
}

/** 任意 payload → 合法 PrivacySection */
export function normalizePrivacySection(raw: unknown): PrivacySection {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<PrivacySection>;
  return {
    telemetry: typeof src.telemetry === "boolean" ? src.telemetry : DEFAULT_PRIVACY.telemetry,
    crashReports: typeof src.crashReports === "boolean" ? src.crashReports : DEFAULT_PRIVACY.crashReports,
    logLevel: isLogLevelPref(src.logLevel) ? src.logLevel : DEFAULT_PRIVACY.logLevel,
    logRetentionDays: clampInt(src.logRetentionDays, 1, 365, DEFAULT_PRIVACY.logRetentionDays),
    sessionRetentionDays: clampInt(src.sessionRetentionDays, 0, 3650, DEFAULT_PRIVACY.sessionRetentionDays),
  };
}

/** 任意 payload → 合法 AdvancedSection */
export function normalizeAdvancedSection(raw: unknown): AdvancedSection {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<AdvancedSection>;
  return {
    replayWizard: typeof src.replayWizard === "boolean" ? src.replayWizard : DEFAULT_ADVANCED.replayWizard,
  };
}

function readStoredString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable — persistence degrades to per-session only
  }
}

export function storeThemeMirror(id: string): void {
  writeStoredString(THEME_STORAGE_KEY, id);
}

export function storeOnboardedMirror(value: boolean): void {
  writeStoredString(ONBOARDED_STORAGE_KEY, value ? "true" : "false");
}

/** Settings used before/without the server API: defaults + localStorage mirrors. */
export function localSettings(): SettingsValues {
  const storedTheme = readStoredString(THEME_STORAGE_KEY);
  return {
    general: {
      ...DEFAULT_GENERAL,
      theme: storedTheme !== null && isThemeId(storedTheme) ? storedTheme : DEFAULT_THEME,
      onboarded: readStoredString(ONBOARDED_STORAGE_KEY) === "true",
    },
    interface: { ...DEFAULT_INTERFACE },
    agent: structuredClone(DEFAULT_AGENT),
    render: { ...DEFAULT_RENDER },
    skills: structuredClone(DEFAULT_SKILLS),
    privacy: { ...DEFAULT_PRIVACY },
    advanced: { ...DEFAULT_ADVANCED },
    mcp: { mergeTools: false },
  };
}

/** Shape any server payload into a complete SettingsValues (unknown/missing → defaults). */
export function normalizeSettings(raw: unknown): SettingsValues {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<SettingsValues> & Record<string, unknown>;
  const generalSrc = (src.general ?? {}) as Partial<GeneralSettings>;
  const mcpSrc = (src.mcp ?? {}) as Partial<McpSection>;
  return {
    ...localSettings(),
    ...src,
    general: {
      theme: typeof generalSrc.theme === "string" ? generalSrc.theme : DEFAULT_GENERAL.theme,
      language: generalSrc.language === "en" ? "en" : "zh",
      onboarded: generalSrc.onboarded === true,
      startup: typeof generalSrc.startup === "string" ? generalSrc.startup : DEFAULT_GENERAL.startup,
    },
    interface: normalizeInterfaceSection(src.interface),
    agent: normalizeAgentSection(src.agent),
    render: normalizeRenderSection(src.render),
    skills: normalizeSkillsSection(src.skills),
    privacy: normalizePrivacySection(src.privacy),
    advanced: normalizeAdvancedSection(src.advanced),
    mcp: { ...mcpSrc, mergeTools: mcpSrc.mergeTools === true },
  };
}
