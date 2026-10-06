// charts.tsx（可视化套件图表原语库）单元测试。
// 两类契约：
//  1. 纯函数契约 — niceTicks 的 1-2-5 步长 / fmtChartNumber / fmtDuration /
//     fmtMB / fmtUptime / seriesColor 五色轮换；
//  2. SSR 静态渲染契约 — 纯 prop 驱动组件（无 store、无 api、无副作用）经
//     react-dom/server renderToStaticMarkup 输出的 SVG 结构关键断言
//     （元素计数 / aria-label 摘要 / 主题令牌引用），与 render.test.tsx 同款方法。
//  不做全量快照——组件演进（加字符串/重排标记）不应破坏本套件。
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart,
  ColorSwatchList,
  DonutChart,
  Gauge,
  HBarList,
  KVGrid,
  Legend,
  LineChart,
  ProgressRing,
  Sparkline,
  StatCard,
  fmtChartNumber,
  fmtDuration,
  fmtMB,
  fmtUptime,
  niceTicks,
  seriesColor,
} from "./charts";

function markup(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

// ---------------------------------------------------------------- 纯函数

describe("niceTicks — 1-2-5 步长轴刻度", () => {
  test("0-100 目标 5 档 → 0/20/40/60/80/100（步长 20）", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  test("0-10 → 0/2/4/6/8/10（步长 2）", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  test("0-1 → 0/0.2/…/1（小数步长）", () => {
    const ticks = niceTicks(0, 1, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
  });

  test("零跨度（min === max）→ 退化两刻度不抛错", () => {
    const ticks = niceTicks(7, 7, 5);
    expect(Array.isArray(ticks)).toBe(true);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  test("非有限输入 → 退化两刻度不抛错", () => {
    expect(Array.isArray(niceTicks(Number.NaN, 5, 5))).toBe(true);
    expect(Array.isArray(niceTicks(Number.POSITIVE_INFINITY, 5, 5))).toBe(true);
  });

  test("刻度全部落在 [min, max] 内且单调不减", () => {
    for (const [lo, hi] of [[3, 97], [0.05, 0.95], [-40, 15]] as const) {
      const ticks = niceTicks(lo, hi, 5);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(t).toBeLessThanOrEqual(hi + 1e-9);
      }
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] as number).toBeGreaterThan(ticks[i - 1] as number);
      }
    }
  });
});

describe("fmtChartNumber — 千分位与自适应小数", () => {
  test("整数加千分位", () => {
    expect(fmtChartNumber(1234567)).toBe("1,234,567");
    expect(fmtChartNumber(42)).toBe("42");
  });
  test("小数保留 1 位（>=1）", () => {
    expect(fmtChartNumber(12.34)).toBe("12.3");
  });
  test("小于 1 保留 2 位", () => {
    expect(fmtChartNumber(0.5)).toBe("0.50");
  });
  test("非有限 → em dash", () => {
    expect(fmtChartNumber(Number.NaN)).toBe("—");
    expect(fmtChartNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("fmtDuration — 人话时长", () => {
  test("秒级（<10s 一位小数）", () => {
    expect(fmtDuration(4.25)).toBe("4.3s");
  });
  test("秒级（>=10s 取整）", () => {
    expect(fmtDuration(12.6)).toBe("13s");
  });
  test("分级 m+ss 补零", () => {
    expect(fmtDuration(63)).toBe("1m03s");
  });
  test("负数 / 非有限 → em dash", () => {
    expect(fmtDuration(-1)).toBe("—");
    expect(fmtDuration(Number.NaN)).toBe("—");
  });
});

describe("fmtMB / fmtUptime", () => {
  test("MB 级原样（0 位小数）", () => {
    expect(fmtMB(512)).toBe("512 MB");
  });
  test("GB 级换算 2 位小数", () => {
    expect(fmtMB(2048)).toBe("2.00 GB");
  });
  test("非有限 → em dash", () => {
    expect(fmtMB(Number.NaN)).toBe("—");
  });
  test("不足 1 小时 → hh:mm:ss", () => {
    expect(fmtUptime(3725)).toBe("01:02:05");
  });
  test("跨天 → 1d hh:mm:ss", () => {
    expect(fmtUptime(90061)).toBe("1d 01:01:01");
  });
});

describe("seriesColor — 五色轮换", () => {
  test("显式覆盖优先", () => {
    expect(seriesColor(0, "#ff0000")).toBe("#ff0000");
  });
  test("索引取模轮换（0 与 5 同色，1 与 6 同色）", () => {
    expect(seriesColor(5)).toBe(seriesColor(0));
    expect(seriesColor(6)).toBe(seriesColor(1));
  });
  test("全部落在主题令牌五色集合内", () => {
    const tokens = new Set(["var(--accent)", "var(--info)", "var(--ok)", "var(--warn)", "var(--err)"]);
    for (let i = 0; i < 12; i++) expect(tokens.has(seriesColor(i))).toBe(true);
  });
});

// ---------------------------------------------------------------- SSR 渲染

describe("BarChart — SSR 结构契约", () => {
  const data = [
    { label: "text", value: 12 },
    { label: "rect", value: 8 },
    { label: "ellipse", value: 4 },
  ];

  test("role=img + aria-label 含全部数据摘要（无障碍）", () => {
    const html = markup(<BarChart data={data} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("text: 12");
    expect(html).toContain("rect: 8");
    expect(html).toContain("ellipse: 4");
  });

  test("数据条数 = rect 元素数（含值标注开关）", () => {
    const withValues = markup(<BarChart data={data} showValues />);
    const rects = (withValues.match(/<rect/g) ?? []).length;
    expect(rects).toBe(data.length);
  });

  test("网格关闭时无网格刻度文本", () => {
    const noGrid = markup(<BarChart data={data} showGrid={false} />);
    expect(noGrid).not.toContain('text-anchor="end"');
  });

  test("空数据不渲染任何柱体", () => {
    const empty = markup(<BarChart data={[]} />);
    expect((empty.match(/<rect/g) ?? []).length).toBe(0);
  });

  test("主题令牌引用（var(--accent) 系列）而非硬编码色", () => {
    const html = markup(<BarChart data={data} />);
    expect(html).toContain("var(--accent)");
  });
});

describe("DonutChart — SSR 结构契约", () => {
  test("中心大数字与副标签渲染", () => {
    const html = markup(
      <DonutChart data={[{ label: "a", value: 3 }, { label: "b", value: 1 }]} centerValue="128" centerLabel="layers" />,
    );
    expect(html).toContain("128");
    expect(html).toContain("layers");
  });

  test("占比进入 aria-label（无障碍）", () => {
    const html = markup(<DonutChart data={[{ label: "a", value: 3 }, { label: "b", value: 1 }]} />);
    expect(html).toContain("75%");
    expect(html).toContain("25%");
  });

  test("全零数据退化为占位环不炸", () => {
    const html = markup(<DonutChart data={[{ label: "a", value: 0 }]} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
  });

  test("整圆（单条 100%）拆双弧路径不产生 NaN", () => {
    const html = markup(<DonutChart data={[{ label: "only", value: 10 }]} />);
    expect(html).not.toContain("NaN");
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("Gauge — SSR 结构契约", () => {
  test("0-100 数值与 label 渲染", () => {
    const html = markup(<Gauge value={73} label="complexity" />);
    expect(html).toContain("73");
    expect(html).toContain("complexity");
  });

  test("阈值换色：>=85 err / >=60 warn / 其余 ok（按 tone token 断言）", () => {
    expect(markup(<Gauge value={90} />)).toContain("var(--err)");
    expect(markup(<Gauge value={70} />)).toContain("var(--warn)");
    expect(markup(<Gauge value={30} />)).toContain("var(--ok)");
  });

  test("越界值被钳制（-5 与 200 都渲染合法数值）", () => {
    expect(markup(<Gauge value={-5} />)).not.toContain("NaN");
    expect(markup(<Gauge value={200} />)).not.toContain("NaN");
  });
});

describe("Sparkline / LineChart — SSR 结构契约", () => {
  test("少于 2 点退化为虚线占位（不炸）", () => {
    const html = markup(<Sparkline values={[1]} />);
    expect(html).toContain("stroke-dasharray");
  });

  test("正常序列输出折线 path + 末点圆点 + 面积渐变", () => {
    const html = markup(<Sparkline values={[1, 2, 3, 2, 5]} />);
    expect(html).toContain("<path");
    expect(html).toContain("linearGradient");
    expect(html).toContain("<circle");
  });

  test("非有限点被过滤（含 NaN 的序列不产生 NaN 坐标）", () => {
    const html = markup(<Sparkline values={[1, Number.NaN, 3, 4]} />);
    expect(html).not.toContain("NaN");
  });

  test("多序列折线各得一条 path", () => {
    const html = markup(
      <LineChart
        series={[
          { name: "a", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { name: "b", points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
        ]}
      />,
    );
    expect((html.match(/<path/g) ?? []).length).toBe(2);
  });
});

describe("HBarList / Legend / StatCard / KVGrid / ProgressRing — SSR 契约", () => {
  test("HBarList 值经自定义 format 输出", () => {
    const html = markup(<HBarList data={[{ label: "mono", value: 12 }]} format={(n) => `#${n}`} />);
    expect(html).toContain("#12");
  });

  test("Legend 渲染圆点 + 文本", () => {
    const html = markup(<Legend items={[{ label: "text" }, { label: "rect", color: "#abc" }]} />);
    expect(html).toContain("text");
    expect(html).toContain("rect");
    expect(html).toContain("#abc");
  });

  test("StatCard tone 类名与副行", () => {
    const html = markup(<StatCard label="scenes" value="8" sub="project demo" tone="ok" />);
    expect(html).toContain("stat-ok");
    expect(html).toContain("scenes");
    expect(html).toContain("project demo");
  });

  test("KVGrid 键值与色调类", () => {
    const html = markup(<KVGrid items={[{ k: "heap", v: "128 MB", tone: "warn" }]} />);
    expect(html).toContain("heap");
    expect(html).toContain("128 MB");
    expect(html).toContain("viz-kv-warn");
  });

  test("ProgressRing dasharray 与值成正比", () => {
    const half = markup(<ProgressRing value={5} max={10} />);
    const full = markup(<ProgressRing value={10} max={10} />);
    const dashOf = (html: string): number => {
      const m = /stroke-dasharray:\s*([\d.]+)/i.exec(html);
      return m !== null ? Number.parseFloat(m[1] ?? "0") : -1;
    };
    expect(dashOf(half)).toBeGreaterThan(0);
    expect(dashOf(full)).toBeGreaterThan(dashOf(half));
  });
});

describe("ColorSwatchList — SSR 契约", () => {
  test("色块携带原始 hex 作为背景色与 title", () => {
    const html = markup(<ColorSwatchList colors={[{ hex: "#ff2d55", count: 3 }]} />);
    expect(html).toContain("#ff2d55");
    expect(html).toContain("background:#ff2d55");
  });

  test("空列表渲染占位", () => {
    expect(markup(<ColorSwatchList colors={[]} />)).toContain("—");
  });
});
