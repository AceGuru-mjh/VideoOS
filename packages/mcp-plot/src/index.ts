// @videoos/mcp-plot —— 手写 SVG 图表生成服务器（bar/line/pie/preview，stdio MCP），零绘图依赖。
// 设计要点：纯字符串拼接（注意 XML 转义）；文本一律用 <text>（render-svg 可消费）；
// 可选 output 参数把 .svg 落盘到 MCP_PLOT_ROOTS 监狱内。
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { byteLength, defineTool, err, jailFromEnv, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import type { LiteToolResult } from "@videoos/mcp-lite";
import { z } from "zod";

const jail = await jailFromEnv("MCP_PLOT_ROOTS");

const SERIES_COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399"] as const;
const PIE_COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#fb7185"] as const;
const MAX_SVG_BYTES = 65_536;

/** XML 转义（文本与属性通用） */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 数值格式化：最多 2 位小数，去掉尾零 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1000 || Number.isInteger(n)) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

/** 坐标格式化：最多 2 位小数 */
function coord(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new ToolError("E_DATA", `${what} must be a finite number (got ${value})`);
}

/** 优雅刻度：1/2/5 步长，落在 [min,max] 区间内 */
function niceTicks(min: number, max: number, count = 5): number[] {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.abs(lo) > 1 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const rawStep = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let t = first; t <= hi + step * 1e-9; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
    if (ticks.length > 50) break;
  }
  return ticks.length > 0 ? ticks : [lo, hi];
}

function svgOpen(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`;
}

function titleElement(title: string | undefined, width: number, top: number): string {
  if (title === undefined || title === "") return "";
  return `<text x="${coord(width / 2)}" y="${coord(top - 18)}" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">${esc(title)}</text>`;
}

// ---------- bar ----------

interface BarDatum {
  label: string;
  value: number;
}
interface BarOptions {
  width?: number;
  height?: number;
  title?: string;
  color?: string;
  labelEveryN?: number;
}

