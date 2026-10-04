// 字体注册：项目字体 → GlobalFonts.registerFromPath；族名解析处理 CSS 泛型关键字
// 发现（@napi-rs/canvas 1.0.10）：裸 `sans-serif`/`serif`/`monospace` 泛型关键字不会被解析（fillText 输出为空），
// 只有具体族名（如 "DejaVu Sans"，系统字体按名可用）或已注册的 family 才能命中；
// 因此 resolveFontFamily 把泛型关键字映射为具体系统族，fontString 再补具体回退链（跨平台 DejaVu/Liberation/Arial）。
import { existsSync } from "node:fs";
import { GlobalFonts } from "@napi-rs/canvas";
import { RenderError } from "./types";
import type { FontRegistration } from "./types";

/** CSS 泛型关键字 → 具体系统族候选（取首个；DejaVu(Linux) / Liberation / Arial(Win/Mac) 覆盖主流平台） */
const GENERIC_ALIASES: Readonly<Record<string, string>> = {
  "sans-serif": "DejaVu Sans",
  "system-ui": "DejaVu Sans",
  "ui-sans-serif": "DejaVu Sans",
  serif: "DejaVu Serif",
  "ui-serif": "DejaVu Serif",
  monospace: "DejaVu Sans Mono",
  "ui-monospace": "DejaVu Sans Mono",
  cursive: "DejaVu Sans",
  fantasy: "DejaVu Sans",
};

/**
 * 注册项目字体（渲染前调用；createRenderer(options.fonts) 已自动执行）。
 * 文件缺失/注册失败抛 RenderError；系统字体（DejaVu Sans 等）按具体族名自动可用，无需注册。
 */
export function registerFonts(regs: FontRegistration[]): void {
  if (!Array.isArray(regs)) {
    throw new RenderError("RENDER_FONT_INVALID_INPUT", "fonts must be an array of FontRegistration");
  }
  for (const reg of regs) {
    if (reg === null || typeof reg !== "object") {
      throw new RenderError("RENDER_FONT_INVALID_INPUT", `Font registration must be an object, got ${String(reg)}`);
    }
    if (typeof reg.family !== "string" || reg.family.length === 0) {
      throw new RenderError("RENDER_FONT_INVALID_FAMILY", `Font family must be a non-empty string, got ${String(reg.family)}`);
    }
    if (typeof reg.path !== "string" || reg.path.length === 0) {
      throw new RenderError("RENDER_FONT_INVALID_PATH", `Font path for family "${reg.family}" must be a non-empty string`);
    }
    if (!existsSync(reg.path)) {
      throw new RenderError("RENDER_FONT_FILE_MISSING", `Font file not found: ${reg.path} (family "${reg.family}")`);
    }
    let registered: unknown = false;
    try {
      registered = GlobalFonts.registerFromPath(reg.path, reg.family);
    } catch (err) {
      throw new RenderError("RENDER_FONT_REGISTER_FAILED", `Failed to register font "${reg.family}" from ${reg.path}: ${(err as Error).message}`);
    }
    if (registered === false || registered === null || registered === undefined) {
      throw new RenderError("RENDER_FONT_REGISTER_FAILED", `Failed to register font "${reg.family}" from ${reg.path}`);
    }
  }
}

/**
 * 字体族解析：泛型关键字（sans-serif 等）映射为具体系统族，其余原样返回。
 * 缺字回退由 fontString 的具体回退链 + Skia 匹配处理。
 */
export function resolveFontFamily(name: string): string {
  return GENERIC_ALIASES[name] ?? name;
}
