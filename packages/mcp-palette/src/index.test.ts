// mcp-palette 直调 handler 测试（不 spawn 子进程）：色彩换算纯函数（parseHexColor/hslToRgb/rgbToHsl）
// 直证 + 7 个工具的输出正确性、边界与非法输入 err(...) 语义错误路径。
import { describe, expect, it } from "bun:test";
import type { LiteTool, LiteToolResult } from "@videoos/mcp-lite";
import { hslToRgb, parseHexColor, rgbToHsl, tools } from "./index";

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

describe("mcp-palette（直调 handler）", () => {
  it("暴露 7 个 palette.* 工具", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "palette.bestText", "palette.colorblind", "palette.contrast", "palette.gradients",
      "palette.harmony", "palette.ramp", "palette.rotate",
    ]);
    expect(tools.every((t) => t.description.length > 0)).toBe(true);
    expect(tools.every((t) => (t.parameters as { type?: string }).type === "object")).toBe(true);
  });

  it("parseHexColor 支持 #rgb/#rrggbb/#rrggbbaa 并拒绝非法输入", () => {
    const short = parseHexColor("#abc");
    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.rgb).toEqual({ r: 170, g: 187, b: 204 });
      expect(short.alpha).toBe(1);
    }
    const long = parseHexColor("#aabbcc");
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.rgb).toEqual({ r: 170, g: 187, b: 204 });

    const alpha = parseHexColor("#ff8000dd");
    expect(alpha.ok).toBe(true);
    if (alpha.ok) {
      expect(alpha.rgb).toEqual({ r: 255, g: 128, b: 0 });
      expect(alpha.alpha).toBeCloseTo(221 / 255, 5); // dd = 221
    }

    expect(parseHexColor("red").ok).toBe(false);
    expect(parseHexColor("#12345").ok).toBe(false);
    expect(parseHexColor("").ok).toBe(false);
    expect(parseHexColor("rgb(1,2,3)").ok).toBe(false); // 本服务器只收 hex 形态
  });

  it("HSL↔RGB 换算：已知值对照 + 往返一致性", () => {
    expect(hslToRgb({ h: 30, s: 100, l: 50 })).toEqual({ r: 255, g: 128, b: 0 }); // #ff8000
    expect(hslToRgb({ h: 210, s: 100, l: 50 })).toEqual({ r: 0, g: 128, b: 255 }); // #0080ff
    expect(hslToRgb({ h: 0, s: 0, l: 50 })).toEqual({ r: 128, g: 128, b: 128 }); // 灰

    const orange = rgbToHsl({ r: 255, g: 128, b: 0 });
    expect(orange.h).toBeCloseTo(30.1176, 3); // 128/255 ≠ 0.5 → 微小色相偏移（真实浮点行为）
    expect(orange.s).toBeCloseTo(100, 1);
    expect(orange.l).toBeCloseTo(50, 1);

    const navy = rgbToHsl({ r: 12, g: 34, b: 56 });
    expect(navy.h).toBeCloseTo(210, 3);
    expect(navy.s).toBeCloseTo(64.7, 1);
    expect(navy.l).toBeCloseTo(13.33, 1);

    // 往返（hsl → rgb → hsl / rgb → hsl → rgb）通道误差 ≤ 1
    for (const hsl of [{ h: 0, s: 80, l: 40 }, { h: 122, s: 35, l: 72 }, { h: 300, s: 100, l: 25 }]) {
      const rgb = hslToRgb(hsl);
      const back = rgbToHsl(rgb);
      const round = hslToRgb(back);
      expect(Math.abs(round.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(round.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(round.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it("palette.harmony 互补/三叠/类比/单色角色与色相", async () => {
    const comp = dataOf(await call("palette.harmony", { base: "#3366cc", mode: "complementary" }));
    const compColors = comp.colors as Array<{ hex: string; hsl: { h: number; s: number; l: number }; role: string }>;
    expect(comp.count).toBe(2);
    expect(compColors).toHaveLength(2);
    expect(compColors[0]!.hex).toBe("#3366cc");
    expect(compColors[0]!.role).toBe("base");
    expect(compColors[1]!.role).toBe("complement");
    expect(compColors[1]!.hsl.h).toBeCloseTo(40, 1); // 220 + 180 = 400 → 40

    const extended = dataOf(await call("palette.harmony", { base: "#3366cc", mode: "complementary", count: 4 }));
    expect((extended.colors as Array<{ role: string }>).map((c) => c.role)).toEqual([
      "base", "complement", "base-light-1", "complement-light-1",
    ]);

    const triad = dataOf(await call("palette.harmony", { base: "#3366cc", mode: "triadic" }));
    const triadColors = triad.colors as Array<{ role: string; hsl: { h: number } }>;
    expect(triadColors.map((c) => c.role)).toEqual(["base", "triad-1", "triad-2"]);
    expect(triadColors[1]!.hsl.h).toBeCloseTo(340, 1);
    expect(triadColors[2]!.hsl.h).toBeCloseTo(100, 1);

    const analog = dataOf(await call("palette.harmony", { base: "#ff8000", mode: "analogous", count: 5 }));
    const analogColors = analog.colors as Array<{ role: string }>;
    expect(analogColors[2]!.role).toBe("base"); // 基准居中
    expect(analogColors[0]!.role).toBe("analog-left-30");
    expect(analogColors[4]!.role).toBe("analog-right-30");

    const mono = dataOf(await call("palette.harmony", { base: "#3366cc", mode: "monochromatic" }));
    const monoColors = mono.colors as Array<{ hsl: { h: number }; role: string }>;
    expect(monoColors).toHaveLength(5);
    expect(monoColors.every((c) => Math.abs(c.hsl.h - 220) < 0.5)).toBe(true); // 同色相
    expect(monoColors.some((c) => c.role === "base")).toBe(true);
  });

  it("palette.harmony 非法基准色 err / count 越界 zod 拒绝", async () => {
    const bad = await call("palette.harmony", { base: "nope", mode: "triadic" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
    const badAlphaForm = await call("palette.harmony", { base: "#12345", mode: "triadic" });
    expect(badAlphaForm.ok).toBe(false);
    await expect(call("palette.harmony", { base: "#3366cc", count: 13 })).rejects.toThrow(); // zod max(12)
    await expect(call("palette.harmony", { base: "#3366cc", count: 1 })).rejects.toThrow(); // zod min(2)
  });

  it("palette.ramp rgb/hsl/oklch 三种插值空间", async () => {
    const rgb = dataOf(await call("palette.ramp", { from: "#000000", to: "#ffffff", steps: 3 }));
    const rgbStops = rgb.stops as Array<{ hex: string; position: number }>;
    expect(rgbStops.map((s) => s.hex)).toEqual(["#000000", "#808080", "#ffffff"]);
    expect(rgbStops.map((s) => s.position)).toEqual([0, 0.5, 1]);

    // hsl 最短色相路径：红(0°) → 绿(120°)，中点黄(60°)
    const hsl = dataOf(await call("palette.ramp", { from: "#ff0000", to: "#00ff00", steps: 3, space: "hsl" }));
    const hslStops = hsl.stops as Array<{ hex: string }>;
    expect(hslStops[1]!.hex).toBe("#ffff00");

    const oklch = dataOf(await call("palette.ramp", { from: "#3366cc", to: "#f8fafc", steps: 5, space: "oklch" }));
    const okStops = oklch.stops as Array<{ hex: string }>;
    expect(okStops[0]!.hex).toBe("#3366cc"); // 端点往返无损
    expect(okStops[4]!.hex).toBe("#f8fafc");
    expect(oklch.space).toBe("oklch");

    const bad = await call("palette.ramp", { from: "#zzzzzz", to: "#ffffff" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
    await expect(call("palette.ramp", { from: "#000000", to: "#ffffff", steps: 1 })).rejects.toThrow(); // zod min(2)
  });

  it("palette.colorblind 命名安全色组（Tol / Okabe-Ito 精选）", async () => {
    const all = dataOf(await call("palette.colorblind", {}));
    const colors = all.colors as Array<{ hex: string; name: string }>;
    expect(all.type).toBe("all-safe");
    expect(colors).toHaveLength(8); // Okabe-Ito 全套
    expect(colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
    expect(colors.map((c) => c.name)).toContain("Vermillion");
    expect(all.source as string).toContain("Okabe-Ito");

    const sliced = dataOf(await call("palette.colorblind", { type: "all-safe", count: 3 }));
    expect((sliced.colors as unknown[])).toHaveLength(3);

    const deutan = dataOf(await call("palette.colorblind", { type: "deuteranopia-safe" }));
    expect((deutan.colors as unknown[])).toHaveLength(6);

    const tritan = dataOf(await call("palette.colorblind", { type: "tritanopia-safe" }));
    const tritanColors = tritan.colors as Array<{ name: string }>;
    expect(tritanColors.map((c) => c.name)).toContain("Vermillion");

    const tooMany = await call("palette.colorblind", { type: "tritanopia-safe", count: 9 });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.error).toContain("E_COUNT");
  });

  it("palette.contrast WCAG 比值与 AA/AAA 判定", async () => {
    const black = dataOf(await call("palette.contrast", { foreground: "#000000", background: "#ffffff" }));
    expect(black.ratio).toBe(21);
    expect(black.verdict).toBe("AAA");
    expect(black.aaNormal).toBe(true);
    expect(black.aaaLarge).toBe(true);

    const gray = dataOf(await call("palette.contrast", { foreground: "#767676", background: "#ffffff" }));
    expect(gray.ratio).toBe(4.54); // 白底 AA 阈值灰
    expect(gray.aaNormal).toBe(true);
    expect(gray.aaaNormal).toBe(false);
    expect(gray.aaLarge).toBe(true);
    expect(gray.verdict).toBe("AA");

    const same = dataOf(await call("palette.contrast", { foreground: "#ffffff", background: "#ffffff" }));
    expect(same.ratio).toBe(1);
    expect(same.verdict).toBe("fail");

    // 3 位与 8 位 hex 也能解析
    const short = dataOf(await call("palette.contrast", { foreground: "#fff", background: "#000000dd" }));
    expect(short.ratio).toBe(21);

    const bad = await call("palette.contrast", { foreground: "oops", background: "#ffffff" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
  });

  it("palette.bestText 按相对亮度选黑/白文字", async () => {
    expect(dataOf(await call("palette.bestText", { background: "#ffffff" })).color).toBe("#000000");
    expect(dataOf(await call("palette.bestText", { background: "#000000" })).color).toBe("#ffffff");
    expect(dataOf(await call("palette.bestText", { background: "#808080" })).color).toBe("#000000"); // L≈0.216 > 0.179
    expect(dataOf(await call("palette.bestText", { background: "#202020" })).color).toBe("#ffffff");
    const luminance = dataOf(await call("palette.bestText", { background: "#808080" })).relativeLuminance as number;
    expect(luminance).toBeCloseTo(0.2159, 3);

    const bad = await call("palette.bestText", { background: "#12" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
  });

  it("palette.rotate HSL 旋转/倍率与钳制", async () => {
    const rotated = dataOf(await call("palette.rotate", { base: "#ff0000", hueShift: 180 }));
    expect(rotated.hex).toBe("#00ffff"); // 纯红 h=0 → 180（青）
    expect((rotated.hsl as { h: number }).h).toBe(180);

    const orange = dataOf(await call("palette.rotate", { base: "#ff8000", hueShift: 180 }));
    expect((orange.hsl as { h: number }).h).toBeCloseTo(210.12, 1); // 30.1176 + 180

    const desat = dataOf(await call("palette.rotate", { base: "#ff0000", hueShift: 0, satMul: 0 }));
    expect(desat.hex).toBe("#808080"); // s=0、l=50 的灰

    const dark = dataOf(await call("palette.rotate", { base: "#ff8000", hueShift: 0, lightMul: 0 }));
    expect(dark.hex).toBe("#000000");

    const wrap = dataOf(await call("palette.rotate", { base: "#ff0000", hueShift: -60 }));
    expect(wrap.hex).toBe("#ff00ff"); // 0 - 60 → 300（负角回绕）

    const clamped = dataOf(await call("palette.rotate", { base: "#ff8000", hueShift: 0, lightMul: 10 }));
    expect((clamped.hsl as { l: number }).l).toBe(100); // 钳制上限

    const bad = await call("palette.rotate", { base: "orange", hueShift: 30 });
    expect(bad.ok).toBe(false);
    await expect(call("palette.rotate", { base: "#ff8000", hueShift: 400 })).rejects.toThrow(); // zod ±360
  });

  it("palette.gradients 视频背景渐变：CSS 串 + 停靠数组", async () => {
    const gradient = dataOf(await call("palette.gradients", { base: "#3366cc", style: "sunset", stops: 3 }));
    const colors = gradient.colors as Array<{ hex: string; position: number; hsl: { h: number; s: number; l: number } }>;
    expect(colors).toHaveLength(3);
    expect(colors[0]!.hsl.h).toBeCloseTo(16, 1); // sunset 首锚点（橙）
    expect(colors.map((c) => c.position)).toEqual([0, 0.5, 1]);
    expect(gradient.css as string).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 50%, #[0-9a-f]{6} 100%\)$/);

    const ocean = dataOf(await call("palette.gradients", { base: "#3366cc", style: "ocean", stops: 4 }));
    expect((ocean.colors as unknown[])).toHaveLength(4);
    expect((ocean.css as string).startsWith("linear-gradient(135deg, ")).toBe(true);

    const complementary = dataOf(await call("palette.gradients", { base: "#3366cc", style: "complementary" }));
    const compColors = complementary.colors as Array<{ hsl: { h: number } }>;
    expect(Math.abs(compColors[2]!.hsl.h - 40)).toBeLessThan(2); // 终点近互补色相

    const bad = await call("palette.gradients", { base: "#gggggg" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("E_COLOR");
    await expect(call("palette.gradients", { base: "#3366cc", stops: 9 })).rejects.toThrow(); // zod max(8)
    await expect(call("palette.gradients", { base: "#3366cc", stops: 1 })).rejects.toThrow(); // zod min(2)
  });

  it("色板输出一致性：所有 hex 均为 #rrggbb 小写且可被 parseHexColor 复析", async () => {
    const results = await Promise.all([
      call("palette.harmony", { base: "#0c2238", mode: "tetradic" }),
      call("palette.ramp", { from: "#440154", to: "#fde725", steps: 7, space: "hsl" }),
      call("palette.gradients", { base: "#0c2238", style: "cool", stops: 5 }),
    ]);
    for (const result of results) {
      const data = dataOf(result);
      const colors = (data.colors ?? data.stops) as Array<{ hex: string }>;
      expect(colors.length).toBeGreaterThan(0);
      for (const color of colors) {
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(parseHexColor(color.hex).ok).toBe(true);
      }
    }
  });
});