function renderBar(data: BarDatum[], options: BarOptions): { svg: string; legend: string[] } {
  for (const d of data) assertFinite(d.value, `value of "${d.label}"`);
  const width = options.width ?? 800;
  const height = options.height ?? 450;
  const color = options.color ?? "#22d3ee";
  const labelEveryN = Math.max(1, options.labelEveryN ?? 1);
  const hasTitle = options.title !== undefined && options.title !== "";
  const left = 64;
  const right = 24;
  const top = hasTitle ? 56 : 28;
  const bottom = 56;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const values = data.map((d) => d.value);
  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) yMax = yMin + 1;
  const y = (v: number): number => top + plotH * (1 - (v - yMin) / (yMax - yMin));

  const parts: string[] = [svgOpen(width, height), `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`, titleElement(options.title, width, top)];

  const ticks = niceTicks(yMin, yMax, 5);
  for (const t of ticks) {
    const ty = y(t);
    parts.push(`<line x1="${left}" y1="${coord(ty)}" x2="${left + plotW}" y2="${coord(ty)}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${coord(ty + 4)}" text-anchor="end" font-size="11" fill="#6b7280">${fmt(t)}</text>`);
  }

  const n = data.length;
  const bandW = plotW / n;
  const barW = Math.min(bandW * 0.72, 90);
  const zeroY = y(0);
  for (let i = 0; i < n; i++) {
    const d = data[i]!;
    const x = left + bandW * i + (bandW - barW) / 2;
    const vy = y(d.value);
    const rectY = Math.min(vy, zeroY);
    const rectH = Math.max(Math.abs(vy - zeroY), 1);
    parts.push(`<rect x="${coord(x)}" y="${coord(rectY)}" width="${coord(barW)}" height="${coord(rectH)}" rx="3" fill="${esc(color)}"/>`);
    const labelY = d.value >= 0 ? vy - 6 : vy + 14;
    parts.push(`<text x="${coord(x + barW / 2)}" y="${coord(labelY)}" text-anchor="middle" font-size="11" fill="#374151">${fmt(d.value)}</text>`);
    if (i % labelEveryN === 0) {
      parts.push(
        `<text x="${coord(left + bandW * i + bandW / 2)}" y="${coord(zeroY + 18)}" text-anchor="middle" font-size="12" fill="#6b7280">${esc(d.label)}</text>`,
      );
    }
  }

  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push(`<line x1="${left}" y1="${coord(zeroY)}" x2="${left + plotW}" y2="${coord(zeroY)}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push("</svg>");
  return { svg: parts.join(""), legend: data.map((d) => `${d.label}: ${fmt(d.value)}`) };
}

// ---------- line ----------

interface LinePoint {
  x: number;
  y: number;
}
interface LineSeries {
  label: string;
  points: LinePoint[];
}
interface LineOptions {
  width?: number;
  height?: number;
  title?: string;
  color?: string;
  area?: boolean;
}

function renderLine(
  single: LinePoint[] | undefined,
  series: LineSeries[] | undefined,
  options: LineOptions,
): { svg: string; legend: string[] } {
  const multi = series !== undefined;
  const groups: Array<{ label: string; color: string; points: LinePoint[] }> = multi
    ? series!.map((s, i) => ({ label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length]!, points: s.points }))
    : [{ label: "", color: options.color ?? "#22d3ee", points: single ?? [] }];
  for (const g of groups) {
    if (g.points.length === 0) throw new ToolError("E_DATA", "each series needs at least 1 point");
    for (const p of g.points) {
      assertFinite(p.x, `x of series "${g.label}"`);
      assertFinite(p.y, `y of series "${g.label}"`);
    }
  }

  const width = options.width ?? 800;
  const height = options.height ?? 450;
  const hasTitle = options.title !== undefined && options.title !== "";
  const left = 64;
  const right = 24;
  const bottom = 44;
  const top = hasTitle ? 56 : multi ? 44 : 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const all = groups.flatMap((g) => g.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 1;
  const xMin = Math.min(...xs) - xPad;
  const xMax = Math.max(...xs) + xPad;
  const yMin = Math.min(...ys) - yPad;
  const yMax = Math.max(...ys) + yPad;
  const sx = (v: number): number => left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number): number => top + plotH * (1 - (v - yMin) / (yMax - yMin));

  const parts: string[] = [svgOpen(width, height), `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`, titleElement(options.title, width, top)];

  for (const t of niceTicks(yMin, yMax, 5)) {
    parts.push(`<line x1="${left}" y1="${coord(sy(t))}" x2="${left + plotW}" y2="${coord(sy(t))}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${coord(sy(t) + 4)}" text-anchor="end" font-size="11" fill="#6b7280">${fmt(t)}</text>`);
  }
  for (const t of niceTicks(xMin, xMax, 6)) {
    parts.push(`<line x1="${coord(sx(t))}" y1="${top}" x2="${coord(sx(t))}" y2="${top + plotH}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${coord(sx(t))}" y="${top + plotH + 16}" text-anchor="middle" font-size="11" fill="#6b7280">${fmt(t)}</text>`);
  }

  const drawMarkers = all.length <= 40;
  for (const g of groups) {
    const pts = g.points.map((p) => `${coord(sx(p.x))},${coord(sy(p.y))}`).join(" ");
    if (options.area === true) {
      const base = top + plotH;
      const area = `${coord(sx(g.points[0]!.x))},${coord(base)} ${pts} ${coord(sx(g.points[g.points.length - 1]!.x))},${coord(base)}`;
      parts.push(`<polygon points="${area}" fill="${g.color}" fill-opacity="0.15"/>`);
    }
    parts.push(`<polyline points="${pts}" fill="none" stroke="${g.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (drawMarkers) {
      for (const p of g.points) {
        parts.push(`<circle cx="${coord(sx(p.x))}" cy="${coord(sy(p.y))}" r="3" fill="${g.color}"/>`);
      }
    }
  }

  if (multi) {
    let legendW = 0;
    for (const g of groups) legendW = Math.max(legendW, g.label.length * 7 + 28);
    const x0 = left + plotW - Math.min(legendW, plotW * 0.6);
    groups.forEach((g, i) => {
      const ly = top - 12 + i * 18;
      parts.push(`<rect x="${coord(x0)}" y="${coord(ly - 9)}" width="12" height="12" rx="2" fill="${g.color}"/>`);
      parts.push(`<text x="${coord(x0 + 17)}" y="${coord(ly + 1)}" font-size="12" fill="#374151">${esc(g.label)}</text>`);
    });
  }

  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push("</svg>");
  return { svg: parts.join(""), legend: multi ? groups.map((g) => g.label) : [] };
}

// ---------- pie ----------

interface PieDatum {
  label: string;
  value: number;
}
interface PieOptions {
  size?: number;
  hole?: number;
  title?: string;
}

