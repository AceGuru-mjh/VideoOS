// @videoos/mcp-chart —— SVG 图表生成服务器（stdio MCP）：柱状/折线/面积/饼/环形/散点/雷达/热力/迷你趋势/仪表盘。
// 纯字符串模板拼 SVG：零渲染依赖（无 canvas/SVG 库）、零网络、零文件落盘；产物可直接内嵌 HTML
// 或作为 <img src="data:image/svg+xml,..."> 使用。
// 时间线用途：视频数据面板 / Analytics 卡片一步成图（Agent 直接产出可视化，无需前端图表库参与）。
// 直调可测：工具表导出为 `tools`（测试直调 handler）；仅作为入口脚本运行时才启动 stdio 服务器。
import { defineTool, err, ok, runStdioServer, type LiteTool, type LiteToolResult } from "@videoos/mcp-lite";
import { z } from "zod";

// ---------------------------------------------------------------- 主题与调色板

/** 图表主题（dark=视频面板深色 / light=文档浅色） */
type ChartTheme = "dark" | "light";

interface ThemePalette {
  readonly background: string;
  readonly panel: string;
  readonly grid: string;
  readonly axis: string;
  readonly text: string;
  readonly subtle: string;
}

const THEMES: Record<ChartTheme, ThemePalette> = {
  dark: {
    background: "#0b1220",
    panel: "#111b30",
    grid: "#24324a",
    axis: "#3b4a66",
    text: "#e6edf7",
    subtle: "#93a4c0",
  },
  light: {
    background: "#ffffff",
    panel: "#f5f8fc",
    grid: "#e2e8f2",
    axis: "#b9c4d4",
    text: "#16233b",
    subtle: "#5c6b84",
  },
};

/** 内置 12 色分类调色板（明度对齐，深浅背景均可读） */
const PALETTE: readonly string[] = [
  "#38bdf8", "#fb7185", "#facc15", "#34d399", "#fb923c", "#a78bfa",
  "#2dd4bf", "#f87171", "#60a5fa", "#e879f9", "#a3e635", "#fbbf24",
];

// ---------------------------------------------------------------- 通用小工具

/** XML 转义（& < > " '）—— 所有进入 SVG 的动态文本一律先过这里 */
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}

/** 颜色字面量校验（#rgb/#rrggbb；颜色进入 SVG 属性，必须白名单化防注入） */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 输出坐标精度（0.01px 足够渲染，且 SVG 更小） */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 千分位格式化（可选小数位；NaN/Infinity 原样输出） */
function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const digits = negative ? fixed.slice(1) : fixed;
  const parts = digits.split(".");
  const int = parts[0] ?? "0";
  const frac = parts[1];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + (frac === undefined ? grouped : `${grouped}.${frac}`);
}

/** 轴标签截断（先截断后转义，避免切断 XML 实体） */
function truncateLabel(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** 文本宽度粗估（11px 无衬线 ≈ 0.62em/拉丁字符，CJK 按 1.08em） */
function measureText(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e7f ? 1.08 : 0.62;
  return units * fontSize;
}

// ---------------------------------------------------------------- nice-ticks（1-2-5 步长）

/** 1-2-5 步长选取（工程制图惯例：量级内只取 1/2/5 倍步长） */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const multiplier = residual < 1.5 ? 1 : residual < 3.5 ? 2 : residual < 7.5 ? 5 : 10;
  return multiplier * magnitude;
}

/** 步长的最小表示小数位（0.5→1 位、0.25→2 位；上限 6 位防死循环） */
function decimalsForStep(step: number): number {
  let decimals = 0;
  let scaled = step;
  while (decimals < 6 && Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    scaled *= 10;
    decimals++;
  }
  return decimals;
}

/** nice-ticks：把 [min,max] 扩到整齐刻度（目标 5 条，首尾必是刻度；退化域自动展开） */
function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1, 2, 3, 4, 5];
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.abs(lo) >= 1 ? Math.abs(lo) * 0.25 : 0.5;
    lo -= pad;
    hi += pad;
  }
  if (lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  const step = niceStep((hi - lo) / Math.max(1, targetCount - 1));
  if (!Number.isFinite(step) || step <= 0) return [lo, (lo + hi) / 2, hi];
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const decimals = decimalsForStep(step);
  const ticks: number[] = [];
  for (let raw = start; raw <= end + step * 1e-6; raw += step) {
    ticks.push(Number(raw.toFixed(decimals)));
  }
  return ticks;
}

/** 相邻刻度步长（用于刻度标签小数位） */
function tickStepOf(ticks: readonly number[]): number {
  if (ticks.length < 2) return 1;
  const step = (ticks[ticks.length - 1]! - ticks[0]!) / (ticks.length - 1);
  return Number.isFinite(step) && step > 0 ? step : 1;
}

/** 线性比例尺（domain → range；退化域按单位宽处理防除零） */
function makeScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): (value: number) => number {
  const span = domainMax - domainMin || 1;
  const range = rangeMax - rangeMin;
  return (value: number) => rangeMin + ((value - domainMin) / span) * range;
}

// ---------------------------------------------------------------- SVG 元素工厂

const FONT_STACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

interface TextAttrs {
  readonly fill?: string;
  readonly fontSize?: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly weight?: number;
  readonly opacity?: number;
  readonly transform?: string;
}

/** <text> 元素（恒带 font-family/font-size/fill；内容过 escapeXml） */
function svgText(x: number, y: number, content: string, attrs: TextAttrs = {}): string {
  const parts: string[] = [
    `x="${round2(x)}"`,
    `y="${round2(y)}"`,
    `font-family="${FONT_STACK}"`,
    `font-size="${attrs.fontSize ?? 12}"`,
    `fill="${attrs.fill ?? "#000000"}"`,
  ];
  if (attrs.anchor !== undefined) parts.push(`text-anchor="${attrs.anchor}"`);
  if (attrs.weight !== undefined) parts.push(`font-weight="${attrs.weight}"`);
  if (attrs.opacity !== undefined) parts.push(`opacity="${attrs.opacity}"`);
  if (attrs.transform !== undefined) parts.push(`transform="${attrs.transform}"`);
  return `<text ${parts.join(" ")}>${escapeXml(content)}</text>`;
}

