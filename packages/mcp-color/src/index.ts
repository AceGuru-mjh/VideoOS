// @videoos/mcp-color —— 颜色解析/格式转换/WCAG 对比度/调色板派生工具服务器（stdio MCP）。
// 纯 TS 色彩数学（sRGB↔HSL、WCAG 相对亮度、线性 RGB 混合），零依赖零网络。
// 时间线用途：视频与字幕配色校验（WCAG AA/AAA 对比度）、主题色板派生、多色和谐度 lint。
import { defineTool, err, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Hsl {
  readonly h: number; // 0-360（浮点，展示时取整）
  readonly s: number; // 0-100
  readonly l: number; // 0-100
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function hexOf(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hslToRgb(hsl: Hsl): Rgb {
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

function rgbToHsl(rgb: Rgb): Hsl {
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

/** 解析 hex(#rgb/#rrggbb/#rrggbbaa)/rgb()/rgba()/hsl()/hsla()；alpha 一律丢弃（输出恒为 #rrggbb） */
function parseColor(value: string): { ok: true; rgb: Rgb } | { ok: false; reason: string } {
  const v = value.trim().toLowerCase();
  if (v === "") return { ok: false, reason: "empty color value" };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex !== null) {
    const digits = hex[1]!;
    if (digits.length === 3) {
      return {
        ok: true,
        rgb: {
          r: Number.parseInt(digits[0]!.repeat(2), 16),
          g: Number.parseInt(digits[1]!.repeat(2), 16),
          b: Number.parseInt(digits[2]!.repeat(2), 16),
        },
      };
    }
    return {
      ok: true,
      rgb: {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
      },
    };
  }
  const rgbM = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/ ]\s*(?:\d*\.?\d+%?)\s*)?\)$/.exec(v);
  if (rgbM !== null) {
    const r = Number.parseInt(rgbM[1]!, 10);
    const g = Number.parseInt(rgbM[2]!, 10);
    const b = Number.parseInt(rgbM[3]!, 10);
    if (r > 255 || g > 255 || b > 255) {
      return { ok: false, reason: `rgb channels must be 0-255: ${JSON.stringify(value)}` };
    }
    return { ok: true, rgb: { r, g, b } };
  }
  const hslM = /^hsla?\(\s*(\d*\.?\d+)(?:deg)?\s*[, ]\s*(\d*\.?\d+)%\s*[, ]\s*(\d*\.?\d+)%\s*(?:[,/ ]\s*(?:\d*\.?\d+%?)\s*)?\)$/.exec(v);
  if (hslM !== null) {
    const h = Number.parseFloat(hslM[1]!);
    const s = Number.parseFloat(hslM[2]!);
    const l = Number.parseFloat(hslM[3]!);
    if (h > 360 || s > 100 || l > 100) {
      return { ok: false, reason: `hsl out of range (h<=360, s/l<=100%): ${JSON.stringify(value)}` };
    }
    return { ok: true, rgb: hslToRgb({ h, s, l }) };
  }
  return {
    ok: false,
    reason: `unrecognized color (expected #rgb/#rrggbb/#rrggbbaa, rgb(r,g,b) or hsl(h,s%,l%)): ${JSON.stringify(value)}`,
  };
}

/** 解析失败 → 抛 E_COLOR（工具内需要颜色实体的场合） */
function requireRgb(value: string, field: string): Rgb {
  const parsed = parseColor(value);
  if (!parsed.ok) throw new ToolError("E_COLOR", `${field}: ${parsed.reason}`);
  return parsed.rgb;
}

/** WCAG 相对亮度（sRGB 线性化，0-1） */
function channelLin(c: number): number {
  const t = c / 255;
  return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
}

function channelEncode(lin: number): number {
  return lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channelLin(rgb.r) + 0.7152 * channelLin(rgb.g) + 0.0722 * channelLin(rgb.b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 展示用 HSL（整数） */
function hslDisplay(hsl: Hsl): [number, number, number] {
  return [Math.round(hsl.h) % 360, Math.round(hsl.s), Math.round(hsl.l)];
}

type Scheme = "complementary" | "analogous" | "triadic" | "tetradic" | "monochrome" | "shades";

/** 明度阶梯：level 0 = 基准，1=+12，2=-12，3=+24，4=-24 …（clamp 6-94） */
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

function buildPalette(base: Hsl, scheme: Scheme, count: number): Array<{ hex: string; role: string }> {
  const out: Array<{ hex: string; role: string }> = [];
  const at = (offset: number, l: number): string => hexOf(hslToRgb({ h: base.h + offset, s: base.s, l }));
  if (scheme === "analogous") {
    const step = count > 1 ? 60 / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      const off = -30 + step * i;
      const role =
        Math.abs(off) < 0.51
          ? "base"
          : off < 0
            ? `analog-left-${Math.round(-off)}`
            : `analog-right-${Math.round(off)}`;
      out.push({ hex: at(off, base.l), role });
    }
  } else if (scheme === "monochrome") {
    for (let i = 0; i < count; i++) {
      const suffix = ladderSuffix(i);
      out.push({ hex: at(0, ladderLightness(i, base.l)), role: suffix === "" ? "base" : suffix.slice(1) });
    }
  } else if (scheme === "shades") {
    const lo = clamp(base.l - 25, 8, 70);
    const hi = clamp(base.l + 25, 30, 92);
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      out.push({ hex: at(0, lo + (hi - lo) * t), role: `shade-${i + 1}` });
    }
  } else {
    const offsets =
      scheme === "complementary" ? [0, 180] : scheme === "triadic" ? [0, 120, 240] : [0, 90, 180, 270];
    const names =
      scheme === "complementary"
        ? ["base", "complement"]
        : scheme === "triadic"
          ? ["base", "triad-1", "triad-2"]
          : ["base", "tetrad-1", "tetrad-2", "tetrad-3"];
    for (let i = 0; i < count; i++) {
      const hueIdx = i % offsets.length;
      const level = Math.floor(i / offsets.length);
      out.push({ hex: at(offsets[hueIdx]!, ladderLightness(level, base.l)), role: names[hueIdx]! + ladderSuffix(level) });
    }
  }
  return out;
}

const tools = [
  defineTool(
    "color.parse",
    "Parse any color (hex #rgb/#rrggbb/#rrggbbaa, rgb(), hsl()) to hex + rgb + hsl; reports validity instead of throwing on bad input.",
    z.object({ value: z.string().describe("color string, e.g. \"#22d3ee\", \"rgb(12, 34, 56)\", \"hsl(210, 65%, 13%)\"") }),
    ({ value }) => {
      const parsed = parseColor(value);
      if (!parsed.ok) return ok({ valid: false, reason: parsed.reason });
      const rgb = parsed.rgb;
      return ok({
        valid: true,
        hex: hexOf(rgb),
        rgb: [rgb.r, rgb.g, rgb.b],
        hsl: hslDisplay(rgbToHsl(rgb)),
      });
    },
  ),
  defineTool(
    "color.convert",
    "Convert a color to hex / rgb / hsl / css string form (css returns \"rgb(r, g, b)\").",
    z.object({
      value: z.string().describe("source color (hex/rgb()/hsl())"),
      to: z.enum(["hex", "rgb", "hsl", "css"]).describe("target format"),
    }),
    ({ value, to }) => {
      const rgb = requireRgb(value, "value");
      const hsl = rgbToHsl(rgb);
      const [h, s, l] = hslDisplay(hsl);
      switch (to) {
        case "hex":
          return ok({ output: hexOf(rgb), format: to });
        case "rgb":
        case "css":
          return ok({ output: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, format: to });
        case "hsl":
          return ok({ output: `hsl(${h}, ${s}%, ${l}%)`, format: to });
      }
    },
  ),
  defineTool(
    "color.contrast",
    "WCAG contrast ratio between two colors with AA/AAA verdicts (4.5 / 7 / 3 thresholds); use for subtitle & text-on-video checks.",
    z.object({
      foreground: z.string().describe("foreground color (text)"),
      background: z.string().describe("background color"),
    }),
    ({ foreground, background }) => {
      const fg = requireRgb(foreground, "foreground");
      const bg = requireRgb(background, "background");
      const raw = contrastRatio(fg, bg);
      const ratio = round(raw, 2);
      return ok({
        ratio,
        aa: raw >= 4.5,
        aaa: raw >= 7,
        aaLarge: raw >= 3,
      });
    },
  ),
  defineTool(
    "color.luminance",
    "Relative luminance (WCAG, 0-1) and perceived brightness (luma percentage, 0-100) of a color.",
    z.object({ value: z.string().describe("color (hex/rgb()/hsl())") }),
    ({ value }) => {
      const rgb = requireRgb(value, "value");
      return ok({
        relative: round(relativeLuminance(rgb), 4),
        perceived: round(((0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255) * 100, 2),
      });
    },
  ),
  defineTool(
    "color.palette",
    "Derive a palette from a base color by HSL rotation (complementary/analogous/triadic/tetradic) or lightness ladder (monochrome/shades).",
    z.object({
      base: z.string().describe("base color (hex/rgb()/hsl())"),
      scheme: z
        .enum(["complementary", "analogous", "triadic", "tetradic", "monochrome", "shades"])
        .describe("derivation scheme")
        .default("complementary"),
      count: z.number().int().min(1).max(10).describe("palette size (1-10)").default(5),
    }),
    ({ base, scheme, count }) => {
      const rgb = requireRgb(base, "base");
      const colors = buildPalette(rgbToHsl(rgb), scheme, count);
      return ok({ scheme, count, colors });
    },
  ),
  defineTool(
    "color.mix",
    "Mix two colors in linear RGB space (ratio 0 = a, 1 = b); returns hex.",
    z.object({
      a: z.string().describe("first color"),
      b: z.string().describe("second color"),
      ratio: z.number().min(0).max(1).describe("weight of b in the mix (default 0.5)").default(0.5),
    }),
    ({ a, b, ratio }) => {
      const ra = requireRgb(a, "a");
      const rb = requireRgb(b, "b");
      const t = clamp(ratio, 0, 1);
      const mixed: Rgb = {
        r: Math.round(channelEncode(channelLin(ra.r) * (1 - t) + channelLin(rb.r) * t) * 255),
        g: Math.round(channelEncode(channelLin(ra.g) * (1 - t) + channelLin(rb.g) * t) * 255),
        b: Math.round(channelEncode(channelLin(ra.b) * (1 - t) + channelLin(rb.b) * t) * 255),
      };
      return ok({ hex: hexOf(mixed), ratio: t });
    },
  ),
  defineTool(
    "color.harmonize",
    "Lint a set of colors for video palettes: min adjacent contrast, average saturation, and actionable advice.",
    z.object({
      colors: z.array(z.string()).min(2).max(12).describe("ordered color list; adjacency = list order"),
    }),
    ({ colors }) => {
      const rgbs = colors.map((c, i) => requireRgb(c, `colors[${i}]`));
      const sats = rgbs.map((rgb) => rgbToHsl(rgb).s);
      const advice: string[] = [];
      let minContrast = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < rgbs.length; i++) {
        const ratio = contrastRatio(rgbs[i]!, rgbs[i + 1]!);
        minContrast = Math.min(minContrast, ratio);
        if (ratio < 3) {
          advice.push(
            `contrast between ${colors[i]} and ${colors[i + 1]} is ${round(ratio, 2)}:1 (<3:1): adjacent colors are hard to tell apart — separate their lightness`,
          );
        }
      }
      const avgSaturation = round(sats.reduce((a, b) => a + b, 0) / sats.length, 1);
      const spread = round(Math.max(...sats) - Math.min(...sats), 1);
      if (spread <= 8) {
        advice.push(
          `all colors share similar saturation (avg ${avgSaturation}%, spread ${spread}pt): palette may look flat — vary saturation for hierarchy`,
        );
      }
      if (advice.length === 0) {
        advice.push(
          `palette looks well-balanced: min adjacent contrast ${round(minContrast, 2)}:1, saturation spread ${spread}pt`,
        );
      }
      return ok({ count: colors.length, minContrast: round(minContrast, 2), avgSaturation, advice });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-color", serverVersion: "0.1.0" });
