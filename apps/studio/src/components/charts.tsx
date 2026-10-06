// charts.tsx — Studio 可视化套件的 SVG 图表原语库（Task 2-d）。
// 设计约定：
//   - 零外部依赖：纯 React + SVG，viewBox 弹性缩放（width/height 仅为视口基准）；
//   - 主题感知：颜色一律走 CSS 变量（var(--accent) / var(--dim) / …），16 套主题自动适配，
//     数据系列色用 var(--accent) 与 --info/--ok/--warn/--err 五色轮换 + 透明度衍生；
//   - 可访问性：每个图表 role="img" + aria-label（数据摘要朗读），文本节点可缩放；
//   - 确定性：同数据同渲染（无 Math.random；色相轮换按索引）。
// 消费方：AnalyticsPanel / HealthPanel /（后续任意面板可复用）。
import { useMemo, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// 公共类型与工具
// ---------------------------------------------------------------------------

/** 单条数据点（label 支持任意字符串；value 非负有限） */
export interface ChartDatum {
  label: string;
  value: number;
  /** 可选覆盖色（CSS 颜色值；缺省走五色轮换） */
  color?: string;
}

/** 折线/面积序列 */
export interface ChartSeries {
  name: string;
  points: Array<{ x: number; y: number }>;
  color?: string;
}

/** 图表五色轮换（主题令牌；透明度在消费处用 color-mix 或独立 alpha 变体） */
const SERIES_COLORS = ["var(--accent)", "var(--info)", "var(--ok)", "var(--warn)", "var(--err)"];

/** 系列取色：索引取模五色轮换；显式 color 优先 */
export function seriesColor(index: number, override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  return SERIES_COLORS[index % SERIES_COLORS.length] as string;
}

/** 数值格式化：千分位 + 自适应小数（整数不带小数，<1 保留 2 位，其余 1 位） */
export function fmtChartNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  if (Math.abs(n) < 1) return n.toFixed(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** 秒时长 → 人话（"12.4s" / "1m03s"） */
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const rest = Math.round(sec - m * 60);
  return `${m}m${String(rest).padStart(2, "0")}s`;
}

/** nice-ticks：1-2-5 步长选取 4-6 根刻度（轴范围自适应） */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const base = Number.isFinite(min) ? min : 0;
    return [base, base + 1];
  }
  const span = max - min;
  const rawStep = span / Math.max(3, Math.min(8, targetCount));
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks.length > 0 ? ticks : [min, max];
}

