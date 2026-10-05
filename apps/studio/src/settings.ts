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

/** settings.mcp（issue #53；servers 形状由 /api/mcp/servers 端点单独持有，此处仅 mergeTools 开关） */
export interface McpSection {
  mergeTools: boolean;
  servers?: unknown;
  [k: string]: unknown;
}

export interface InterfaceSettings {
  /** "auto" follows the active theme's darkness; "dark"/"light" force an editor family */
  codeTheme: "auto" | "dark" | "light" | (string & {});
  fontSize?: string;
  [k: string]: unknown;
}

export interface SettingsValues {
  general: GeneralSettings;
  interface: InterfaceSettings;
  providers?: Record<string, unknown>;
  agent?: AgentSection;
  render?: Record<string, unknown>;
  mcp?: McpSection;
  skills?: Record<string, unknown>;
  privacy?: Record<string, unknown>;
  advanced?: Record<string, unknown>;
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
const DEFAULT_INTERFACE: InterfaceSettings = { codeTheme: "auto" };

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
    mcp: { mergeTools: false },
  };
}

/** Shape any server payload into a complete SettingsValues (unknown/missing → defaults). */
export function normalizeSettings(raw: unknown): SettingsValues {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<SettingsValues> & Record<string, unknown>;
  const generalSrc = (src.general ?? {}) as Partial<GeneralSettings>;
  const ifaceSrc = (src.interface ?? {}) as Partial<InterfaceSettings>;
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
    interface: { ...DEFAULT_INTERFACE, ...ifaceSrc, codeTheme: typeof ifaceSrc.codeTheme === "string" ? ifaceSrc.codeTheme : "auto" },
    agent: normalizeAgentSection(src.agent),
    mcp: { ...mcpSrc, mergeTools: mcpSrc.mergeTools === true },
  };
}
