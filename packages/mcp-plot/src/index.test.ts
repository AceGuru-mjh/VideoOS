// mcp-plot 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
// 落盘用例走 MCP_PLOT_ROOTS 监狱（临时目录）。
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-plot (E2E)", () => {
  it(
    "exposes 4 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["plot.bar", "plot.line", "plot.pie", "plot.preview"]);
        expect(server.serverInfo.name).toBe("mcp-plot");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.bar renders bars, axes, value labels and XML-escapes labels",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("plot.bar", {
          data: [
            { label: "Q1", value: 120 },
            { label: "Q2", value: 300 },
            { label: "A&B<C>", value: -50 },
          ],
          options: { title: "Revenue <2025>" },
        });
        expect(result.ok).toBe(true);
        const data = result.data as { svg: string; legend: string[] };
        expect(data.svg.startsWith("<svg")).toBe(true);
        expect(data.svg.endsWith("</svg>")).toBe(true);
        expect((data.svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(4); // 3 bars + background
        expect(data.svg).toContain("A&amp;B&lt;C&gt;"); // XML 转义
        expect(data.svg).toContain("Revenue &lt;2025&gt;");
        expect(data.svg).toContain("-50"); // 负值标签
        expect(data.svg).toContain("300");
        expect(data.legend).toEqual(["Q1: 120", "Q2: 300", "A&B<C>: -50"]);

        // labelEveryN：只渲染每 N 个 x 轴标签
        const sparse = await server.call("plot.bar", {
          data: Array.from({ length: 10 }, (_, i) => ({ label: `row-${i}`, value: i })),
          options: { labelEveryN: 2 },
        });
        const sparseSvg = (sparse.data as { svg: string }).svg;
        expect(sparseSvg).toContain("row-0");
        expect(sparseSvg).not.toContain("row-1");

        // 超上限 → zod -32602
        const tooMany = await server.call("plot.bar", {
          data: Array.from({ length: 21 }, (_, i) => ({ label: `x${i}`, value: i })),
        });
        expect(tooMany.ok).toBe(false);
        expect((tooMany.error ?? "").includes("-32602")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.bar writes the .svg inside MCP_PLOT_ROOTS and refuses jail escapes",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-plot-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_PLOT_ROOTS: root } });
      try {
        const result = await server.call("plot.bar", {
          data: [
            { label: "a", value: 1 },
            { label: "b", value: 2 },
          ],
          output: "charts/bar.svg",
        });
        expect(result.ok).toBe(true);
        const data = result.data as { path: string; bytes: number };
        expect(data.path).toContain(join(root, "charts/bar.svg"));
        expect(data.bytes).toBeGreaterThan(0);
        expect(existsSync(join(root, "charts/bar.svg"))).toBe(true);
        expect(readFileSync(join(root, "charts/bar.svg"), "utf8")).toContain("<svg");

        const escape = await server.call("plot.bar", {
          data: [{ label: "a", value: 1 }],
          output: "../escape.svg",
        });
        expect(escape.ok).toBe(false);
        expect(escape.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.line renders single and multi series with area fill",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const single = await server.call("plot.line", {
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 3 },
            { x: 2, y: 2 },
          ],
        });
        expect(single.ok).toBe(true);
        const singleData = single.data as { svg: string; legend: string[] };
        expect(singleData.svg).toContain("<polyline");
        expect(singleData.svg).toContain("#22d3ee");
        expect(singleData.svg).not.toContain("<polygon");
        expect(singleData.legend).toEqual([]);

        const area = await server.call("plot.line", {
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 3 },
          ],
          options: { area: true },
        });
        expect((area.data as { svg: string }).svg).toContain("fill-opacity=\"0.15\"");

        const multi = await server.call("plot.line", {
          series: [
            { label: "views", points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
            { label: "clicks", points: [{ x: 0, y: 2 }, { x: 1, y: 1 }] },
          ],
        });
        const multiData = multi.data as { svg: string; legend: string[] };
        expect((multiData.svg.match(/<polyline/g) ?? []).length).toBe(2);
        expect(multiData.svg).toContain("#f59e0b"); // 第二系列自动配色
        expect(multiData.svg).toContain(">views<"); // 图例文本用 <text>
        expect(multiData.legend).toEqual(["views", "clicks"]);

        // 语义冲突：points 与 series 二选一
        const both = await server.call("plot.line", {
          points: [{ x: 0, y: 1 }],
          series: [{ label: "s", points: [{ x: 0, y: 1 }] }],
        });
        expect(both.ok).toBe(false);
        expect(both.error).toContain("E_ARGS");

        const neither = await server.call("plot.line", {});
        expect(neither.ok).toBe(false);
        expect(neither.error).toContain("E_ARGS");

        // 超上限 → -32602（5 组 / 201 点）
        const fiveSeries = await server.call("plot.line", {
          series: Array.from({ length: 5 }, (_, i) => ({ label: `s${i}`, points: [{ x: 0, y: i }] })),
        });
        expect((fiveSeries.error ?? "").includes("-32602")).toBe(true);
        const tooManyPoints = await server.call("plot.line", {
          points: Array.from({ length: 201 }, (_, i) => ({ x: i, y: i })),
        });
        expect((tooManyPoints.error ?? "").includes("-32602")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.pie renders slices, donut hole, right-side legend and validates data",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const solid = await server.call("plot.pie", {
          data: [
            { label: "intro", value: 30 },
            { label: "demo", value: 50 },
            { label: "outro", value: 20 },
          ],
        });
        expect(solid.ok).toBe(true);
        const solidData = solid.data as { svg: string; legend: string[] };
        expect((solidData.svg.match(/<path /g) ?? []).length).toBe(3);
        expect(solidData.svg).toContain("50%"); // 50/100 的百分比标签
        expect(solidData.svg).toContain(">intro: 30 (30%)<");
        expect(solidData.legend).toHaveLength(3);

        const donut = await server.call("plot.pie", {
          data: [
            { label: "a", value: 1 },
            { label: "b", value: 3 },
          ],
          options: { hole: 0.6, size: 300 },
        });
        expect(donut.ok).toBe(true);
        const donutSvg = (donut.data as { svg: string }).svg;
        expect(donutSvg).toContain("A 138 138"); // 外弧半径 = 300/2 - 12
        expect(donutSvg).toContain("A 82.8 82.8"); // 内弧半径 = 138 * 0.6
        expect(donutSvg).toContain("75%"); // 3/4 扇形百分比标签
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.pie rejects negative/zero totals and too many slices",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const negative = await server.call("plot.pie", {
          data: [
            { label: "a", value: -5 },
            { label: "b", value: 10 },
          ],
        });
        expect(negative.ok).toBe(false);
        expect(negative.error).toContain("E_DATA");

        const zeros = await server.call("plot.pie", {
          data: [
            { label: "a", value: 0 },
            { label: "b", value: 0 },
          ],
        });
        expect(zeros.ok).toBe(false);
        expect(zeros.error).toContain("E_DATA");

        const tooMany = await server.call("plot.pie", {
          data: Array.from({ length: 9 }, (_, i) => ({ label: `s${i}`, value: i + 1 })),
        });
        expect((tooMany.error ?? "").includes("-32602")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "plot.preview dispatches to any chart generator and validates per type",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const bar = await server.call("plot.preview", {
          type: "bar",
          data: [
            { label: "x", value: 1 },
            { label: "y", value: 2 },
          ],
        });
        expect(bar.ok).toBe(true);
        expect((bar.data as { svg: string }).svg).toContain("<rect ");

        const line = await server.call("plot.preview", {
          type: "line",
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        });
        expect((line.data as { svg: string }).svg).toContain("<polyline");

        const pie = await server.call("plot.preview", {
          type: "pie",
          data: [
            { label: "a", value: 1 },
            { label: "b", value: 1 },
          ],
        });
        expect((pie.data as { svg: string }).svg).toContain("<path ");

        // 类型化校验：line 需要 points/series
        const missing = await server.call("plot.preview", { type: "line" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_ARGS");

        // 选项错误类型 → E_ARGS（如 width 传字符串）
        const badOption = await server.call("plot.preview", {
          type: "bar",
          data: [{ label: "x", value: 1 }],
          options: { width: "800" },
        });
        expect(badOption.ok).toBe(false);
        expect(badOption.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