function renderPie(data: PieDatum[], options: PieOptions): { svg: string; legend: string[] } {
  for (const d of data) {
    assertFinite(d.value, `value of "${d.label}"`);
    if (d.value < 0) throw new ToolError("E_DATA", `pie values must be >= 0 (got ${d.value} for "${d.label}")`);
  }
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) throw new ToolError("E_DATA", "pie needs at least one value > 0");

  const size = options.size ?? 450;
  const hole = Math.min(Math.max(options.hole ?? 0, 0), 0.95);
  const hasTitle = options.title !== undefined && options.title !== "";
  const legendW = 230;
  const width = size + legendW;
  const legendRows = data.length * 26 + (hasTitle ? 40 : 24);
  const height = Math.max(size, legendRows);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;
  const ri = r * hole;

  const parts: string[] = [svgOpen(width, height), `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`, titleElement(options.title, size, hasTitle ? 30 : 12)];

  let angle = -Math.PI / 2; // 从 12 点方向开始
  const legend: string[] = [];
  data.forEach((d, i) => {
    const color = PIE_COLORS[i % PIE_COLORS.length]!;
    const frac = d.value / total;
    const sweep = frac * Math.PI * 2;
    const pct = frac * 100;
    if (sweep >= Math.PI * 2 - 1e-9) {
      // 单一扇形占满整圆：arc path 会退化，用 circle 表达
      parts.push(`<circle cx="${coord(cx)}" cy="${coord(cy)}" r="${coord(r)}" fill="${color}"/>`);
      if (ri > 0) parts.push(`<circle cx="${coord(cx)}" cy="${coord(cy)}" r="${coord(ri)}" fill="#ffffff"/>`);
    } else {
      const a0 = angle;
      const a1 = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const x0o = cx + r * Math.cos(a0);
      const y0o = cy + r * Math.sin(a0);
      const x1o = cx + r * Math.cos(a1);
      const y1o = cy + r * Math.sin(a1);
      if (ri <= 0) {
        parts.push(
          `<path d="M ${coord(cx)} ${coord(cy)} L ${coord(x0o)} ${coord(y0o)} A ${coord(r)} ${coord(r)} 0 ${large} 1 ${coord(x1o)} ${coord(y1o)} Z" fill="${color}" stroke="#ffffff" stroke-width="1"/>`,
        );
      } else {
        const x0i = cx + ri * Math.cos(a0);
        const y0i = cy + ri * Math.sin(a0);
        const x1i = cx + ri * Math.cos(a1);
        const y1i = cy + ri * Math.sin(a1);
        parts.push(
          `<path d="M ${coord(x0o)} ${coord(y0o)} A ${coord(r)} ${coord(r)} 0 ${large} 1 ${coord(x1o)} ${coord(y1o)} L ${coord(x1i)} ${coord(y1i)} A ${coord(ri)} ${coord(ri)} 0 ${large} 0 ${coord(x0i)} ${coord(y0i)} Z" fill="${color}" stroke="#ffffff" stroke-width="1"/>`,
        );
      }
    }
    if (pct >= 5) {
      const mid = angle + sweep / 2;
      const rl = ri <= 0 ? r * 0.62 : (r + ri) / 2;
      parts.push(
        `<text x="${coord(cx + rl * Math.cos(mid))}" y="${coord(cy + rl * Math.sin(mid))}" text-anchor="middle" dy="0.35em" font-size="12" fill="#111827">${pct.toFixed(0)}%</text>`,
      );
    }
    legend.push(`${d.label}: ${fmt(d.value)} (${round1(pct)}%)`);
    angle += sweep;
  });

  const legendTop = hasTitle ? 48 : 24;
  data.forEach((d, i) => {
    const color = PIE_COLORS[i % PIE_COLORS.length]!;
    const ly = legendTop + i * 26;
    parts.push(`<rect x="${size + 16}" y="${coord(ly)}" width="14" height="14" rx="3" fill="${color}"/>`);
    parts.push(
      `<text x="${size + 38}" y="${coord(ly + 12)}" font-size="13" fill="#374151">${esc(`${d.label}: ${fmt(d.value)} (${round1((d.value / total) * 100)}%)`)}</text>`,
    );
  });

  parts.push("</svg>");
  return { svg: parts.join(""), legend };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------- 共享：svg 输出（含可选落盘） ----------

async function emitChart(
  chart: { svg: string; legend: string[] },
  output: string | undefined,
): Promise<LiteToolResult> {
  if (byteLength(chart.svg) > MAX_SVG_BYTES) {
    return err(`E_SIZE: generated svg exceeds 64KB (reduce data size) — ${byteLength(chart.svg)} bytes`);
  }
  if (output === undefined) return ok({ svg: chart.svg, legend: chart.legend });
  const abs = await jail.resolve(output);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, chart.svg, "utf8");
  return ok({ svg: chart.svg, legend: chart.legend, path: abs, bytes: byteLength(chart.svg) });
}

// ---------- schemas ----------

const barDatum = z.object({
  label: z.string().describe("bar label (rendered below the axis)"),
  value: z.number().describe("bar value (negative values draw below the zero line)"),
});
const linePoint = z.object({ x: z.number().describe("x value"), y: z.number().describe("y value") });
const lineSeries = z.object({
  label: z.string().describe("series name for the legend"),
  points: z.array(linePoint).min(1).max(200).describe("up to 200 points"),
});