/** 文档头尾 + 背景 + 可访问性 <title> */
function svgDocument(body: string, meta: { width: number; height: number; theme: ChartTheme }, title?: string): string {
  const colors = THEMES[meta.theme];
  const header = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${meta.width} ${meta.height}" width="${meta.width}" height="${meta.height}" role="img">`;
  const titleEl = title === undefined ? "" : `<title>${escapeXml(title)}</title>`;
  const bg = `<rect x="0" y="0" width="${meta.width}" height="${meta.height}" fill="${colors.background}" rx="8"/>`;
  return [header, titleEl, bg, body, "</svg>"].filter((chunk) => chunk.length > 0).join("\n");
}

/** 顶部图例（色段 + 名称，居中单行） */
function legendRow(items: readonly { name: string; color: string }[], colors: ThemePalette, centerX: number, y: number): string[] {
  if (items.length === 0) return [];
  const widths = items.map((item) => 26 + measureText(truncateLabel(item.name, 18), 11));
  const total = widths.reduce((sum, w) => sum + w, 0) + (items.length - 1) * 12;
  const parts: string[] = [];
  let x = centerX - total / 2;
  items.forEach((item, i) => {
    parts.push(`<line x1="${round2(x)}" y1="${round2(y - 4)}" x2="${round2(x + 18)}" y2="${round2(y - 4)}" stroke="${item.color}" stroke-width="3" stroke-linecap="round"/>`);
    parts.push(svgText(x + 24, y, truncateLabel(item.name, 18), { fill: colors.text, fontSize: 11 }));
    x += widths[i]! + 12;
  });
  return parts;
}

