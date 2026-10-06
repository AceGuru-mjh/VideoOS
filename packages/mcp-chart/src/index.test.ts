// mcp-chart 直调 handler 测试（不 spawn 子进程）：10 个工具逐一验证输出 SVG 结构、
// 主题/调色板/转义/千分位/nice-ticks 行为，以及非法输入的 err(...) 语义错误路径。
// 协议级 E2E（initialize → tools/call 全链路）已由 smoke 验证；此处聚焦渲染正确性。
import { describe, expect, it } from "bun:test";
import type { LiteTool, LiteToolResult } from "@videoos/mcp-lite";
import { tools } from "./index";

const byName = (name: string): LiteTool => {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool;
};

const call = (name: string, args: Record<string, unknown>): Promise<LiteToolResult> => byName(name).call(args);

const dataOf = (result: LiteToolResult): Record<string, unknown> => {
  expect(result.ok).toBe(true);
  return result.data as Record<string, unknown>;
};

/** 单引号包裹的 SVG 属性值出现次数（粗粒度结构断言用） */
const countOf = (svg: string, needle: string): number => svg.split(needle).length - 1;

describe("mcp-chart（直调 handler）", () => {
  it("暴露 10 个 chart.* 工具", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "chart.area", "chart.bar", "chart.donut", "chart.gauge", "chart.heatmap",
      "chart.line", "chart.pie", "chart.radar", "chart.scatter", "chart.sparkline",
    ]);
    expect(tools.every((t) => t.description.length > 0)).toBe(true);
    expect(tools.every((t) => (t.parameters as { type?: string }).type === "object")).toBe(true);
  });

  it("chart.bar 渲染柱状图：viewBox/背景/柱/轴标签/千分位", async () => {
    const data = dataOf(await call("chart.bar", {
      title: "播放量",
      data: [
        { label: "一月", value: 1234 },
        { label: "二月", value: 2500 },
        { label: "三月", value: 800 },
      ],
    }));
    const svg = data.svg as string;
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 800 450"');
    expect(svg).toContain('fill="#0b1220"'); // dark 主题背景
    expect(svg).toContain("<title>播放量</title>");
    expect(countOf(svg, "<rect")).toBeGreaterThanOrEqual(4); // 背景 + 面板 + 3 柱
    expect(svg).toContain("1,234"); // 千分位（柱顶标注 + 可能的轴刻度）
    expect(svg).toContain("二月");
    expect(data.width).toBe(800);
    expect(data.height).toBe(450);
    expect(data.count).toBe(3);
    expect(data.yMax).toBeGreaterThanOrEqual(2500);
    expect(data.yMin).toBe(0); // 正值域下探 0
  });

  it("chart.bar 负值与 light 主题、XML 转义", async () => {
    const data = dataOf(await call("chart.bar", {
      data: [
        { label: '<script>&"x"', value: -5 },
        { label: "B", value: 3 },
      ],
      theme: "light",
      width: 320,
      height: 240,
    }));
    const svg = data.svg as string;
    expect(svg).toContain('fill="#ffffff"'); // light 背景
    expect(svg).toContain("&lt;script&gt;&amp;&quot;x&quot;"); // & < > " 全转义
    expect(svg).not.toContain("<script>");
    expect(data.yMin).toBeLessThanOrEqual(-5); // 负值域包含 0 基线
    expect(data.yMax).toBeGreaterThanOrEqual(3);
  });

  it("chart.bar 非法颜色/空数据返回 err 或 zod 拒绝", async () => {
    const badColor = await call("chart.bar", { data: [{ label: "A", value: 1, color: "javascript:alert(1)" }] });
    expect(badColor.ok).toBe(false);
    expect(badColor.error).toContain("E_COLOR");

    // zod 层入参校验失败 → LiteValidationError（协议层映射 -32602），直调时表现为 rejects
    await expect(call("chart.bar", { data: [{ label: "A", value: Number.NaN }] })).rejects.toThrow();
    await expect(call("chart.bar", { data: [] })).rejects.toThrow(); // .min(1)
    await expect(call("chart.bar", {})).rejects.toThrow(); // data 缺失
  });

  it("chart.line 多序列：图例、双轴刻度、每序列一条折线", async () => {
    const data = dataOf(await call("chart.line", {
      series: [
        { name: "渲染耗时", points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 3 }] },
        { name: "编码耗时", points: [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 5 }], color: "#facc15" },
      ],
    }));
    const svg = data.svg as string;
    expect(countOf(svg, "<polyline")).toBe(2);
    expect(svg).toContain("渲染耗时");
    expect(svg).toContain("编码耗时");
    expect(svg).toContain('stroke="#facc15"');
    expect(svg).toContain("text-anchor="); // 刻度标签
    expect(data.seriesCount).toBe(2);
    expect(data.pointCount).toBe(6);
    expect(data.xDomain).toEqual([1, 3]);
    expect(data.yDomain).toEqual([1, 5]); // nice-ticks 1-2-5：步长 1 → [1,2,3,4,5]
  });

  it("chart.line 单点序列不炸（只画圆标）；非法序列颜色 err", async () => {
    const single = dataOf(await call("chart.line", {
      series: [{ name: "solo", points: [{ x: 5, y: 5 }] }],
    }));
    const svg = single.svg as string;
    expect(countOf(svg, "<polyline")).toBe(0); // 单点无线
    expect(countOf(svg, "<circle")).toBeGreaterThanOrEqual(1);

    const bad = await call("chart.line", {
      series: [{ name: "x", points: [{ x: 1, y: 1 }], color: "#12345" }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
  });

  it("chart.area 单序列渐变填充 + 面积路径", async () => {
    const data = dataOf(await call("chart.area", {
      points: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 5 }],
    }));
    const svg = data.svg as string;
    expect(svg).toContain('id="areaGradient"');
    expect(svg).toContain('stop-opacity="0.42"');
    expect(svg).toContain('fill="url(#areaGradient)"');
    expect(countOf(svg, "<polyline")).toBe(1);
    expect(data.pointCount).toBe(4);
    await expect(call("chart.area", { points: [{ x: 1, y: 1 }] })).rejects.toThrow(); // zod .min(2)
  });

  it("chart.pie 百分比/图例/总量；负值与全零 err", async () => {
    const data = dataOf(await call("chart.pie", {
      data: [
        { label: "手机", value: 60 },
        { label: "平板", value: 30 },
        { label: "桌面", value: 10 },
      ],
    }));
    const svg = data.svg as string;
    expect(countOf(svg, "<path")).toBe(3);
    expect(svg).toContain("60%");
    expect(svg).toContain("30%");
    expect(svg).toContain("手机");
    expect(data.total).toBe(100);
    expect(data.sliceCount).toBe(3);
    expect(data.width).toBe(320 + 250); // size + 图例列

    const negative = await call("chart.pie", { data: [{ label: "A", value: -1 }] });
    expect(negative.ok).toBe(false);
    expect(negative.error).toContain("E_DATA");
    const allZero = await call("chart.pie", { data: [{ label: "A", value: 0 }] });
    expect(allZero.ok).toBe(false);
    expect(allZero.error).toContain("E_DATA");
  });

  it("chart.pie 单扇区整圆走 circle 降级路径；chart.donut 环形 + 中心标题", async () => {
    const full = dataOf(await call("chart.pie", { data: [{ label: "唯一", value: 100 }], showLegend: false }));
    const fullSvg = full.svg as string;
    expect(fullSvg).toContain("100%");
    expect(countOf(fullSvg, "A ")).toBe(2); // 整圆拆两段 180° 弧

    const donut = dataOf(await call("chart.donut", {
      title: "完成度",
      data: [{ label: "A", value: 3 }, { label: "B", value: 1 }],
      holeRatio: 0.75,
    }));
    const donutSvg = donut.svg as string;
    expect(donutSvg).toContain("完成度"); // 中心标题
    expect(donutSvg).toContain("4"); // 中心总量
    expect(donut.donut).toBe(true);
    // 环形：外弧（顺时针）与内弧（逆时针）各一条
    expect(donutSvg).toContain(" 0 1 ");
    expect(donutSvg).toContain(" 0 0 ");
  });

  it("chart.scatter 散点 + 点旁标签；chart.radar 雷达 + 校验", async () => {
    const scatter = dataOf(await call("chart.scatter", {
      points: [
        { x: 1, y: 2, label: "p1" },
        { x: 3, y: 4 },
        { x: 5, y: 0.5 },
      ],
      radius: 5,
    }));
    const scatterSvg = scatter.svg as string;
    expect(countOf(scatterSvg, "<circle")).toBeGreaterThanOrEqual(3);
    expect(scatterSvg).toContain(">p1<");
    expect(scatter.pointCount).toBe(3);

    const radar = dataOf(await call("chart.radar", {
      axes: [
        { label: "清晰度", max: 10 },
        { label: "流畅度", max: 10 },
        { label: "稳定", max: 5 },
      ],
      series: [{ name: "本片", values: [8, 9, 4] }],
    }));
    const radarSvg = radar.svg as string;
    expect(countOf(radarSvg, "<polygon")).toBeGreaterThanOrEqual(4 + 1); // 4 网格环 + 1 序列
    expect(radarSvg).toContain("本片");
    expect(radar.axesCount).toBe(3);

    const mismatch = await call("chart.radar", {
      axes: [
        { label: "A", max: 10 },
        { label: "B", max: 10 },
        { label: "C", max: 10 },
      ],
      series: [{ name: "x", values: [1, 2] }],
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toContain("E_DATA");
    const badMax = await call("chart.radar", {
      axes: [
        { label: "A", max: 0 },
        { label: "B", max: 10 },
        { label: "C", max: 10 },
      ],
      series: [{ name: "x", values: [1, 2, 3] }],
    });
    expect(badMax.ok).toBe(false);
    expect(badMax.error).toContain("E_DATA");
  });

  it("chart.heatmap 网格/色阶/越界与重复单元格 err", async () => {
    const data = dataOf(await call("chart.heatmap", {
      rows: ["周一", "周二"],
      cols: ["早", "午", "晚"],
      cells: [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 1, value: 2 },
        { row: 1, col: 2, value: 9 },
      ],
    }));
    const svg = data.svg as string;
    // 2×3 = 6 格（未覆盖格用面板色）
    expect(countOf(svg, "<rect")).toBeGreaterThanOrEqual(6 + 14); // 单元格 + 色阶条分段 + 背景
    expect(data.rows).toBe(2);
    expect(data.cols).toBe(3);
    expect(data.min).toBe(1);
    expect(data.max).toBe(9);
    expect(data.colorScale).toBe("viridis"); // 输出回显色阶名
    expect(svg).toContain("#440154"); // viridis 首色（低值端）

    const ember = dataOf(await call("chart.heatmap", {
      rows: ["R"],
      cols: ["C"],
      cells: [{ row: 0, col: 0, value: 5 }],
      colorScale: "ember",
    }));
    expect(ember.colorScale).toBe("ember");

    const outOfRange = await call("chart.heatmap", {
      rows: ["R"],
      cols: ["C"],
      cells: [{ row: 1, col: 0, value: 1 }],
    });
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.error).toContain("E_DATA");
    const duplicate = await call("chart.heatmap", {
      rows: ["R"],
      cols: ["C"],
      cells: [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 0, value: 2 },
      ],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toContain("duplicate");
  });

  it("chart.sparkline 迷你趋势线：折线 + 末点圆标 + 线下填充", async () => {
    const data = dataOf(await call("chart.sparkline", { values: [3, 5, 4, 8, 6, 9] }));
    const svg = data.svg as string;
    expect(svg).toContain('viewBox="0 0 200 48"');
    expect(countOf(svg, "<polyline")).toBe(1);
    expect(countOf(svg, "<circle")).toBe(1);
    expect(svg).toContain('fill-opacity="0.18"');
    expect(data.min).toBe(3);
    expect(data.max).toBe(9);
    expect(data.count).toBe(6);

    const noFill = dataOf(await call("chart.sparkline", { values: [1, 2, 3], fill: false, stroke: "#ff0000" }));
    expect((noFill.svg as string)).not.toContain('fill-opacity="0.18"');
    await expect(call("chart.sparkline", { values: [1] })).rejects.toThrow(); // zod .min(2)
  });

  it("chart.gauge 半圆仪表盘：量程/弧/刻度；越界与退化量程 err", async () => {
    const data = dataOf(await call("chart.gauge", { value: 50, min: 0, max: 100, label: "CPU" }));
    const svg = data.svg as string;
    expect(svg).toContain(" 0 1 "); // 弧路径（顺时针）
    expect(countOf(svg, "<path")).toBe(2); // 轨道 + 数值弧
    expect(svg).toContain(">50<");
    expect(svg).toContain(">CPU<");
    expect(data.fraction).toBe(0.5);

    const zero = dataOf(await call("chart.gauge", { value: 0, min: 0, max: 10 }));
    expect(countOf(zero.svg as string, "<path")).toBe(1); // 只有轨道

    const outOfRange = await call("chart.gauge", { value: 120, min: 0, max: 100 });
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.error).toContain("E_DATA");
    const inverted = await call("chart.gauge", { value: 5, min: 10, max: 10 });
    expect(inverted.ok).toBe(false);
    expect(inverted.error).toContain("E_DATA");
  });

  it("全部工具产物 text 元素恒带 font-family/font-size/fill（渲染契约）", async () => {
    const samples: Array<[string, Record<string, unknown>]> = [
      ["chart.bar", { data: [{ label: "A", value: 1 }] }],
      ["chart.line", { series: [{ name: "s", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }],
      ["chart.pie", { data: [{ label: "A", value: 1 }] }],
      ["chart.gauge", { value: 1 }],
    ];
    for (const [name, args] of samples) {
      const svg = dataOf(await call(name, args)).svg as string;
      expect(svg).toContain('font-family="');
      expect(svg).toContain('font-size="');
      expect(svg).toContain('fill="');
      expect(svg).not.toMatch(/fill="[^"]*undefined/);
    }
  });
});
