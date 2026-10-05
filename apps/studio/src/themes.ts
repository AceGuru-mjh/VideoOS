// VideoOS Studio — 8-theme catalog (v0.2 §2 / issue #44).
// ids and labels are the single source of truth for the wizard, the settings
// API (general.theme) and the [data-theme=…] CSS blocks in styles.css.

export type ThemeId = "midnight" | "graphite" | "amber" | "forest" | "rose" | "sand" | "paper" | "daylight";

export interface ThemeDef {
  id: ThemeId;
  /** 中文 + English label, e.g. "深空 Midnight" */
  label: string;
  dark: boolean;
  /** small preview swatch (also used by the wizard cards) */
  swatch: { bg: string; panel: string; accent: string; text: string };
}

export const THEMES: ThemeDef[] = [
  { id: "midnight", label: "深空 Midnight", dark: true, swatch: { bg: "#0b0f16", panel: "#111722", accent: "#ffb224", text: "#e6ebf5" } },
  { id: "graphite", label: "石墨 Graphite", dark: true, swatch: { bg: "#101214", panel: "#16191d", accent: "#8fa3bf", text: "#e8eaee" } },
  { id: "amber", label: "琥珀 Amber", dark: true, swatch: { bg: "#12100a", panel: "#1a1710", accent: "#ffb224", text: "#f0e9dc" } },
  { id: "forest", label: "暗绿 Forest", dark: true, swatch: { bg: "#081109", panel: "#0e1a12", accent: "#3ddc97", text: "#e6f2e9" } },
  { id: "rose", label: "玫红 Rose", dark: true, swatch: { bg: "#140b10", panel: "#1c1017", accent: "#f472b6", text: "#f2e6ee" } },
  { id: "sand", label: "暖沙 Sand", dark: false, swatch: { bg: "#f5efe6", panel: "#fcfaf4", accent: "#b45309", text: "#3a2e1f" } },
  { id: "paper", label: "纸白 Paper", dark: false, swatch: { bg: "#fafaf7", panel: "#ffffff", accent: "#334155", text: "#1f2430" } },
  { id: "daylight", label: "日光 Daylight", dark: false, swatch: { bg: "#f1f5f9", panel: "#ffffff", accent: "#0f766e", text: "#1d2b36" } },
];

export const DEFAULT_THEME: ThemeId = "midnight";

const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));

export function isThemeId(v: string): v is ThemeId {
  return THEME_IDS.has(v);
}

export function themeById(id: string): ThemeDef | null {
  return THEMES.find((t) => t.id === id) ?? null;
}