/** 绘图区内边距（预留标题/图例/轴标签空间） */
interface Frame {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function frameOf(width: number, height: number, opts: { title?: boolean; legend?: boolean } = {}): Frame {
  const topBase = opts.title === true ? 44 : 18;
  return {
    left: 64,
    top: topBase + (opts.legend === true ? 28 : 0),
    right: Math.max(88, width - 24),
    bottom: Math.max(96, height - 46),
  };
}

// ---------------------------------------------------------------- 颜色小工具（热力图色阶/饼图标签）

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const digits = hex.startsWith("#") ? hex.slice(1) : hex;
  const full = digits.length === 3
    ? digits.split("").map((c) => c.repeat(2)).join("")
    : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function srgbChannelLinear(channel: number): number {
  const t = channel / 255;
  return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度（0-1）—— 热力图/饼图标签取对比文字色用 */
function relativeLuminanceOf(hex: string): number {
  const rgb = hexToRgb(hex);
  return 0.2126 * srgbChannelLinear(rgb.r) + 0.7152 * srgbChannelLinear(rgb.g) + 0.0722 * srgbChannelLinear(rgb.b);
}

/** 深底白字 / 浅底深字（按相对亮度阈值 0.45） */
function readableTextColor(hex: string): string {
  return relativeLuminanceOf(hex) > 0.45 ? "#16233b" : "#ffffff";
}

/** 热力图色阶（多段停靠点线性插值） */
type ColorScaleName = "viridis" | "ember" | "mono";

const COLOR_SCALES: Record<ColorScaleName, readonly string[]> = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  ember: ["#0f0906", "#5b2a10", "#c25a1e", "#f2a05a", "#fce8c4"],
  mono: ["#1c2230", "#5a6478", "#a9b2c3", "#eef1f6"],
};

function sampleColorScale(stops: readonly string[], t: number): string {
  if (stops.length === 0) return "#888888";
  if (stops.length === 1) return stops[0]!;
  const clamped = clamp(t, 0, 1);
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = hexToRgb(stops[idx]!);
  const b = hexToRgb(stops[idx + 1]!);
  return rgbToHex({
    r: a.r + (b.r - a.r) * frac,
    g: a.g + (b.g - a.g) * frac,
    b: a.b + (b.b - a.b) * frac,
  });
}

// ---------------------------------------------------------------- 笛卡尔坐标系（折线/面积/散点共用）

interface CartesianPlot {
  readonly frame: Frame;
  readonly xScale: (value: number) => number;
  readonly yScale: (value: number) => number;
  readonly xTicks: readonly number[];
  readonly yTicks: readonly number[];
  readonly colors: ThemePalette;
  readonly decor: string[];
  readonly titlePart: string;
}

/** 数值双轴 + 网格 + 刻度标签 + 面板底色 */
function cartesianPlot(input: {
  width: number;
  height: number;
  theme: ChartTheme;
  title?: string;
  legend: boolean;
  xDomain: { min: number; max: number };
  yDomain: { min: number; max: number };
  showGrid: boolean;
}): CartesianPlot {
  const colors = THEMES[input.theme];
  const xTicks = niceTicks(input.xDomain.min, input.xDomain.max);
  const yTicks = niceTicks(input.yDomain.min, input.yDomain.max);
  const frame = frameOf(input.width, input.height, { title: input.title !== undefined, legend: input.legend });
  const xMin = xTicks[0]!;
  const xMax = xTicks[xTicks.length - 1]!;
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;
  const xScale = makeScale(xMin, xMax, frame.left + 6, frame.right - 6);
  const yScale = makeScale(yMin, yMax, frame.bottom - 4, frame.top + 4);
  const xDecimals = decimalsForStep(tickStepOf(xTicks));
  const yDecimals = decimalsForStep(tickStepOf(yTicks));
  const decor: string[] = [];
  decor.push(`<rect x="${frame.left}" y="${frame.top}" width="${round2(frame.right - frame.left)}" height="${round2(frame.bottom - frame.top)}" fill="${colors.panel}" rx="6"/>`);
  if (input.showGrid) {
    for (const tick of yTicks) {
      if (tick === yMin) continue;
      decor.push(`<line x1="${frame.left}" y1="${round2(yScale(tick))}" x2="${frame.right}" y2="${round2(yScale(tick))}" stroke="${colors.grid}" stroke-width="1"/>`);
    }
    for (const tick of xTicks) {
      if (tick === xMin || tick === xMax) continue;
      decor.push(`<line x1="${round2(xScale(tick))}" y1="${frame.top}" x2="${round2(xScale(tick))}" y2="${frame.bottom}" stroke="${colors.grid}" stroke-width="1"/>`);
    }
  }
  decor.push(`<line x1="${frame.left}" y1="${frame.bottom}" x2="${frame.right}" y2="${frame.bottom}" stroke="${colors.axis}" stroke-width="1.5"/>`);
  decor.push(`<line x1="${frame.left}" y1="${frame.top}" x2="${frame.left}" y2="${frame.bottom}" stroke="${colors.axis}" stroke-width="1.5"/>`);
  for (const tick of yTicks) {
    decor.push(svgText(frame.left - 8, yScale(tick) + 4, formatNumber(tick, yDecimals), { anchor: "end", fill: colors.subtle, fontSize: 11 }));
  }
  for (const tick of xTicks) {
    decor.push(svgText(xScale(tick), frame.bottom + 18, formatNumber(tick, xDecimals), { anchor: "middle", fill: colors.subtle, fontSize: 11 }));
  }
  const titlePart = input.title === undefined
    ? ""
    : svgText(input.width / 2, 24, input.title, { anchor: "middle", fill: colors.text, fontSize: 15, weight: 600 });
  return { frame, xScale, yScale, xTicks, yTicks, colors, decor, titlePart };
}

// ---------------------------------------------------------------- 共享 schema 片段

const themeSchema = z.enum(["dark", "light"]).describe("主题：dark 深色视频面板 / light 浅色文档").default("dark");
const widthSchema = z.number().int().min(120).max(4096).describe("画布宽度 px").default(800);
const heightSchema = z.number().int().min(120).max(4096).describe("画布高度 px").default(450);
const titleSchema = z.string().max(120).describe("图表标题（可省略）").optional();
const optionalHexSchema = z.string().describe('可选颜色字面量 "#rgb" 或 "#rrggbb"').optional();
const showGridSchema = z.boolean().describe("是否绘制网格线").default(true);

/** 校验可选 hex 颜色（非法 → err 文案） */
function checkHexColor(value: string | undefined, field: string): { ok: true } | { ok: false; error: string } {
  if (value === undefined || HEX_COLOR_RE.test(value)) return { ok: true };
  return { ok: false, error: `E_COLOR: ${field} must be "#rgb" or "#rrggbb" hex literal: ${JSON.stringify(value)}` };
}

// ---------------------------------------------------------------- 工具表（导出供测试直调）

export const tools: LiteTool[] = [
  // ------------------------------------------------------------ chart.bar
  defineTool(
    "chart.bar",
    "Render a categorical bar chart as a standalone SVG string (nice-tick value axis, optional grid/values/theme, thousands-grouped labels).",
    z.object({
      title: titleSchema,
      data: z.array(z.object({
        label: z.string().max(64).describe("类目标签"),
        value: z.number().finite().describe("数值"),
        color: optionalHexSchema,
      })).min(1).max(200).describe("类目数据（label + value，1-200 条）"),
      width: widthSchema,
      height: heightSchema,
      theme: themeSchema,
      showGrid: showGridSchema,
      showValues: z.boolean().describe("是否在柱顶标注数值").default(true),
    }),
    ({ title, data, width, height, theme, showGrid, showValues }) => {
      for (let i = 0; i < data.length; i++) {
        const colorCheck = checkHexColor(data[i]!.color, `data[${i}].color`);
        if (!colorCheck.ok) return err(colorCheck.error);
      }
      const colors = THEMES[theme];
      const values = data.map((item) => item.value);
      const yTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
      const yMin = yTicks[0]!;
      const yMax = yTicks[yTicks.length - 1]!;
      const frame = frameOf(width, height, { title: title !== undefined });
      const yScale = makeScale(yMin, yMax, frame.bottom - 2, frame.top + 2);
      const baseline = yScale(0);
      const slot = (frame.right - frame.left) / data.length;
      const barWidth = Math.min(64, Math.max(4, slot * 0.7));
      const decimals = decimalsForStep(tickStepOf(yTicks));
      const labelStride = Math.max(1, Math.ceil(16 / slot));
      const parts: string[] = [];
      parts.push(`<rect x="${frame.left}" y="${frame.top}" width="${round2(frame.right - frame.left)}" height="${round2(frame.bottom - frame.top)}" fill="${colors.panel}" rx="6"/>`);
      if (showGrid) {
        for (const tick of yTicks) {
          if (tick === yMin) continue;
          const y = round2(yScale(tick));
          parts.push(`<line x1="${frame.left}" y1="${y}" x2="${frame.right}" y2="${y}" stroke="${colors.grid}" stroke-width="1"/>`);
        }
      }
      data.forEach((item, i) => {
        const color = item.color !== undefined ? item.color.toLowerCase() : PALETTE[i % PALETTE.length]!;
        const centerX = frame.left + slot * i + slot / 2;
        const y = yScale(item.value);
        const top = Math.min(y, baseline);
        const barHeight = Math.max(Math.abs(baseline - y), 1);
        parts.push(`<rect x="${round2(centerX - barWidth / 2)}" y="${round2(top)}" width="${round2(barWidth)}" height="${round2(barHeight)}" fill="${color}" rx="3"/>`);
        if (showValues && barWidth >= 26) {
          const above = item.value >= 0;
          parts.push(svgText(centerX, above ? top - 6 : top + barHeight + 14, formatNumber(item.value, decimals), { anchor: "middle", fill: colors.text, fontSize: 11 }));
        }
        if (i % labelStride === 0) {
          parts.push(svgText(centerX, frame.bottom + 18, truncateLabel(item.label, 12), { anchor: "middle", fill: colors.subtle, fontSize: 11 }));
        }
      });
      parts.push(`<line x1="${frame.left}" y1="${frame.bottom}" x2="${frame.right}" y2="${frame.bottom}" stroke="${colors.axis}" stroke-width="1.5"/>`);
      parts.push(`<line x1="${frame.left}" y1="${frame.top}" x2="${frame.left}" y2="${frame.bottom}" stroke="${colors.axis}" stroke-width="1.5"/>`);
      for (const tick of yTicks) {
        parts.push(svgText(frame.left - 8, yScale(tick) + 4, formatNumber(tick, decimals), { anchor: "end", fill: colors.subtle, fontSize: 11 }));
      }
      if (title !== undefined) {
        parts.push(svgText(width / 2, 24, title, { anchor: "middle", fill: colors.text, fontSize: 15, weight: 600 }));
      }
      return ok({ svg: svgDocument(parts.join("\n"), { width, height, theme }, title), width, height, count: data.length, yMin, yMax });
    },
  ),

  // ------------------------------------------------------------ chart.line
  defineTool(
    "chart.line",
    "Render a multi-series line chart as SVG (numeric x/y axes with nice ticks, legend, optional point markers).",
    z.object({
      title: titleSchema,
      series: z.array(z.object({
        name: z.string().max(48).describe("序列名（图例）"),
        points: z.array(z.object({
          x: z.number().finite().describe("x 值"),
          y: z.number().finite().describe("y 值"),
        })).min(1).max(2000).describe("数据点（建议按 x 升序）"),
        color: optionalHexSchema,
      })).min(1).max(20).describe("序列列表（1-20 条）"),
      width: widthSchema,
      height: heightSchema,
      theme: themeSchema,
      showGrid: showGridSchema,
      showPoints: z.boolean().describe("是否绘制数据点圆标（点数 ≤ 80 时生效）").default(true),
    }),
    ({ title, series, width, height, theme, showGrid, showPoints }) => {
      for (let i = 0; i < series.length; i++) {
        const colorCheck = checkHexColor(series[i]!.color, `series[${i}].color`);
        if (!colorCheck.ok) return err(colorCheck.error);
      }
      const allPoints = series.flatMap((s) => s.points);
      const xs = allPoints.map((p) => p.x);
      const ys = allPoints.map((p) => p.y);
      const hasLegend = series.length > 1;
      const plot = cartesianPlot({
        width,
        height,
        theme,
        title,
        legend: hasLegend,
        xDomain: { min: Math.min(...xs), max: Math.max(...xs) },
        yDomain: { min: Math.min(...ys), max: Math.max(...ys) },
        showGrid,
      });
      const parts: string[] = [...plot.decor];
      series.forEach((item, i) => {
        const color = item.color !== undefined ? item.color.toLowerCase() : PALETTE[i % PALETTE.length]!;
        const coords = item.points.map((p) => `${round2(plot.xScale(p.x))},${round2(plot.yScale(p.y))}`);
        if (coords.length >= 2) {
          parts.push(`<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
        }
        if (showPoints && item.points.length <= 80) {
          for (const p of item.points) {
            parts.push(`<circle cx="${round2(plot.xScale(p.x))}" cy="${round2(plot.yScale(p.y))}" r="2.6" fill="${color}"/>`);
          }
        }
      });
      if (hasLegend) {
        parts.push(...legendRow(
          series.map((item, i) => ({ name: item.name, color: item.color !== undefined ? item.color.toLowerCase() : PALETTE[i % PALETTE.length]! })),
          plot.colors,
          width / 2,
          plot.frame.top - 12,
        ));
      }
      if (plot.titlePart !== "") parts.push(plot.titlePart);
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, title),
        width,
        height,
        seriesCount: series.length,
        pointCount: allPoints.length,
        xDomain: [plot.xTicks[0]!, plot.xTicks[plot.xTicks.length - 1]!],
        yDomain: [plot.yTicks[0]!, plot.yTicks[plot.yTicks.length - 1]!],
      });
    },
  ),

  // ------------------------------------------------------------ chart.area
  defineTool(
    "chart.area",
    "Render a single-series area chart as SVG (gradient fill under the line, numeric axes with nice ticks).",
    z.object({
      title: titleSchema,
      points: z.array(z.object({
        x: z.number().finite().describe("x 值"),
        y: z.number().finite().describe("y 值"),
      })).min(2).max(2000).describe("单序列数据点（≥2 个，建议按 x 升序）"),
      color: optionalHexSchema,
      width: widthSchema,
      height: heightSchema,
      theme: themeSchema,
      showGrid: showGridSchema,
      showValues: z.boolean().describe("是否标注各点数值（点数 ≤ 24 时生效）").default(false),
    }),
    ({ title, points, color, width, height, theme, showGrid, showValues }) => {
      const colorCheck = checkHexColor(color, "color");
      if (!colorCheck.ok) return err(colorCheck.error);
      const accent = color !== undefined ? color.toLowerCase() : PALETTE[0]!;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const plot = cartesianPlot({
        width,
        height,
        theme,
        title,
        legend: false,
        xDomain: { min: Math.min(...xs), max: Math.max(...xs) },
        yDomain: { min: Math.min(...ys), max: Math.max(...ys) },
        showGrid,
      });
      const baseline = plot.frame.bottom - 2;
      const coords = points.map((p) => `${round2(plot.xScale(p.x))},${round2(plot.yScale(p.y))}`);
      const defs = `<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${accent}" stop-opacity="0.42"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.04"/></linearGradient></defs>`;
      const parts: string[] = [defs, ...plot.decor];
      parts.push(`<path d="M ${coords.join(" L ")} L ${round2(plot.xScale(points[points.length - 1]!.x))},${round2(baseline)} L ${round2(plot.xScale(points[0]!.x))},${round2(baseline)} Z" fill="url(#areaGradient)" stroke="none"/>`);
      parts.push(`<polyline points="${coords.join(" ")}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
      for (const p of points) {
        parts.push(`<circle cx="${round2(plot.xScale(p.x))}" cy="${round2(plot.yScale(p.y))}" r="2.6" fill="${accent}"/>`);
      }
      if (showValues && points.length <= 24) {
        for (const p of points) {
          parts.push(svgText(plot.xScale(p.x), plot.yScale(p.y) - 8, formatNumber(p.y, 1), { anchor: "middle", fill: plot.colors.text, fontSize: 10 }));
        }
      }
      if (plot.titlePart !== "") parts.push(plot.titlePart);
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, title),
        width,
        height,
        pointCount: points.length,
        xDomain: [plot.xTicks[0]!, plot.xTicks[plot.xTicks.length - 1]!],
        yDomain: [plot.yTicks[0]!, plot.yTicks[plot.yTicks.length - 1]!],
      });
    },
  ),

  // ------------------------------------------------------------ chart.pie / chart.donut
  defineTool(
    "chart.pie",
    "Render a pie chart as SVG (percentage labels, legend, optional donut ring via donut=true with center title).",
    z.object({
      title: titleSchema,
      data: z.array(z.object({
        label: z.string().max(48).describe("扇区标签"),
        value: z.number().finite().describe("数值（≥0）"),
        color: optionalHexSchema,
      })).min(1).max(60).describe("扇区数据"),
      size: z.number().int().min(120).max(2048).describe("正方形绘图区边长 px").default(320),
      donut: z.boolean().describe("true → 环形图（中心留空可放标题）").default(false),
      holeRatio: z.number().min(0.2).max(0.9).describe("环形内径比例（donut=true 时生效）").default(0.6),
      theme: themeSchema,
      showLabels: z.boolean().describe("扇区上是否标注百分比").default(true),
      showLegend: z.boolean().describe("右侧是否绘制图例").default(true),
    }),
    (input) => renderPie(input),
  ),
  defineTool(
    "chart.donut",
    "Render a donut (ring) chart as SVG — pie with donut=true shortcut; center shows the title and total.",
    z.object({
      title: titleSchema,
      data: z.array(z.object({
        label: z.string().max(48).describe("扇区标签"),
        value: z.number().finite().describe("数值（≥0）"),
        color: optionalHexSchema,
      })).min(1).max(60).describe("扇区数据"),
      size: z.number().int().min(120).max(2048).describe("正方形绘图区边长 px").default(320),
      holeRatio: z.number().min(0.2).max(0.9).describe("环形内径比例").default(0.6),
      theme: themeSchema,
      showLabels: z.boolean().describe("扇区上是否标注百分比").default(true),
      showLegend: z.boolean().describe("右侧是否绘制图例").default(true),
    }),
    (input) => renderPie({ ...input, donut: true }),
  ),

  // ------------------------------------------------------------ chart.scatter
  defineTool(
    "chart.scatter",
    "Render a scatter plot as SVG (numeric axes with nice ticks, configurable dot radius, optional per-point labels).",
    z.object({
      title: titleSchema,
      points: z.array(z.object({
        x: z.number().finite().describe("x 值"),
        y: z.number().finite().describe("y 值"),
        label: z.string().max(32).describe("可选点旁标签").optional(),
      })).min(1).max(2000).describe("散点"),
      radius: z.number().min(1).max(20).describe("点半径 px").default(4),
      color: optionalHexSchema,
      width: widthSchema,
      height: heightSchema,
      theme: themeSchema,
      showGrid: showGridSchema,
    }),
    ({ title, points, radius, color, width, height, theme, showGrid }) => {
      const colorCheck = checkHexColor(color, "color");
      if (!colorCheck.ok) return err(colorCheck.error);
      const accent = color !== undefined ? color.toLowerCase() : PALETTE[0]!;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const plot = cartesianPlot({
        width,
        height,
        theme,
        title,
        legend: false,
        xDomain: { min: Math.min(...xs), max: Math.max(...xs) },
        yDomain: { min: Math.min(...ys), max: Math.max(...ys) },
        showGrid,
      });
      const parts: string[] = [...plot.decor];
      for (const p of points) {
        const cx = round2(plot.xScale(p.x));
        const cy = round2(plot.yScale(p.y));
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${round2(radius)}" fill="${accent}" fill-opacity="0.85"/>`);
        if (p.label !== undefined) {
          parts.push(svgText(cx + radius + 5, cy - radius - 2, truncateLabel(p.label, 16), { fill: plot.colors.subtle, fontSize: 10 }));
        }
      }
      if (plot.titlePart !== "") parts.push(plot.titlePart);
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, title),
        width,
        height,
        pointCount: points.length,
        xDomain: [plot.xTicks[0]!, plot.xTicks[plot.xTicks.length - 1]!],
        yDomain: [plot.yTicks[0]!, plot.yTicks[plot.yTicks.length - 1]!],
      });
    },
  ),

  // ------------------------------------------------------------ chart.radar
  defineTool(
    "chart.radar",
    "Render a radar (spider) chart as SVG (concentric grid rings, per-axis max, multi-series polygons, legend).",
    z.object({
      title: titleSchema,
      axes: z.array(z.object({
        label: z.string().max(32).describe("轴标签"),
        max: z.number().finite().describe("该轴最大值（>0）"),
      })).min(3).max(16).describe("维度轴（3-16 个）"),
      series: z.array(z.object({
        name: z.string().max(48).describe("序列名（图例）"),
        values: z.array(z.number().finite()).describe("各轴取值（长度须等于轴数，超出 ±max 裁剪）"),
        color: optionalHexSchema,
      })).min(1).max(12).describe("序列列表"),
      size: z.number().int().min(240).max(2048).describe("正方形绘图区边长 px").default(420),
      theme: themeSchema,
    }),
    ({ title, axes, series, size, theme }) => {
      for (let i = 0; i < axes.length; i++) {
        if (!(axes[i]!.max > 0)) return err(`E_DATA: axes[${i}].max must be > 0 (got ${axes[i]!.max})`);
      }
      for (let s = 0; s < series.length; s++) {
        const colorCheck = checkHexColor(series[s]!.color, `series[${s}].color`);
        if (!colorCheck.ok) return err(colorCheck.error);
        if (series[s]!.values.length !== axes.length) {
          return err(`E_DATA: series[${s}].values length (${series[s]!.values.length}) must match axes length (${axes.length})`);
        }
      }
      const colors = THEMES[theme];
      const hasTitle = title !== undefined;
      const legendHeight = 30;
      const width = size;
      const height = size + (hasTitle ? 32 : 8) + legendHeight;
      const cx = size / 2;
      const cy = (hasTitle ? 32 : 8) + size / 2;
      const rMax = size * 0.34;
      const axisCount = axes.length;
      const angleOf = (i: number): number => (i * 360) / axisCount;
      const vertex = (i: number, radius: number): [number, number] => polarPoint(cx, cy, radius, angleOf(i));
      const parts: string[] = [];
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        const ring = axes.map((_, i) => vertex(i, rMax * fraction).map(round2).join(",")).join(" ");
        parts.push(`<polygon points="${ring}" fill="none" stroke="${colors.grid}" stroke-width="1"/>`);
      }
      axes.forEach((axis, i) => {
        const [vx, vy] = vertex(i, rMax);
        parts.push(`<line x1="${round2(cx)}" y1="${round2(cy)}" x2="${round2(vx)}" y2="${round2(vy)}" stroke="${colors.axis}" stroke-width="1"/>`);
        const [lx, ly] = vertex(i, rMax + 20);
        const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
        parts.push(svgText(lx, ly + 4, truncateLabel(axis.label, 10), { anchor, fill: colors.subtle, fontSize: 11 }));
      });
      const seriesColors = series.map((item, i) => item.color !== undefined ? item.color.toLowerCase() : PALETTE[i % PALETTE.length]!);
      series.forEach((item, s) => {
        const color = seriesColors[s]!;
        const ring = item.values.map((value, i) => {
          const axisMax = axes[i]!.max;
          const clamped = clamp(value, -axisMax, axisMax);
          return vertex(i, (clamped / axisMax) * rMax).map(round2).join(",");
        }).join(" ");
        parts.push(`<polygon points="${ring}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
      });
      parts.push(...legendRow(series.map((item, i) => ({ name: item.name, color: seriesColors[i]! })), colors, cx, height - 12));
      if (hasTitle) {
        parts.push(svgText(width / 2, 22, title, { anchor: "middle", fill: colors.text, fontSize: 15, weight: 600 }));
      }
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, title),
        width,
        height,
        axesCount: axisCount,
        seriesCount: series.length,
      });
    },
  ),

  // ------------------------------------------------------------ chart.heatmap
  defineTool(
    "chart.heatmap",
    "Render a heatmap as SVG (rows × cols grid, viridis/ember/mono color scale, value annotations, scale bar).",
    z.object({
      title: titleSchema,
      rows: z.array(z.string().max(32)).min(1).max(60).describe("行标签"),
      cols: z.array(z.string().max(32)).min(1).max(60).describe("列标签"),
      cells: z.array(z.object({
        row: z.number().int().min(0).describe("行下标（0 起）"),
        col: z.number().int().min(0).describe("列下标（0 起）"),
        value: z.number().finite().describe("单元格数值"),
      })).min(1).max(3600).describe("单元格（row/col 引用下标，不可重复）"),
      colorScale: z.enum(["viridis", "ember", "mono"]).describe("色阶").default("viridis"),
      width: z.number().int().min(240).max(4096).describe("画布宽度 px").default(640),
      height: z.number().int().min(200).max(4096).describe("画布高度 px").default(480),
      theme: themeSchema,
      showValues: z.boolean().describe("格子足够大时是否标注数值").default(true),
    }),
    ({ title, rows, cols, cells, colorScale, width, height, theme, showValues }) => {
      const seen = new Set<string>();
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (cell.row >= rows.length || cell.col >= cols.length) {
          return err(`E_DATA: cells[${i}] references row ${cell.row} / col ${cell.col} outside the ${rows.length}×${cols.length} grid`);
        }
        const key = `${cell.row}:${cell.col}`;
        if (seen.has(key)) return err(`E_DATA: duplicate cell at row ${cell.row}, col ${cell.col}`);
        seen.add(key);
      }
      const colors = THEMES[theme];
      const stops = COLOR_SCALES[colorScale];
      const values = cells.map((c) => c.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const hasTitle = title !== undefined;
      const rowLabelWidth = Math.min(150, Math.max(36, ...rows.map((label) => measureText(truncateLabel(label, 12), 11) + 10)));
      const colLabelHeight = 30;
      const legendHeight = 36;
      const left = 12 + rowLabelWidth;
      const top = (hasTitle ? 34 : 10) + colLabelHeight;
      const cellWidth = (width - left - 14) / cols.length;
      const cellHeight = (height - top - legendHeight - 6) / rows.length;
      const parts: string[] = [];
      const valueByCell = new Map<string, number>(cells.map((c) => [`${c.row}:${c.col}`, c.value]));
      rows.forEach((rowLabel, r) => {
        cols.forEach((_, c) => {
          const x = left + c * cellWidth;
          const y = top + r * cellHeight;
          const value = valueByCell.get(`${r}:${c}`);
          const fill = value === undefined ? colors.panel : sampleColorScale(stops, max === min ? 0.5 : (value - min) / (max - min));
          parts.push(`<rect x="${round2(x)}" y="${round2(y)}" width="${round2(Math.max(cellWidth - 1, 1))}" height="${round2(Math.max(cellHeight - 1, 1))}" fill="${fill}" stroke="${colors.background}" stroke-width="0.5"/>`);
          if (value !== undefined && showValues && cellWidth >= 34 && cellHeight >= 16) {
            const decimals = Number.isInteger(value) ? 0 : 1;
            parts.push(svgText(x + cellWidth / 2, y + cellHeight / 2 + 3.5, formatNumber(value, decimals), { anchor: "middle", fill: readableTextColor(fill), fontSize: 10 }));
          }
        });
        parts.push(svgText(left - 8, top + r * cellHeight + cellHeight / 2 + 4, truncateLabel(rowLabel, 12), { anchor: "end", fill: colors.subtle, fontSize: 11 }));
      });
      cols.forEach((colLabel, c) => {
        parts.push(svgText(left + c * cellWidth + cellWidth / 2, top - 9, truncateLabel(colLabel, 8), { anchor: "middle", fill: colors.subtle, fontSize: 10 }));
      });
      // 右下角色阶条（分段矩形近似渐变）+ min/max 标注
      const barWidth = 140;
      const barX = width - 14 - barWidth;
      const barY = height - 24;
      const segments = 14;
      for (let k = 0; k < segments; k++) {
        parts.push(`<rect x="${round2(barX + (k * barWidth) / segments)}" y="${barY}" width="${round2(barWidth / segments + 0.5)}" height="10" fill="${sampleColorScale(stops, k / (segments - 1))}"/>`);
      }
      const decimals = decimalsForStep(max - min || 1);
      parts.push(svgText(barX, barY - 5, formatNumber(min, Math.min(decimals, 2)), { anchor: "start", fill: colors.subtle, fontSize: 10 }));
      parts.push(svgText(barX + barWidth, barY - 5, formatNumber(max, Math.min(decimals, 2)), { anchor: "end", fill: colors.subtle, fontSize: 10 }));
      if (hasTitle) {
        parts.push(svgText(width / 2, 22, title, { anchor: "middle", fill: colors.text, fontSize: 15, weight: 600 }));
      }
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, title),
        width,
        height,
        rows: rows.length,
        cols: cols.length,
        cells: cells.length,
        colorScale,
        min,
        max,
      });
    },
  ),

  // ------------------------------------------------------------ chart.sparkline
  defineTool(
    "chart.sparkline",
    "Render a tiny sparkline trend as SVG (no axes; polyline + soft area fill + end dot), for inline metrics.",
    z.object({
      values: z.array(z.number().finite()).min(2).max(1000).describe("趋势数值（≥2 个）"),
      width: z.number().int().min(40).max(2000).describe("宽度 px").default(200),
      height: z.number().int().min(16).max(512).describe("高度 px").default(48),
      stroke: optionalHexSchema,
      fill: z.boolean().describe("是否绘制线下浅色填充").default(true),
      strokeWidth: z.number().min(1).max(6).describe("线宽 px").default(2),
    }),
    ({ values, width, height, stroke, fill, strokeWidth }) => {
      const colorCheck = checkHexColor(stroke, "stroke");
      if (!colorCheck.ok) return err(colorCheck.error);
      const color = stroke !== undefined ? stroke.toLowerCase() : PALETTE[0]!;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const padY = 4;
      const xAt = (i: number): number => (i / (values.length - 1)) * (width - 2) + 1;
      const yAt = (value: number): number => padY + (1 - (value - min) / span) * (height - padY * 2);
      const coords = values.map((value, i) => `${round2(xAt(i))},${round2(yAt(value))}`);
      const parts: string[] = [];
      if (fill) {
        parts.push(`<path d="M ${coords.join(" L ")} L ${round2(xAt(values.length - 1))},${round2(height - 0.5)} L ${round2(xAt(0))},${round2(height - 0.5)} Z" fill="${color}" fill-opacity="0.18" stroke="none"/>`);
      }
      parts.push(`<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<circle cx="${round2(xAt(values.length - 1))}" cy="${round2(yAt(values[values.length - 1]!))}" r="${round2(strokeWidth + 1.5)}" fill="${color}"/>`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>sparkline</title>${parts.join("")}</svg>`;
      return ok({ svg, width, height, count: values.length, min, max });
    },
  ),

  // ------------------------------------------------------------ chart.gauge
  defineTool(
    "chart.gauge",
    "Render a half-circle gauge as SVG (track arc + value arc + 25% ticks + min/max/value labels).",
    z.object({
      value: z.number().finite().describe("当前值（须在 [min, max] 内）"),
      min: z.number().finite().describe("量程下限").default(0),
      max: z.number().finite().describe("量程上限").default(100),
      label: z.string().max(48).describe("量程中下方的说明标签（可省略）").optional(),
      color: optionalHexSchema,
      width: z.number().int().min(160).max(1024).describe("画布宽度 px").default(280),
      height: z.number().int().min(120).max(1024).describe("画布高度 px").default(180),
      theme: themeSchema,
    }),
    ({ value, min, max, label, color, width, height, theme }) => {
      if (!(min < max)) return err(`E_DATA: min (${min}) must be < max (${max})`);
      if (value < min || value > max) return err(`E_DATA: value (${value}) out of range [${min}, ${max}]`);
      const colorCheck = checkHexColor(color, "color");
      if (!colorCheck.ok) return err(colorCheck.error);
      const colors = THEMES[theme];
      const accent = color !== undefined ? color.toLowerCase() : PALETTE[0]!;
      const cx = width / 2;
      const cy = height - 44;
      const radius = Math.max(40, Math.min(width / 2 - 30, height - 90));
      const fraction = (value - min) / (max - min);
      /** 数学角度（0=右，逆时针为正）→ 屏幕坐标（y 向下） */
      const point = (deg: number, r: number): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
      const [startX, startY] = point(180, radius);
      const [endX, endY] = point(0, radius);
      const parts: string[] = [];
      parts.push(`<path d="M ${round2(startX)} ${round2(startY)} A ${round2(radius)} ${round2(radius)} 0 0 1 ${round2(endX)} ${round2(endY)}" fill="none" stroke="${colors.grid}" stroke-width="14" stroke-linecap="round"/>`);
      if (fraction > 0) {
        const [valueX, valueY] = point(180 - fraction * 180, radius);
        parts.push(`<path d="M ${round2(startX)} ${round2(startY)} A ${round2(radius)} ${round2(radius)} 0 0 1 ${round2(valueX)} ${round2(valueY)}" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round"/>`);
      }
      for (const tickFraction of [0, 0.25, 0.5, 0.75, 1]) {
        const deg = 180 - tickFraction * 180;
        const [x1, y1] = point(deg, radius - 12);
        const [x2, y2] = point(deg, radius + 12);
        parts.push(`<line x1="${round2(x1)}" y1="${round2(y1)}" x2="${round2(x2)}" y2="${round2(y2)}" stroke="${colors.axis}" stroke-width="2"/>`);
      }
      parts.push(svgText(startX, cy + 24, formatNumber(min), { anchor: "middle", fill: colors.subtle, fontSize: 11 }));
      parts.push(svgText(endX, cy + 24, formatNumber(max), { anchor: "middle", fill: colors.subtle, fontSize: 11 }));
      parts.push(svgText(cx, cy - radius * 0.42, formatNumber(value, Number.isInteger(value) ? 0 : 1), { anchor: "middle", fill: colors.text, fontSize: Math.min(34, Math.round(radius * 0.4) + 10), weight: 700 }));
      if (label !== undefined) {
        parts.push(svgText(cx, cy - radius * 0.42 + 28, label, { anchor: "middle", fill: colors.subtle, fontSize: 12 }));
      }
      return ok({
        svg: svgDocument(parts.join("\n"), { width, height, theme }, label),
        width,
        height,
        value,
        min,
        max,
        fraction: round2(fraction),
      });
    },
  ),
];

// ---------------------------------------------------------------- 饼/环形共享渲染

/** 极坐标点（angleDeg 从正上方顺时针） */
function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

/** 扇区路径：起止角顺时针；donut 双弧回环；整圆拆两段 180° 弧避免 start===end 退化 */
function slicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  const fullCircle = sweep >= 360 - 1e-9;
  const large = sweep > 180 ? 1 : 0;
  const p = (angle: number, r: number): string => polarPoint(cx, cy, r, angle).map(round2).join(" ");
  if (fullCircle) {
    const mid = startAngle + 180;
    if (rInner <= 0) {
      return `M ${p(startAngle, rOuter)} A ${round2(rOuter)} ${round2(rOuter)} 0 0 1 ${p(mid, rOuter)} A ${round2(rOuter)} ${round2(rOuter)} 0 0 1 ${p(endAngle, rOuter)} Z`;
    }
    return [
      `M ${p(startAngle, rOuter)}`,
      `A ${round2(rOuter)} ${round2(rOuter)} 0 0 1 ${p(mid, rOuter)}`,
      `A ${round2(rOuter)} ${round2(rOuter)} 0 0 1 ${p(endAngle, rOuter)}`,
      `L ${p(endAngle, rInner)}`,
      `A ${round2(rInner)} ${round2(rInner)} 0 0 0 ${p(mid, rInner)}`,
      `A ${round2(rInner)} ${round2(rInner)} 0 0 0 ${p(startAngle, rInner)}`,
      "Z",
    ].join(" ");
  }
  if (rInner <= 0) {
    return `M ${round2(cx)} ${round2(cy)} L ${p(startAngle, rOuter)} A ${round2(rOuter)} ${round2(rOuter)} 0 ${large} 1 ${p(endAngle, rOuter)} Z`;
  }
  return [
    `M ${p(startAngle, rOuter)}`,
    `A ${round2(rOuter)} ${round2(rOuter)} 0 ${large} 1 ${p(endAngle, rOuter)}`,
    `L ${p(endAngle, rInner)}`,
    `A ${round2(rInner)} ${round2(rInner)} 0 ${large} 0 ${p(startAngle, rInner)}`,
    "Z",
  ].join(" ");
}