/** 极坐标工具：角度（度）→ 单位圆坐标 */
function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** 环形弧 path（起止角为度，0 = 12 点方向顺时针） */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, startDeg);
  if (endDeg - startDeg >= 359.99) {
    // 整圆：拆两段半圆避免 large-arc flag 歧义
    const oMid = polar(cx, cy, rOuter, startDeg + 180);
    const iMid = polar(cx, cy, rInner, startDeg + 180);
    const oA = polar(cx, cy, rOuter, startDeg);
    return [
      `M ${oA.x} ${oA.y}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${oMid.x} ${oMid.y}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${oA.x} ${oA.y}`,
      `M ${i1.x} ${i1.y}`,
      `A ${rInner} ${rInner} 0 1 0 ${iMid.x} ${iMid.y}`,
      `A ${rInner} ${rInner} 0 1 0 ${i1.x} ${i1.y}`,
      "Z",
    ].join(" ");
  }
  const o0 = polar(cx, cy, rOuter, startDeg);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${polar(cx, cy, rInner, startDeg).x} ${polar(cx, cy, rInner, startDeg).y}`,
    "Z",
  ].join(" ");
}

/** 悬浮提示行内容（title 属性用，纯文本） */
function datumTitle(d: ChartDatum): string {
  return `${d.label}: ${fmtChartNumber(d.value)}`;
}

// ---------------------------------------------------------------------------
// BarChart — 纵向柱状图（网格 + 值标注 + aria 摘要）
// ---------------------------------------------------------------------------

export interface BarChartProps {
  data: ChartDatum[];
  /** 视口宽（viewBox 基准，实际宽度 100% 弹性） */
  width?: number;
  height?: number;
  showGrid?: boolean;
  showValues?: boolean;
  /** 图表朗读标签（缺省自动拼数据摘要） */
  ariaLabel?: string;
}

export function BarChart({
  data,
  width = 320,
  height = 200,
  showGrid = true,
  showValues = true,
  ariaLabel,
}: BarChartProps): JSX.Element {
  const pad = { top: 14, right: 8, bottom: 30, left: 38 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const max = data.length > 0 ? Math.max(...data.map((d) => d.value), 0) : 1;
  const ticks = useMemo(() => niceTicks(0, max || 1, 4), [max]);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const label = ariaLabel ?? (data.length > 0 ? data.map(datumTitle).join("，") : "empty bar chart");
  const barW = data.length > 0 ? innerW / data.length * 0.66 : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11 }}
    >
      {showGrid
        ? ticks.map((tick) => {
            const y = pad.top + innerH - (tick / top) * innerH;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} style={{ stroke: "var(--border)", strokeWidth: 1 }} />
                <text x={pad.left - 6} y={y + 3.5} textAnchor="end" style={{ fill: "var(--faint)" }}>
                  {fmtChartNumber(tick)}
                </text>
              </g>
            );
          })
        : null}
      {data.map((d, i) => {
        const h = (d.value / top) * innerH;
        const x = pad.left + (i + 0.5) * (innerW / data.length) - barW / 2;
        const y = pad.top + innerH - h;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={2} style={{ fill: d.color ?? seriesColor(i) }}>
              <title>{datumTitle(d)}</title>
            </rect>
            {showValues && d.value > 0 ? (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" style={{ fill: "var(--dim)", fontSize: 10 }}>
                {fmtChartNumber(d.value)}
              </text>
            ) : null}
            <text
              x={pad.left + (i + 0.5) * (innerW / data.length)}
              y={height - 10}
              textAnchor="middle"
              style={{ fill: "var(--dim)" }}
            >
              {d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label}
            </text>
          </g>
        );
      })}
      <line
        x1={pad.left}
        x2={width - pad.right}
        y1={pad.top + innerH}
        y2={pad.top + innerH}
        style={{ stroke: "var(--border2)", strokeWidth: 1 }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// HBarList — 横向条列表（label 左、条右、值尾注；适合「Top N」排名）
// ---------------------------------------------------------------------------

export interface HBarListProps {
  data: ChartDatum[];
  /** 行高（px，含间距） */
  rowHeight?: number;
  /** 值格式化（缺省 fmtChartNumber） */
  format?: (n: number) => string;
  ariaLabel?: string;
}

export function HBarList({ data, rowHeight = 26, format = fmtChartNumber, ariaLabel }: HBarListProps): JSX.Element {
  const max = data.length > 0 ? Math.max(...data.map((d) => d.value), 1) : 1;
  const label = ariaLabel ?? (data.length > 0 ? data.map(datumTitle).join("，") : "empty bar list");
  const width = 320;
  const height = data.length * rowHeight + 4;
  const labelW = 92;
  const valueW = 56;
  const barMaxW = width - labelW - valueW - 16;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11 }}
    >
      {data.map((d, i) => {
        const y = i * rowHeight + 6;
        const w = Math.max((d.value / max) * barMaxW, d.value > 0 ? 3 : 0);
        return (
          <g key={`${d.label}-${i}`}>
            <title>{datumTitle(d)}</title>
            <text x={0} y={y + rowHeight / 2} style={{ fill: "var(--dim)" }} dominantBaseline="middle">
              {d.label.length > 13 ? `${d.label.slice(0, 12)}…` : d.label}
            </text>
            <rect
              x={labelW}
              y={y + rowHeight / 2 - 6}
              width={barMaxW}
              height={12}
              rx={6}
              style={{ fill: "var(--panel2)" }}
            />
            <rect
              x={labelW}
              y={y + rowHeight / 2 - 6}
              width={w}
              height={12}
              rx={6}
              style={{ fill: d.color ?? seriesColor(i) }}
            />
            <text
              x={width - 2}
              y={y + rowHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              style={{ fill: "var(--text)", fontVariantNumeric: "tabular-nums" }}
            >
              {format(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DonutChart — 环形占比图（中心大数字 + 外圈图例由消费方排）
// ---------------------------------------------------------------------------

export interface DonutChartProps {
  data: ChartDatum[];
  size?: number;
  /** 环厚（px） */
  thickness?: number;
  /** 中心主标签（如 "128"） */
  centerValue?: string;
  /** 中心副标签（如 "layers"） */
  centerLabel?: string;
  ariaLabel?: string;
}

export function DonutChart({
  data,
  size = 150,
  thickness = 18,
  centerValue,
  centerLabel,
  ariaLabel,
}: DonutChartProps): JSX.Element {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = Math.max(6, rOuter - thickness);
  const label =
    ariaLabel ??
    (total > 0 ? `${centerValue ?? total}：${data.map((d) => `${d.label} ${fmtChartNumber(d.value)}(${Math.round((d.value / total) * 100)}%)`).join("，")}` : "empty donut");

  let acc = 0;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      style={{ display: "block" }}
    >
      {total <= 0 ? (
        <circle cx={cx} cy={cy} r={rOuter - thickness / 2} style={{ fill: "none", stroke: "var(--panel2)", strokeWidth: thickness }} />
      ) : (
        data.map((d, i) => {
          const frac = d.value / total;
          const start = acc * 360;
          acc += frac;
          const end = acc * 360 - 0.6; // 留 0.6° 视觉缝
          if (d.value <= 0) return null;
          return (
            <path key={`${d.label}-${i}`} d={arcPath(cx, cy, rOuter, rInner, start, Math.max(end, start + 0.4))} style={{ fill: d.color ?? seriesColor(i) }}>
              <title>{`${d.label}: ${fmtChartNumber(d.value)} (${Math.round(frac * 100)}%)`}</title>
            </path>
          );
        })
      )}
      {centerValue !== undefined ? (
        <text x={cx} y={cy - 2} textAnchor="middle" style={{ fill: "var(--text)", fontSize: size * 0.2, fontWeight: 700, fontFamily: "var(--sans)" }}>
          {centerValue}
        </text>
      ) : null}
      {centerLabel !== undefined ? (
        <text x={cx} y={cy + size * 0.14} textAnchor="middle" style={{ fill: "var(--faint)", fontSize: size * 0.085, fontFamily: "var(--sans)" }}>
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Gauge — 半圆仪表（0-100 分值；分段色带 + 指针 + 大数字）
// ---------------------------------------------------------------------------

export interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  /** 分段阈值色（默认 60 警戒 / 85 危险——用于「复杂度」这类越高越危险的指标） */
  warnAt?: number;
  dangerAt?: number;
  ariaLabel?: string;
}

export function Gauge({ value, min = 0, max = 100, label, warnAt = 60, dangerAt = 85, ariaLabel }: GaugeProps): JSX.Element {
  const clamped = Math.min(Math.max(value, min), max);
  const frac = max > min ? (clamped - min) / (max - min) : 0;
  const width = 190;
  const height = 108;
  const cx = width / 2;
  const cy = 92;
  const r = 74;
  const angle = frac * 180;
  const tone = clamped >= dangerAt ? "var(--err)" : clamped >= warnAt ? "var(--warn)" : "var(--ok)";
  const needle = polar(cx, cy, r - 10, angle);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel ?? `${label ?? "gauge"}: ${fmtChartNumber(clamped)} / ${fmtChartNumber(max)}`}
      style={{ display: "block", fontFamily: "var(--sans)" }}
    >
      {/* 背景弧 */}
      <path d={arcPath(cx, cy, r, r - 10, 0, 180)} style={{ fill: "var(--panel2)" }} />
      {/* 值弧 */}
      {angle > 0.5 ? <path d={arcPath(cx, cy, r, r - 10, 0, Math.max(angle, 1.2))} style={{ fill: tone }} /> : null}
      {/* 刻度点 */}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const a = polar(cx, cy, r + 4, p * 180);
        return <circle key={p} cx={a.x} cy={a.y} r={1.5} style={{ fill: "var(--faint)" }} />;
      })}
      {/* 指针 */}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} style={{ stroke: "var(--text)", strokeWidth: 2 }} />
      <circle cx={cx} cy={cy} r={4} style={{ fill: "var(--text)" }} />
      <text x={cx} y={cy - 18} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 26, fontWeight: 700 }}>
        {fmtChartNumber(clamped)}
      </text>
      {label !== undefined ? (
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: "var(--faint)", fontSize: 10 }}>
          {label}
        </text>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — 迷你趋势线（无轴；面积渐隐）
// ---------------------------------------------------------------------------

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  /** 空值（NaN/null 位置）断线处理：此处要求全是数字，缺省忽略 */
  ariaLabel?: string;
}

export function Sparkline({ values, width = 200, height = 48, stroke, ariaLabel }: SparklineProps): JSX.Element {
  const clean = values.filter((v) => Number.isFinite(v));
  const label =
    ariaLabel ??
    (clean.length > 0 ? `trend: ${clean.length} points, last ${fmtChartNumber(clean[clean.length - 1] ?? 0)}` : "empty sparkline");
  if (clean.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} style={{ stroke: "var(--border2)", strokeDasharray: "3 3" }} />
      </svg>
    );
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max > min ? max - min : 1;
  const stepX = width / (clean.length - 1);
  const pts = clean.map((v, i) => [i * stepX, height - 4 - ((v - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const gradId = `spark-grad-${clean.length}-${Math.round(min)}-${Math.round(max)}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke ?? "var(--accent)"} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke ?? "var(--accent)"} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} style={{ fill: `url(#${gradId})` }} />
      <path d={line} style={{ fill: "none", stroke: stroke ?? "var(--accent)", strokeWidth: 1.6, strokeLinecap: "round" }} />
      <circle cx={pts[pts.length - 1]?.[0]} cy={pts[pts.length - 1]?.[1]} r={2.4} style={{ fill: stroke ?? "var(--accent)" }} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LineChart — 多序列折线（网格 + 图例 + nice-ticks 双轴范围）
