// VideoOS Studio — Monaco theme bridge (issue #44).
// `videoos-dark` keeps the exact pre-theming colors (zero regression for the
// default midnight look and a stable id for settings.interface.codeTheme).
// Per-app-theme variants `videoos-<id>` are derived from the [data-theme]
// CSS custom properties (read via a hidden probe element) so the editor always
// matches the UI palette, whatever the currently applied theme is.
import * as monaco from "monaco-editor";
import { themeById } from "./themes";

const FALLBACK_TOKENS: Record<string, string> = {
  "--panel": "#111722",
  "--panel2": "#161e2c",
  "--border": "#232d40",
  "--border2": "#2e3a52",
  "--text": "#e6ebf5",
  "--dim": "#8b96ad",
  "--faint": "#5a6478",
  "--accent": "#ffb224",
  "--ok": "#3ddc97",
  "--info": "#6bd5e1",
};

/** Original hardcoded editor palette (midnight) — kept verbatim for the legacy theme id. */
function defineLegacyVideoosDark(): void {
  monaco.editor.defineTheme("videoos-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5A6478", fontStyle: "italic" },
      { token: "keyword", foreground: "FFB224" },
      { token: "string", foreground: "3DDC97" },
      { token: "number", foreground: "6BD5E1" },
      { token: "type", foreground: "6BD5E1" },
      { token: "type.identifier", foreground: "6BD5E1" },
    ],
    colors: {
      "editor.background": "#111722",
      "editor.foreground": "#E6EBF5",
      "editorLineNumber.foreground": "#5A6478",
      "editorLineNumber.activeForeground": "#8B96AD",
      "editor.selectionBackground": "#2E3A52",
      "editor.lineHighlightBackground": "#161E2C",
      "editorCursor.foreground": "#FFB224",
      "editorIndentGuide.background": "#232D40",
    },
  });
}
defineLegacyVideoosDark();

function hex6(color: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  return m !== null ? m[1]!.toUpperCase() : "E6EBF5";
}

const definedThemes = new Set<string>(["videoos-dark"]);

/** Define `videoos-<id>` from that theme's CSS tokens (styles.css must be loaded). */
function defineAppTheme(id: string): void {
  const key = `videoos-${id}`;
  if (definedThemes.has(key)) return;
  const def = themeById(id);
  if (def === null) return;
  // hidden probe element: [data-theme=<id>] custom properties resolve on it,
  // independent of the theme currently applied to <html>
  const probe = document.createElement("div");
  probe.dataset.theme = id;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const token = (name: string): string => {
    const v = cs.getPropertyValue(name).trim();
    return v.length > 0 ? v : (FALLBACK_TOKENS[name] ?? "#111722");
  };
  const panel = token("--panel");
  const text = token("--text");
  const dim = token("--dim");
  const faint = token("--faint");
  const accent = token("--accent");
  const ok = token("--ok");
  const info = token("--info");
  probe.remove();
  monaco.editor.defineTheme(key, {
    base: def.dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex6(faint), fontStyle: "italic" },
      { token: "keyword", foreground: hex6(accent) },
      { token: "string", foreground: hex6(ok) },
      { token: "number", foreground: hex6(info) },
      { token: "type", foreground: hex6(info) },
      { token: "type.identifier", foreground: hex6(info) },
    ],
    colors: {
      "editor.background": panel,
      "editor.foreground": text,
      "editorLineNumber.foreground": faint,
      "editorLineNumber.activeForeground": dim,
      "editor.selectionBackground": token("--border2"),
      "editor.lineHighlightBackground": token("--panel2"),
      "editorCursor.foreground": accent,
      "editorIndentGuide.background": token("--border"),
    },
  });
  definedThemes.add(key);
}

let appliedThemeName = "videoos-dark";

/** Name of the Monaco theme currently applied (used when an editor is created). */
export function getMonacoThemeName(): string {
  return appliedThemeName;
}

/**
 * Apply the Monaco theme for an app theme id.
 * codeTheme (settings.interface.codeTheme):
 * - "auto" (default): follow the app theme's darkness (videoos-<id>)
 * - "dark" / "light": force an editor family — the app palette is kept when
 *   its darkness matches, otherwise the canonical variant (videoos-dark / vs)
 */
export function applyMonacoTheme(themeId: string, codeTheme = "auto"): void {
  const def = themeById(themeId);
  // editor family: forced by settings, else the app theme's own darkness
  const wantDark = codeTheme === "dark" ? true : codeTheme === "light" ? false : def === null ? true : def.dark;
  let name: string;
  if (def !== null && def.dark === wantDark) {
    defineAppTheme(def.id);
    name = `videoos-${def.id}`;
  } else {
    name = wantDark ? "videoos-dark" : "vs";
  }
  appliedThemeName = name;
  monaco.editor.setTheme(name);
}
