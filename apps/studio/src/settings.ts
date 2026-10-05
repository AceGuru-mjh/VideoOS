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
  agent?: Record<string, unknown>;
  render?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
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
  };
}

/** Shape any server payload into a complete SettingsValues (unknown/missing → defaults). */
export function normalizeSettings(raw: unknown): SettingsValues {
  const src = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<SettingsValues> & Record<string, unknown>;
  const generalSrc = (src.general ?? {}) as Partial<GeneralSettings>;
  const ifaceSrc = (src.interface ?? {}) as Partial<InterfaceSettings>;
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
  };
}
