// palette-forge —— 调色板锻造：palette.fromSeed 用 HSL 旋转从种子色生成 5 色品牌板 + BRAND DSL 片段；
// palette.contrast 自实现 WCAG 相对亮度对比度（aa ≥ 4.5 / aaa ≥ 7）；palette.tints 生成明度梯度。
// 纯数学实现，零依赖（hex/rgb/hsl 互转全部本地实现）。
import type { PluginContext } from "@videoos/plugin-kit";

const HEX_SCHEMA = { regex: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/ };

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const digits = hex.replace("#", "");
  const expanded = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits;
  const num = Number.parseInt(expanded, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

/** WCAG 相对亮度（sRGB，阈值 0.03928） */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "palette-forge.palette.fromSeed",
    description: "Forge a 5-color brand palette (primary/secondary/accent/surface/deep) from a seed hex color via HSL rotations; includes a `const BRAND = {...}` DSL snippet.",
    schema: ctx.z.object({
      base: ctx.z
        .string()
        .regex(HEX_SCHEMA.regex, 'base must be "#rgb" or "#rrggbb"')
        .describe('seed color, e.g. "#22d3ee"'),
      scheme: ctx.z
        .enum(["analogous", "complementary", "triadic"])
        .describe("hue rotation scheme")
        .default("analogous"),
    }),
    run: ({ base, scheme }) => {
      const seed = hexToRgb(base);
      const { h, s, l } = rgbToHsl(seed);
      // [secondary 旋转角, accent 旋转角]；complementary 的 accent 额外做明度偏移避免与 secondary 同色
      const rotations: Record<"analogous" | "complementary" | "triadic", [number, number]> = {
        analogous: [30, -30],
        complementary: [180, 180],
        triadic: [120, 240],
      };
      const [secondaryHue, accentHue] = rotations[scheme];
      const secondary = hslToRgb(h + secondaryHue, s, l);
      const accent =
        scheme === "complementary"
          ? hslToRgb(h + accentHue, s, l < 0.5 ? Math.min(0.9, l + 0.25) : Math.max(0.1, l - 0.25))
          : hslToRgb(h + accentHue, s, l);
      const surface = hslToRgb(h, Math.min(1, s * 0.12), 0.96);
      const deep = hslToRgb(h, Math.min(1, s * 0.85), 0.1);
      const colors = [
        { role: "primary", hex: rgbToHex(seed) },
        { role: "secondary", hex: rgbToHex(secondary) },
        { role: "accent", hex: rgbToHex(accent) },
        { role: "surface", hex: rgbToHex(surface) },
        { role: "deep", hex: rgbToHex(deep) },
      ];
      const dsl = [
        "const BRAND = {",
        ...colors.map((c) => `  ${c.role}: "${c.hex}",`),
        "};",
      ].join("\n");
      return { ok: true, data: { seed: rgbToHex(seed), scheme, colors, dsl } };
    },
  });

  ctx.registerTool({
    name: "palette-forge.palette.contrast",
    description: "WCAG contrast ratio between two colors (self-implemented relative luminance); reports aa (>= 4.5) and aaa (>= 7) verdicts.",
    schema: ctx.z.object({
      foreground: ctx.z.string().regex(HEX_SCHEMA.regex, 'foreground must be "#rgb" or "#rrggbb"').describe("text color"),
      background: ctx.z.string().regex(HEX_SCHEMA.regex, 'background must be "#rgb" or "#rrggbb"').describe("backdrop color"),
    }),
    run: ({ foreground, background }) => {
      const ratio = contrastRatio(foreground, background);
      return {
        ok: true,
        data: {
          ratio: round2(ratio),
          aa: ratio >= 4.5,
          aaa: ratio >= 7,
          foreground,
          background,
        },
      };
    },
  });

  ctx.registerTool({
    name: "palette-forge.palette.tints",
    description: "Build a lightness ramp (dark to light) from a seed color, keeping its hue/saturation; useful for gradients and layered backgrounds.",
    schema: ctx.z.object({
      base: ctx.z.string().regex(HEX_SCHEMA.regex, 'base must be "#rgb" or "#rrggbb"').describe("seed color"),
      steps: ctx.z.number().int().min(2).max(9).describe("ramp length").default(5),
    }),
    run: ({ base, steps }) => {
      const { h, s } = rgbToHsl(hexToRgb(base));
      const ramp: Array<{ lightness: number; hex: string }> = [];
      for (let i = 0; i < steps; i++) {
        const l = 0.9 - (i * 0.8) / (steps - 1); // 0.9 → 0.1 均分
        ramp.push({ lightness: round2(l), hex: rgbToHex(hslToRgb(h, s, l)) });
      }
      return { ok: true, data: { seed: base, steps, ramp } };
    },
  });
}