interface PieInput {
  readonly title?: string;
  readonly data: ReadonlyArray<{ label: string; value: number; color?: string }>;
  readonly size: number;
  readonly donut: boolean;
  readonly holeRatio: number;
  readonly theme: ChartTheme;
  readonly showLabels: boolean;
  readonly showLegend: boolean;
}

function renderPie(input: PieInput): LiteToolResult {
  for (let i = 0; i < input.data.length; i++) {
    const colorCheck = checkHexColor(input.data[i]!.color, `data[${i}].color`);
    if (!colorCheck.ok) return err(colorCheck.error);
    if (input.data[i]!.value < 0) {
      return err(`E_DATA: data[${i}].value must be >= 0 (got ${input.data[i]!.value})`);
    }
  }
  const total = input.data.reduce((sum, slice) => sum + slice.value, 0);
  if (!(total > 0)) return err("E_DATA: total value must be > 0 (all slices are zero or negative)");
  const colors = THEMES[input.theme];
  const size = input.size;
  const hasTitle = input.title !== undefined;
  const width = size + (input.showLegend ? 250 : 0);
  const height = size + (hasTitle && !input.donut ? 36 : 12);
  const cx = size / 2;
  const cy = size / 2 + (hasTitle && !input.donut ? 18 : 6);
  const rOuter = size * 0.4;
  const rInner = input.donut ? rOuter * input.holeRatio : 0;
  const parts: string[] = [];
  let cursor = 0;
  input.data.forEach((slice, i) => {
    if (slice.value <= 0) return; // 零值扇区不画弧（图例仍列出）
    const color = slice.color !== undefined ? slice.color.toLowerCase() : PALETTE[i % PALETTE.length]!;
    const sweep = (slice.value / total) * 360;
    const end = Math.min(360, cursor + sweep);
    parts.push(`<path d="${slicePath(cx, cy, rOuter, rInner, cursor, end)}" fill="${color}" stroke="${colors.background}" stroke-width="1"/>`);
    if (input.showLabels && slice.value / total >= 0.04) {
      const midAngle = (cursor + end) / 2;
      const labelRadius = input.donut ? (rOuter + rInner) / 2 : rOuter * 0.62;
      const [lx, ly] = polarPoint(cx, cy, labelRadius, midAngle);
      const share = (slice.value / total) * 100;
      parts.push(svgText(lx, ly + 4, `${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%`, { anchor: "middle", fill: readableTextColor(color), fontSize: 11, weight: 600 }));
    }
    cursor = end;
  });
  if (input.donut) {
    // 中心：标题（可选）+ 总量
    if (input.title !== undefined) {
      parts.push(svgText(cx, cy - 6, truncateLabel(input.title, 14), { anchor: "middle", fill: colors.text, fontSize: 14, weight: 600 }));
    }
    parts.push(svgText(cx, cy + 14, formatNumber(total), { anchor: "middle", fill: colors.subtle, fontSize: 11 }));
  } else if (hasTitle) {
    parts.push(svgText(cx, 22, input.title!, { anchor: "middle", fill: colors.text, fontSize: 15, weight: 600 }));
  }
  if (input.showLegend) {
    const legendX = size + 14;
    const rowHeight = 22;
    const maxItems = Math.max(1, Math.floor((height - 24) / rowHeight));
    const items = input.data.slice(0, maxItems);
    const startY = cy - (items.length * rowHeight) / 2 + 10;
    items.forEach((slice, i) => {
      const color = slice.color !== undefined ? slice.color.toLowerCase() : PALETTE[i % PALETTE.length]!;
      const y = startY + i * rowHeight;
      const share = (slice.value / total) * 100;
      parts.push(`<rect x="${legendX}" y="${round2(y - 9)}" width="12" height="12" rx="2" fill="${color}"/>`);
      parts.push(svgText(legendX + 18, y, `${truncateLabel(slice.label, 14)} · ${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%`, { fill: colors.text, fontSize: 11 }));
    });
    if (input.data.length > maxItems) {
      parts.push(svgText(legendX, startY + maxItems * rowHeight, `+${input.data.length - maxItems} more`, { fill: colors.subtle, fontSize: 11 }));
    }
  }
  return ok({
    svg: svgDocument(parts.join("\n"), { width, height, theme: input.theme }, input.title),
    width,
    height,
    total,
    sliceCount: input.data.length,
    donut: input.donut,
  });
}

// ---------------------------------------------------------------- stdio 入口（直调测试不触发）

if (import.meta.main) {
  await runStdioServer(tools, { serverName: "mcp-chart", serverVersion: "0.1.0" });
}
