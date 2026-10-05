// mcp-color 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-color (E2E)", () => {
  it(
    "exposes 7 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "color.contrast",
          "color.convert",
          "color.harmonize",
          "color.luminance",
          "color.mix",
          "color.palette",
          "color.parse",
        ]);
        expect(server.serverInfo.name).toBe("mcp-color");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.parse recognizes hex/rgb/hsl forms and reports invalid input",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const orange = await server.call("color.parse", { value: "#ff8000" });
        expect(orange.data).toMatchObject({
          valid: true,
          hex: "#ff8000",
          rgb: [255, 128, 0],
          hsl: [30, 100, 50],
        });

        const short = await server.call("color.parse", { value: "#abc" });
        expect(short.data).toMatchObject({ valid: true, hex: "#aabbcc" });

        const alpha = await server.call("color.parse", { value: "#aabbccdd" });
        expect(alpha.data).toMatchObject({ valid: true, hex: "#aabbcc" }); // alpha 丢弃

        const fn = await server.call("color.parse", { value: "rgb(12, 34, 56)" });
        expect(fn.data).toMatchObject({ valid: true, hex: "#0c2238", rgb: [12, 34, 56], hsl: [210, 65, 13] });

        const fromHsl = await server.call("color.parse", { value: "hsl(210, 65%, 13%)" });
        expect(fromHsl.data).toMatchObject({ valid: true, hex: "#0c2137", rgb: [12, 33, 55] });

        const bad = await server.call("color.parse", { value: "not-a-color" });
        expect(bad.ok).toBe(true); // 解析结果：无效（而非错误）
        expect(bad.data).toMatchObject({ valid: false });
        expect((bad.data as { reason: string }).reason).toContain("unrecognized");

        const outOfRange = await server.call("color.parse", { value: "rgb(300, 0, 0)" });
        expect(outOfRange.data).toMatchObject({ valid: false });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.convert targets hex/rgb/hsl/css and rejects unparseable values",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const css = await server.call("color.convert", { value: "#0c2238", to: "css" });
        expect(css.data).toMatchObject({ output: "rgb(12, 34, 56)", format: "css" });

        const rgb = await server.call("color.convert", { value: "hsl(210, 65%, 13%)", to: "rgb" });
        expect(rgb.data).toMatchObject({ output: "rgb(12, 33, 55)" });

        const hsl = await server.call("color.convert", { value: "#0c2238", to: "hsl" });
        expect(hsl.data).toMatchObject({ output: "hsl(210, 65%, 13%)" });

        const hex = await server.call("color.convert", { value: "rgb(255, 128, 0)", to: "hex" });
        expect(hex.data).toMatchObject({ output: "#ff8000" });

        const bad = await server.call("color.convert", { value: "oops", to: "hex" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_COLOR");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.contrast computes WCAG ratio with AA/AAA/aaLarge verdicts",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const black = await server.call("color.contrast", { foreground: "#000000", background: "#ffffff" });
        expect(black.data).toMatchObject({ ratio: 21, aa: true, aaa: true, aaLarge: true });

        const white = await server.call("color.contrast", { foreground: "#ffffff", background: "#ffffff" });
        expect(white.data).toMatchObject({ ratio: 1, aa: false, aaa: false, aaLarge: false });

        // #767676 是白底 AA 阈值灰
        const gray = await server.call("color.contrast", { foreground: "#767676", background: "#ffffff" });
        expect(gray.data).toMatchObject({ ratio: 4.54, aa: true, aaa: false, aaLarge: true });

        // 大字号阈值 3:1（#949494 ≈ 3.03:1）
        const large = await server.call("color.contrast", { foreground: "#949494", background: "#ffffff" });
        const largeData = large.data as { ratio: number; aa: boolean; aaLarge: boolean };
        expect(largeData.ratio).toBeCloseTo(3.03, 2);
        expect(largeData.aa).toBe(false);
        expect(largeData.aaLarge).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.luminance returns relative and perceived brightness",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect((await server.call("color.luminance", { value: "#000000" })).data).toMatchObject({
          relative: 0,
          perceived: 0,
        });
        expect((await server.call("color.luminance", { value: "#ffffff" })).data).toMatchObject({
          relative: 1,
          perceived: 100,
        });
        const gray = await server.call("color.luminance", { value: "#808080" });
        const data = gray.data as { relative: number; perceived: number };
        expect(data.relative).toBeCloseTo(0.2159, 3);
        expect(data.perceived).toBeCloseTo(50.2, 2);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.palette derives schemes with roles and enforces count bounds",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const comp = await server.call("color.palette", { base: "#22d3ee", scheme: "complementary", count: 5 });
        expect(comp.ok).toBe(true);
        const compData = comp.data as { colors: Array<{ hex: string; role: string }>; count: number };
        expect(compData.count).toBe(5);
        expect(compData.colors).toHaveLength(5);
        expect(compData.colors[0]).toMatchObject({ hex: "#22d3ee", role: "base" });
        expect(compData.colors[1]).toMatchObject({ hex: "#ee3d22", role: "complement" });
        expect(compData.colors[2]).toMatchObject({ role: "base-light-1" });
        expect(compData.colors[3]).toMatchObject({ role: "complement-light-1" });
        expect(compData.colors[4]).toMatchObject({ role: "base-dark-1" });

        const mono = await server.call("color.palette", { base: "#22d3ee", scheme: "monochrome", count: 5 });
        const monoData = (mono.data as { colors: Array<{ hex: string; role: string }> }).colors;
        expect(monoData.map((c) => c.role)).toEqual(["base", "light-1", "dark-1", "light-2", "dark-2"]);

        const analog = await server.call("color.palette", { base: "#ff8000", scheme: "analogous", count: 5 });
        const analogData = (analog.data as { colors: Array<{ hex: string; role: string }> }).colors;
        expect(analogData.map((c) => c.role)).toEqual([
          "analog-left-30",
          "analog-left-15",
          "base",
          "analog-right-15",
          "analog-right-30",
        ]);

        const triad = await server.call("color.palette", { base: "#ff8000", scheme: "triadic" }); // 默认 count=5
        expect(((triad.data as { colors: unknown[] }).colors)).toHaveLength(5);

        const tooMany = await server.call("color.palette", { base: "#fff", count: 11 });
        expect(tooMany.ok).toBe(false);
        expect((tooMany.error ?? "").includes("-32602")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.mix blends in linear RGB space",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const mid = await server.call("color.mix", { a: "#000000", b: "#ffffff", ratio: 0.5 });
        expect(mid.data).toMatchObject({ hex: "#bcbcbc", ratio: 0.5 });

        const atA = await server.call("color.mix", { a: "#000000", b: "#ffffff", ratio: 0 });
        expect(atA.data).toMatchObject({ hex: "#000000" });

        const atB = await server.call("color.mix", { a: "#000000", b: "#ffffff", ratio: 1 });
        expect(atB.data).toMatchObject({ hex: "#ffffff" });

        const brand = await server.call("color.mix", { a: "#22d3ee", b: "#f59e0b" }); // 默认 ratio 0.5
        expect(brand.data).toMatchObject({ hex: "#b5bbaf" });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "color.harmonize lints low contrast and flat saturation, and rejects bad colors",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const flat = await server.call("color.harmonize", {
          colors: ["#111111", "#333333", "#555555"],
        });
        expect(flat.ok).toBe(true);
        const flatData = flat.data as { minContrast: number; avgSaturation: number; advice: string[] };
        expect(flatData.minContrast).toBeLessThan(3);
        expect(flatData.avgSaturation).toBe(0);
        expect(flatData.advice.some((a) => a.includes("<3:1"))).toBe(true);
        expect(flatData.advice.some((a) => a.includes("similar saturation"))).toBe(true);

        const balanced = await server.call("color.harmonize", { colors: ["#000000", "#ffffff"] });
        const balancedData = balanced.data as { minContrast: number; advice: string[] };
        expect(balancedData.minContrast).toBe(21);
        expect(balancedData.advice.some((a) => a.includes("similar saturation"))).toBe(true);

        const bad = await server.call("color.harmonize", { colors: ["#000000", "wat"] });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_COLOR");

        const single = await server.call("color.harmonize", { colors: ["#000000"] });
        expect(single.ok).toBe(false);
        expect(single.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
