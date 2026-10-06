// @videoos/mcp-palette —— 配色方案生成服务器（stdio MCP）：和谐色板/渐变色阶/色盲安全色/
// WCAG 对比度/最佳文字色/色相旋转/视频背景渐变。
// 纯 TS 色彩数学（hex↔RGB↔HSL、相对亮度、最短路径角度插值），零依赖零网络零落盘。
// 时间线用途：视频片头/字幕/数据面板的成套配色与可读性校验（与 mcp-color 的单色工具互补）。
// 直调可测：工具表导出为 `tools`、色彩换算纯函数一并导出（测试直证 HSL↔RGB）；
// 仅作为入口脚本运行时才启动 stdio 服务器。
import { defineTool, err, ok, runStdioServer, type LiteTool } from "@videoos/mcp-lite";
import { z } from "zod";

// ---------------------------------------------------------------- 色彩核心（导出供测试直证）

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Hsl {
  readonly h: number; // 0-360
  readonly s: number; // 0-100
  readonly l: number; // 0-100
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** HSL → RGB（h 0-360 / s、l 0-100；输入越界自动 clamp） */
export function hslToRgb(hsl: Hsl): Rgb {
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hsl.h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** RGB → HSL（输出 h 0-360、s/l 0-100 浮点） */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: ((h % 360) + 360) % 360, s: s * 100, l: l * 100 };
}