// ---------------------------------------------------------------------------

export interface LineChartProps {
  series: ChartSeries[];
  width?: number;
  height?: number;
  showGrid?: boolean;
  ariaLabel?: string;
}

export function LineChart({ series, width = 340, height = 190, showGrid = true, ariaLabel }: LineChartProps): JSX.Element {
  const pad = { top: 12, right: 10, bottom: 26, left: 40 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const all = series.flatMap((s) => s.points);
  const label =
    ariaLabel ??
    (series.length > 0
      ? series.map((s) => `${s.name}: ${s.points.length} pts, last ${fmtChartNumber(s.points[s.points.length - 1]?.y ?? 0)}`).join("；")
      : "empty line chart");

  if (all.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label}>
        <text x={width / 2} y={height / 2} textAnchor="middle" style={{ fill: "var(--faint)", fontSize: 11 }}>
          —
        </text>
      </svg>
    );
  }
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMin = Math.min(...all.map((p) => p.y));
  const yMax = Math.max(...all.map((p) => p.y));
  const xSpan = xMax > xMin ? xMax - xMin : 1;
  const ticks = niceTicks(yMin, yMax, 4);
  const yTop = Math.max(yMax, ticks[ticks.length - 1] ?? yMax);
  const yLo = Math.min(yMin, ticks[0] ?? yMin);
  const ySpan = yTop > yLo ? yTop - yLo : 1;
  const toXY = (p: { x: number; y: number }): [number, number] => [
    pad.left + ((p.x - xMin) / xSpan) * innerW,
    pad.top + innerH - ((p.y - yLo) / ySpan) * innerH,
  ];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11 }}
    >
      {showGrid
        ? ticks.map((tick) => {
            const y = pad.top + innerH - ((tick - yLo) / ySpan) * innerH;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} style={{ stroke: "var(--border)", strokeWidth: 1 }} />
                <text x={pad.left - 6} y={y + 3.5} textAnchor="end" style={{ fill: "var(--faint)" }}>
                  {fmtChartNumber(tick)}
                </text>
              </g>
            );
          })
        : null}
      {series.map((s, i) => {
        const color = seriesColor(i, s.color);
        const d = s.points.map((p, j) => `${j === 0 ? "M" : "L"} ${toXY(p)[0].toFixed(1)} ${toXY(p)[1].toFixed(1)}`).join(" ");
        return (
          <g key={s.name}>
            <path d={d} style={{ fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <title>{`${s.name} — ${s.points.length} 点`}</title>
            </path>
            {s.points.length <= 24
              ? s.points.map((p, j) => {
                  const [x, y] = toXY(p);
                  return <circle key={j} cx={x} cy={y} r={2.2} style={{ fill: color }} />;
                })
              : null}
          </g>
        );
      })}
      <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} style={{ stroke: "var(--border2)" }} />
      <text x={pad.left} y={height - 8} style={{ fill: "var(--faint)" }}>
        {fmtChartNumber(xMin)}
      </text>
      <text x={width - pad.right} y={height - 8} textAnchor="end" style={{ fill: "var(--faint)" }}>
        {fmtChartNumber(xMax)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ProgressRing — 单值进度环（百分比动画由 CSS transition 承担）
// ---------------------------------------------------------------------------

export function ProgressRing({
  value,
  max,
  size = 64,
  thickness = 6,
  tone,
  ariaLabel,
}: {
  value: number;
  max: number;
  size?: number;
  thickness?: number;
  tone?: string;
  ariaLabel?: string;
}): JSX.Element {
  const frac = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const r = size / 2 - thickness / 2 - 1;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={ariaLabel ?? `${fmtChartNumber(value)} / ${fmtChartNumber(max)}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        style={{ fill: "none", stroke: "var(--panel2)", strokeWidth: thickness }}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        style={{
          fill: "none",
          stroke: tone ?? "var(--accent)",
          strokeWidth: thickness,
          strokeLinecap: "round",
          strokeDasharray: `${(frac * c).toFixed(1)} ${c.toFixed(1)}`,
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
          transition: "stroke-dasharray 240ms ease",
        }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StatCard — 数字卡片（label + 大数字 + 可选副行 + 可选右侧插槽）
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  sub,
  tone,
  right,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "err" | "accent";
  right?: ReactNode;
  title?: string;
}): JSX.Element {
  const toneClass = tone !== undefined && tone !== "default" ? ` stat-${tone}` : "";
  return (
    <div className={`viz-stat-card${toneClass}`} title={title}>
      <div className="viz-stat-label">{label}</div>
      <div className="viz-stat-value">
        <span className="viz-stat-num">{value}</span>
        {right !== undefined ? <span className="viz-stat-right">{right}</span> : null}
      </div>
      {sub !== undefined && sub.length > 0 ? <div className="viz-stat-sub">{sub}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorSwatchList — 调色板分布（色块 + hex + 计数；点击复制由消费方接）
// ---------------------------------------------------------------------------

export function ColorSwatchList({
  colors,
  onCopy,
}: {
  colors: Array<{ hex: string; count: number }>;
  onCopy?: (hex: string) => void;
}): JSX.Element {
  if (colors.length === 0) {
    return <div className="viz-empty">—</div>;
  }
  const max = Math.max(...colors.map((c) => c.count), 1);
  return (
    <ul className="viz-swatch-list" role="list">
      {colors.map((c) => (
        <li key={c.hex} className="viz-swatch-row">
          <button
            type="button"
            className="viz-swatch-chip"
            title={c.hex}
            aria-label={`${c.hex}, used ${c.count} times`}
            style={{ background: c.hex }}
            onClick={() => onCopy?.(c.hex)}
          />
          <span className="viz-swatch-hex">{c.hex}</span>
          <span className="viz-swatch-bar" aria-hidden="true">
            <span className="viz-swatch-bar-fill" style={{ width: `${Math.max((c.count / max) * 100, 4)}%` }} />
          </span>
          <span className="viz-swatch-count">{c.count}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Legend — 图例（圆点 + 名称；与五色轮换一致）
// ---------------------------------------------------------------------------

export function Legend({ items }: { items: Array<{ label: string; color?: string }> }): JSX.Element {
  if (items.length === 0) return <span />;
  return (
    <ul className="viz-legend" role="list">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="viz-legend-item">
          <span className="viz-legend-dot" aria-hidden="true" style={{ background: it.color ?? seriesColor(i) }} />
          <span className="viz-legend-label">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// KVGrid — 键值小网格（健康面板的密集指标）
// ---------------------------------------------------------------------------

export function KVGrid({ items }: { items: Array<{ k: string; v: string; tone?: "ok" | "warn" | "err" }> }): JSX.Element {
  return (
    <dl className="viz-kv-grid">
      {items.map((it) => (
        <div key={it.k} className={`viz-kv-cell${it.tone !== undefined ? ` viz-kv-${it.tone}` : ""}`}>
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// fmtBytes 已有 ui.tsx 版本；此处给 analytics 用的大数值版本（GB 级）
// ---------------------------------------------------------------------------

export function fmtMB(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return "—";
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 运行时长 → "3d 04:12:05" */
export function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
