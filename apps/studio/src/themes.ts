// VideoOS Studio — 16-theme catalog (v0.2 §2 / issue #44; +8 in the themes & mascot PR).
// ids and labels are the single source of truth for the wizard, the settings
// API (general.theme) and the [data-theme=…] CSS blocks in styles.css.

export type ThemeId =
  | "midnight"
  | "graphite"
  | "amber"
  | "forest"
  | "rose"
  | "sand"
  | "paper"
  | "daylight"
  | "ocean"
  | "cyber"
  | "coffee"
  | "mono"
  | "sakura"
  | "mint"
  | "lavender"
  | "ivory";

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
  { id: "ocean", label: "深海 Ocean", dark: true, swatch: { bg: "#071118", panel: "#0c1a24", accent: "#4dd6c8", text: "#e2edf2" } },
  { id: "cyber", label: "赛博 Cyber", dark: true, swatch: { bg: "#0a0a12", panel: "#12121e", accent: "#ff4fd8", text: "#ece8f6" } },
  { id: "coffee", label: "咖啡 Coffee", dark: true, swatch: { bg: "#14100c", panel: "#1c1712", accent: "#e0a25e", text: "#f2ead9" } },
  { id: "mono", label: "墨色 Mono", dark: true, swatch: { bg: "#0c0c0d", panel: "#141415", accent: "#f5f5f7", text: "#f0f0f2" } },
  { id: "sakura", label: "樱花 Sakura", dark: false, swatch: { bg: "#fdeef4", panel: "#fff7fa", accent: "#d63384", text: "#43252f" } },
  { id: "mint", label: "薄荷 Mint", dark: false, swatch: { bg: "#eefaf3", panel: "#f8fef9", accent: "#0d8a5f", text: "#1e3a2b" } },
  { id: "lavender", label: "薰衣草 Lavender", dark: false, swatch: { bg: "#f3f0fb", panel: "#fbf9fe", accent: "#7c5cd6", text: "#2f2745" } },
  { id: "ivory", label: "象牙 Ivory", dark: false, swatch: { bg: "#f7f2e8", panel: "#fffcf4", accent: "#b5531f", text: "#3d3222" } },
];

export const DEFAULT_THEME: ThemeId = "midnight";

const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));

export function isThemeId(v: string): v is ThemeId {
  return THEME_IDS.has(v);
}

export function themeById(id: string): ThemeDef | null {
  return THEMES.find((t) => t.id === id) ?? null;
}