function hexOf(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/** 解析 hex：#rgb / #rrggbb / #rrggbbaa（alpha 解析后单独返回，输出恒为 #rrggbb） */
export function parseHexColor(value: string): { ok: true; rgb: Rgb; alpha: number } | { ok: false; reason: string } {
  const v = value.trim().toLowerCase();
  if (v === "") return { ok: false, reason: "empty color value" };
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (match === null) {
    return { ok: false, reason: `unrecognized hex color (expected #rgb/#rrggbb/#rrggbbaa): ${JSON.stringify(value)}` };
  }
  const digits = match[1]!;
  if (digits.length === 3) {
    return {
      ok: true,
      alpha: 1,
      rgb: {
        r: Number.parseInt(digits[0]!.repeat(2), 16),
        g: Number.parseInt(digits[1]!.repeat(2), 16),
        b: Number.parseInt(digits[2]!.repeat(2), 16),
      },
    };
  }
  const rgb = {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return { ok: true, rgb, alpha };
}

/** 工具内语义校验：非法颜色 → err 文案（而非抛错） */
function requireColor(value: string, field: string): { ok: true; rgb: Rgb; hsl: Hsl } | { ok: false; error: string } {
  const parsed = parseHexColor(value);
  if (!parsed.ok) return { ok: false, error: `E_COLOR: ${field}: ${parsed.reason}` };
  return { ok: true, rgb: parsed.rgb, hsl: rgbToHsl(parsed.rgb) };
}

/** WCAG 相对亮度（0-1） */
function channelLinear(channel: number): number {
  const t = channel / 255;
  return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channelLinear(rgb.r) + 0.7152 * channelLinear(rgb.g) + 0.0722 * channelLinear(rgb.b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 最短路径角度插值（h 从 a → b，t ∈ [0,1]） */
function lerpAngle(a: number, b: number, t: number): number {
  const delta = (((b - a) % 360) + 540) % 360 - 180;
  return (((a + delta * t) % 360) + 360) % 360;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 展示用 HSL（1 位小数） */
function hslOut(hsl: Hsl): { h: number; s: number; l: number } {
  return {
    h: Math.round(hsl.h * 10) / 10,
    s: Math.round(hsl.s * 10) / 10,
    l: Math.round(hsl.l * 10) / 10,
  };
}

/** 明度阶梯：level 0=基准、奇数 +12×k、偶数 −12×k（clamp 6-94） */
function ladderLightness(level: number, baseL: number): number {
  if (level === 0) return baseL;
  const k = Math.ceil(level / 2);
  return clamp(baseL + (level % 2 === 1 ? 1 : -1) * 12 * k, 6, 94);
}

function ladderSuffix(level: number): string {
  if (level === 0) return "";
  const k = Math.ceil(level / 2);
  return level % 2 === 1 ? `-light-${k}` : `-dark-${k}`;
}

// ---------------------------------------------------------------- 和谐色板生成

type HarmonyMode = "complementary" | "analogous" | "triadic" | "tetradic" | "split-complementary" | "monochromatic";

const HARMONY_DEFAULT_COUNTS: Record<HarmonyMode, number> = {
  complementary: 2,
  analogous: 3,
  triadic: 3,
  tetradic: 4,
  "split-complementary": 3,
  monochromatic: 5,
};

const HARMONY_OFFSETS: Record<Exclude<HarmonyMode, "analogous" | "monochromatic">, { offsets: number[]; names: string[] }> = {
  complementary: { offsets: [0, 180], names: ["base", "complement"] },
  triadic: { offsets: [0, 120, 240], names: ["base", "triad-1", "triad-2"] },
  tetradic: { offsets: [0, 90, 180, 270], names: ["base", "tetrad-1", "tetrad-2", "tetrad-3"] },
  "split-complementary": { offsets: [0, 150, 210], names: ["base", "split-1", "split-2"] },
};

function buildHarmony(base: Hsl, mode: HarmonyMode, count: number): Array<{ hex: string; hsl: { h: number; s: number; l: number }; role: string }> {
  const out: Array<{ hex: string; hsl: { h: number; s: number; l: number }; role: string }> = [];
  const push = (h: number, s: number, l: number, role: string): void => {
    const hsl = { h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100) };
    out.push({ hex: hexOf(hslToRgb(hsl)), hsl: hslOut(hsl), role });
  };
  if (mode === "monochromatic") {
    // 同色相明度梯度（基准明度居中），越界 clamp 后再回标 base
    const lo = clamp(base.l - 28, 8, 86);
    const hi = clamp(base.l + 28, 14, 92);
    let baseIndex = 0;
    let baseDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const l = lo + (hi - lo) * t;
      if (Math.abs(l - base.l) < baseDistance) {
        baseDistance = Math.abs(l - base.l);
        baseIndex = i;
      }
      push(base.h, clamp(base.s * (1 - Math.abs(t - 0.5) * 0.35), 8, 100), l, i === baseIndex ? "base" : `mono-${l < base.l ? "dark" : "light"}-${Math.abs(i - baseIndex)}`);
    }
    return out;
  }
  if (mode === "analogous") {
    // ±30° 邻近色，基准居中
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const offset = lerp(-30, 30, t);
      const role = Math.abs(offset) < 0.5 ? "base" : offset < 0 ? `analog-left-${Math.round(-offset)}` : `analog-right-${Math.round(offset)}`;
      push(base.h + offset, base.s, base.l, role);
    }
    return out;
  }
  const spec = HARMONY_OFFSETS[mode];
  for (let i = 0; i < count; i++) {
    const hueIndex = i % spec.offsets.length;
    const level = Math.floor(i / spec.offsets.length);
    push(base.h + spec.offsets[hueIndex]!, base.s, ladderLightness(level, base.l), spec.names[hueIndex]! + ladderSuffix(level));
  }
  return out;
}

// ---------------------------------------------------------------- 色盲安全色板（Paul Tol / Okabe-Ito 精选）

type ColorblindType = "deuteranopia-safe" | "protanopia-safe" | "tritanopia-safe" | "all-safe";

interface NamedColor {
  readonly hex: string;
  readonly name: string;
}

/** Okabe-Ito 全套（全色盲安全基准）；红绿色盲（deutan/protan）避开红绿轴；蓝黄色盲（tritan）避开蓝黄轴 */
const CVD_SAFE_PALETTES: Record<ColorblindType, NamedColor[]> = {
  "all-safe": [
    { hex: "#000000", name: "Black" },
    { hex: "#e69f00", name: "Orange" },
    { hex: "#56b4e9", name: "Sky Blue" },
    { hex: "#009e73", name: "Bluish Green" },
    { hex: "#f0e442", name: "Yellow" },
    { hex: "#0072b2", name: "Blue" },
    { hex: "#d55e00", name: "Vermillion" },
    { hex: "#cc79a7", name: "Reddish Purple" },
  ],
  "deuteranopia-safe": [
    { hex: "#0072b2", name: "Blue" },
    { hex: "#56b4e9", name: "Sky Blue" },
    { hex: "#e69f00", name: "Orange" },
    { hex: "#f0e442", name: "Yellow" },
    { hex: "#000000", name: "Black" },
    { hex: "#999999", name: "Grey" },
  ],
  "protanopia-safe": [
    { hex: "#0072b2", name: "Blue" },
    { hex: "#56b4e9", name: "Sky Blue" },
    { hex: "#e69f00", name: "Orange" },
    { hex: "#f0e442", name: "Yellow" },
    { hex: "#000000", name: "Black" },
    { hex: "#999999", name: "Grey" },
  ],
  "tritanopia-safe": [
    { hex: "#d55e00", name: "Vermillion" },
    { hex: "#009e73", name: "Bluish Green" },
    { hex: "#cc79a7", name: "Reddish Purple" },
    { hex: "#000000", name: "Black" },
    { hex: "#999999", name: "Grey" },
  ],
};

// ---------------------------------------------------------------- 渐变风格（视频背景）

type GradientStyle = "warm" | "cool" | "analogous" | "complementary" | "sunset" | "ocean";

/** sunset / ocean 为固定色相锚点（不依赖基准色）；其余从基准色派生 */
const FIXED_GRADIENT_ANCHORS: Record<"sunset" | "ocean", { hues: number[]; sat: number; lFrom: number; lTo: number }> = {
  sunset: { hues: [16, 335, 268], sat: 78, lFrom: 58, lTo: 34 }, // 橙 → 品红 → 紫（电影感收暗）
  ocean: { hues: [222, 199, 176], sat: 70, lFrom: 30, lTo: 58 }, // 深蓝 → 青 → 浅蓝绿
};

function buildGradientStops(base: Hsl, style: GradientStyle, stops: number): Array<{ hex: string; position: number; hsl: { h: number; s: number; l: number } }> {
  const out: Array<{ hex: string; position: number; hsl: { h: number; s: number; l: number } }> = [];
  for (let i = 0; i < stops; i++) {
    const t = stops > 1 ? i / (stops - 1) : 0;
    let h: number;
    let s: number;
    let l: number;
    if (style === "sunset" || style === "ocean") {
      const spec = FIXED_GRADIENT_ANCHORS[style];
      const scaled = t * (spec.hues.length - 1);
      const idx = Math.min(spec.hues.length - 2, Math.floor(scaled));
      h = lerpAngle(spec.hues[idx]!, spec.hues[idx + 1]!, scaled - idx);
      s = spec.sat;
      l = lerp(spec.lFrom, spec.lTo, t);
    } else if (style === "analogous") {
      h = base.h + (t - 0.5) * 50; // ±25°
      s = Math.max(base.s, 30);
      l = base.l;
    } else if (style === "complementary") {
      h = lerpAngle(base.h, base.h + 180, t);
      s = Math.max(base.s, 40);
      l = clamp(base.l + (t - 0.5) * 24, 18, 82);
    } else if (style === "warm") {
      h = lerpAngle(base.h, 36, t * 0.85); // 向琥珀色漂移
      s = clamp(Math.max(base.s, 55) + t * 10, 0, 96);
      l = lerp(clamp(base.l - 18, 12, 46), clamp(base.l + 20, 52, 90), t);
    } else {
      h = lerpAngle(base.h, 210, t * 0.85); // cool：向青蓝色漂移
      s = clamp(Math.max(base.s, 45) + t * 6, 0, 92);
      l = lerp(clamp(base.l - 16, 14, 44), clamp(base.l + 18, 50, 88), t);
    }
    const hsl = { h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100) };
    out.push({ hex: hexOf(hslToRgb(hsl)), position: Math.round(t * 1000) / 1000, hsl: hslOut(hsl) });
  }
  return out;
}

// ---------------------------------------------------------------- 共享 schema 片段

const baseColorSchema = z.string().describe('基准颜色 "#rgb" / "#rrggbb" / "#rrggbbaa"');

// ---------------------------------------------------------------- 工具表（导出供测试直调）

export const tools: LiteTool[] = [
  // ------------------------------------------------------------ palette.harmony
  defineTool(
    "palette.harmony",
    "Derive a harmony palette from a base color: complementary / analogous / triadic / tetradic / split-complementary / monochromatic, with per-color hex + hsl + role.",
    z.object({
      base: baseColorSchema,
      mode: z.enum(["complementary", "analogous", "triadic", "tetradic", "split-complementary", "monochromatic"])
        .describe("和谐模式")
        .default("complementary"),
      count: z.number().int().min(2).max(12).describe("色板数量（超出基础角色数时按明度阶梯扩展）").optional(),
    }),
    ({ base, mode, count }) => {
      const parsed = requireColor(base, "base");
      if (!parsed.ok) return err(parsed.error);
      const size = count ?? HARMONY_DEFAULT_COUNTS[mode];
      const colors = buildHarmony(parsed.hsl, mode, size);
      return ok({ mode, count: size, base: hexOf(parsed.rgb), colors });
    },
  ),

  // ------------------------------------------------------------ palette.ramp
  defineTool(
    "palette.ramp",
    "Interpolate a color ramp between two colors (rgb / hsl shortest-hue-path / oklch-approx via hsl + perceptual lightness gamma).",
    z.object({
      from: baseColorSchema,
      to: baseColorSchema,
      steps: z.number().int().min(2).max(16).describe("色阶步数（含首尾）").default(5),
      space: z.enum(["rgb", "hsl", "oklch"]).describe("插值空间（oklch 为 HSL + γ≈2.2 亮度校正的近似）").default("rgb"),
    }),
    ({ from, to, steps, space }) => {
      const a = requireColor(from, "from");
      if (!a.ok) return err(a.error);
      const b = requireColor(to, "to");
      if (!b.ok) return err(b.error);
      const stops: Array<{ hex: string; position: number; hsl: { h: number; s: number; l: number } }> = [];
      for (let i = 0; i < steps; i++) {
        const t = steps > 1 ? i / (steps - 1) : 0;
        let rgb: Rgb;
        if (space === "rgb") {
          rgb = {
            r: lerp(a.rgb.r, b.rgb.r, t),
            g: lerp(a.rgb.g, b.rgb.g, t),
            b: lerp(a.rgb.b, b.rgb.b, t),
          };
        } else if (space === "hsl") {
          const h = lerpAngle(a.hsl.h, b.hsl.h, t);
          rgb = hslToRgb({ h, s: lerp(a.hsl.s, b.hsl.s, t), l: lerp(a.hsl.l, b.hsl.l, t) });
        } else {
          // oklch 近似：HSL 插值 + 亮度按 γ≈2.2 感知曲线校正（比朴素线性 l 更接近 OKLCH 明度均匀性）
          const perceptualA = (clamp(a.hsl.l, 0, 100) / 100) ** 2.2;
          const perceptualB = (clamp(b.hsl.l, 0, 100) / 100) ** 2.2;
          const l = (lerp(perceptualA, perceptualB, t) ** (1 / 2.2)) * 100;
          const h = lerpAngle(a.hsl.h, b.hsl.h, t);
          rgb = hslToRgb({ h, s: lerp(a.hsl.s, b.hsl.s, t), l });
        }
        stops.push({ hex: hexOf(rgb), position: Math.round(t * 1000) / 1000, hsl: hslOut(rgbToHsl(rgb)) });
      }
      return ok({ space, steps, stops });
    },
  ),

  // ------------------------------------------------------------ palette.colorblind
  defineTool(
    "palette.colorblind",
    "Named colorblind-safe color sets curated from Paul Tol / Okabe-Ito palettes (all-safe / deuteranopia / protanopia / tritanopia).",
    z.object({
      type: z.enum(["deuteranopia-safe", "protanopia-safe", "tritanopia-safe", "all-safe"]).describe("安全类型").default("all-safe"),
      count: z.number().int().min(1).max(12).describe("需要的颜色数（不得超过该安全色组容量）").optional(),
    }),
    ({ type, count }) => {
      const palette = CVD_SAFE_PALETTES[type];
      const size = count ?? palette.length;
      if (size > palette.length) {
        return err(`E_COUNT: ${type} provides ${palette.length} safe colors (requested ${size})`);
      }
      return ok({
        type,
        count: size,
        colors: palette.slice(0, size),
        source: "Paul Tol / Okabe-Ito colorblind-safe palettes",
      });
    },
  ),

  // ------------------------------------------------------------ palette.contrast
  defineTool(
    "palette.contrast",
    "WCAG contrast ratio between foreground and background with AA/AAA verdicts for normal and large text (4.5 / 3 / 7 / 4.5 thresholds).",
    z.object({
      foreground: z.string().describe('前景色 "#rgb"/"#rrggbb"/"#rrggbbaa"'),
      background: z.string().describe('背景色 "#rgb"/"#rrggbb"/"#rrggbbaa"'),
    }),
    ({ foreground, background }) => {
      const fg = requireColor(foreground, "foreground");
      if (!fg.ok) return err(fg.error);
      const bg = requireColor(background, "background");
      if (!bg.ok) return err(bg.error);
      const raw = contrastRatio(fg.rgb, bg.rgb);
      const ratio = Math.round(raw * 100) / 100;
      const aaNormal = raw >= 4.5;
      const aaLarge = raw >= 3;
      const aaaNormal = raw >= 7;
      const aaaLarge = raw >= 4.5;
      const verdict = aaaNormal ? "AAA" : aaNormal ? "AA" : aaLarge ? "AA-large" : "fail";
      return ok({ ratio, aaNormal, aaLarge, aaaNormal, aaaLarge, verdict });
    },
  ),

  // ------------------------------------------------------------ palette.bestText
  defineTool(
    "palette.bestText",
    "Pick the more readable text color (#000000 / #ffffff) for a background by relative luminance (threshold ≈ 0.179 maximizes WCAG ratio).",
    z.object({
      background: z.string().describe('背景色 "#rgb"/"#rrggbb"/"#rrggbbaa"'),
    }),
    ({ background }) => {
      const bg = requireColor(background, "background");
      if (!bg.ok) return err(bg.error);
      const luminance = relativeLuminance(bg.rgb);
      return ok({
        color: luminance > 0.179 ? "#000000" : "#ffffff",
        relativeLuminance: Math.round(luminance * 10000) / 10000,
        contrastWithBlack: Math.round(((luminance + 0.05) / 0.05) * 100) / 100,
        contrastWithWhite: Math.round((1.05 / (luminance + 0.05)) * 100) / 100,
      });
    },
  ),

  // ------------------------------------------------------------ palette.rotate
  defineTool(
    "palette.rotate",
    "Rotate/adjust a color in HSL space: hue shift (degrees), saturation multiplier, lightness multiplier (results clamped to valid ranges).",
    z.object({
      base: baseColorSchema,
      hueShift: z.number().min(-360).max(360).describe("色相偏移（度，正=顺时针）"),
      satMul: z.number().min(0).max(10).describe("饱和度倍率").default(1),
      lightMul: z.number().min(0).max(10).describe("明度倍率").default(1),
    }),
    ({ base, hueShift, satMul, lightMul }) => {
      const parsed = requireColor(base, "base");
      if (!parsed.ok) return err(parsed.error);
      const hsl = {
        h: (((parsed.hsl.h + hueShift) % 360) + 360) % 360,
        s: clamp(parsed.hsl.s * satMul, 0, 100),
        l: clamp(parsed.hsl.l * lightMul, 0, 100),
      };
      return ok({ hex: hexOf(hslToRgb(hsl)), hsl: hslOut(hsl) });
    },
  ),

  // ------------------------------------------------------------ palette.gradients
  defineTool(
    "palette.gradients",
    "Generate a video-background gradient from a base color (warm/cool/analogous/complementary/sunset/ocean): per-stop hex + positions + ready-to-use CSS linear-gradient.",
    z.object({
      base: baseColorSchema,
      style: z.enum(["warm", "cool", "analogous", "complementary", "sunset", "ocean"]).describe("渐变风格").default("analogous"),
      stops: z.number().int().min(2).max(8).describe("渐变停靠数（2-8）").default(3),
    }),
    ({ base, style, stops }) => {
      const parsed = requireColor(base, "base");
      if (!parsed.ok) return err(parsed.error);
      const colors = buildGradientStops(parsed.hsl, style, stops);
      const css = `linear-gradient(135deg, ${colors.map((c) => `${c.hex} ${Math.round(c.position * 100)}%`).join(", ")})`;
      return ok({ style, stops: colors.length, colors, css });
    },
  ),
];

// ---------------------------------------------------------------- stdio 入口（直调测试不触发）

if (import.meta.main) {
  await runStdioServer(tools, { serverName: "mcp-palette", serverVersion: "0.1.0" });
}