const barOptions = z.object({
  width: z.number().int().min(200).max(2000).describe("canvas width (default 800)").optional(),
  height: z.number().int().min(160).max(2000).describe("canvas height (default 450)").optional(),
  title: z.string().max(200).describe("chart title").optional(),
  color: z.string().describe("bar fill color, hex like #22d3ee (default #22d3ee)").optional(),
  labelEveryN: z.number().int().min(1).max(20).describe("show every Nth x label (default 1)").optional(),
});
const lineOptions = z.object({
  width: z.number().int().min(200).max(2000).describe("canvas width (default 800)").optional(),
  height: z.number().int().min(160).max(2000).describe("canvas height (default 450)").optional(),
  title: z.string().max(200).describe("chart title").optional(),
  color: z.string().describe("single-series stroke color (default #22d3ee; multi-series auto-assigns)").optional(),
  area: z.boolean().describe("fill under the line with 15% opacity").optional(),
});
const pieOptions = z.object({
  size: z.number().int().min(200).max(1200).describe("pie canvas size in px (default 450)").optional(),
  hole: z.number().min(0).max(0.95).describe("donut hole fraction 0-0.95 (0 = solid pie, 0.6 = donut)").optional(),
  title: z.string().max(200).describe("chart title").optional(),
});

const barInput = z.object({ data: z.array(barDatum).min(1).max(20).describe("1-20 bars"), options: barOptions.optional() });
const lineInput = z.object({
  points: z.array(linePoint).min(1).max(200).describe("single series, up to 200 points").optional(),
  series: z.array(lineSeries).min(1).max(4).describe("up to 4 series (auto-colored)").optional(),
  options: lineOptions.optional(),
});
const pieInput = z.object({ data: z.array(barDatum).min(1).max(8).describe("1-8 slices"), options: pieOptions.optional() });
const outputParam = z
  .string()
  .describe("optional .svg path inside MCP_PLOT_ROOTS to also write the chart to")
  .optional();

function requireExactlyOneLineSource(points: unknown, series: unknown): void {
  if (points !== undefined && series !== undefined) {
    throw new ToolError("E_ARGS", "pass either points (single series) or series (multi), not both");
  }
  if (points === undefined && series === undefined) {
    throw new ToolError("E_ARGS", "line chart needs points or series");
  }
}

const tools = [
  defineTool(
    "plot.bar",
    "Render a bar chart as SVG (axes, gridlines, value labels, optional title); returns {svg, legend}.",
    barInput.extend({ output: outputParam }),
    async ({ data, options, output }) => {
      const chart = renderBar(data, options ?? {});
      return emitChart(chart, output);
    },
  ),
  defineTool(
    "plot.line",
    "Render a line chart as SVG from points (single series) or series (up to 4, auto-colored); optional translucent area fill.",
    lineInput.extend({ output: outputParam }),
    async ({ points, series, options, output }) => {
      requireExactlyOneLineSource(points, series);
      const chart = renderLine(points, series, options ?? {});
      return emitChart(chart, output);
    },
  ),
  defineTool(
    "plot.pie",
    "Render a pie or donut chart as SVG (arc paths, percent labels, legend on the right).",
    pieInput.extend({ output: outputParam }),
    async ({ data, options, output }) => {
      const chart = renderPie(data, options ?? {});
      return emitChart(chart, output);
    },
  ),
  defineTool(
    "plot.preview",
    "Preview any chart type in one tool: dispatches to the bar/line/pie generators (all text uses <text>, render-svg consumable).",
    z.object({
      type: z.enum(["bar", "line", "pie"]).describe("which chart generator to use"),
      data: z.array(barDatum).max(20).describe("bar/pie data (for type=bar|pie)").optional(),
      points: z.array(linePoint).max(200).describe("single-series points (for type=line)").optional(),
      series: z.array(lineSeries).max(4).describe("multi-series (for type=line)").optional(),
      options: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .describe("chart options passed through to the selected type (width/height/title/color/...)")
        .optional(),
      output: outputParam,
    }),
    async ({ type, data, points, series, options, output }) => {
      const base = {
        ...(data !== undefined ? { data } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(series !== undefined ? { series } : {}),
        ...(options !== undefined ? { options } : {}),
      };
      const schema = type === "bar" ? barInput : type === "line" ? lineInput : pieInput;
      const parsed = schema.safeParse(base);
      if (!parsed.success) {
        return err(
          `E_ARGS: invalid ${type} input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
      }
      const args = parsed.data as { data?: BarDatum[]; points?: LinePoint[]; series?: LineSeries[]; options?: Record<string, string | number | boolean> };
      if (type === "bar") return emitChart(renderBar(args.data ?? [], (args.options ?? {}) as BarOptions), output);
      if (type === "line") {
        requireExactlyOneLineSource(args.points, args.series);
        return emitChart(renderLine(args.points, args.series, (args.options ?? {}) as LineOptions), output);
      }
      return emitChart(renderPie(args.data ?? [], (args.options ?? {}) as PieOptions), output);
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-plot", serverVersion: "0.1.0" });
