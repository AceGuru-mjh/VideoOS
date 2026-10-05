// @videoos/mcp-font —— 字体注册/测量工具服务器（stdio MCP）：@napi-rs/canvas GlobalFonts。
// 关键设计点：register 幂等（重复注册返回 alreadyRegistered）；measure 用 ctx.font + measureText；
// font.best 供字幕/排版用 —— 在给定（或全部已注册）字体中二分出 ≤ maxWidth 的最大字号。
import { defineTool, runStdioServer, ok, err, jailFromEnv, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";
import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import { GlobalFonts, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

const jail = await jailFromEnv("MCP_FONT_ROOTS");

/** 测量画布（复用 10x10，仅用 measureText，不渲染） */
let measureCtx: SKRSContext2D | undefined;
function measureContext(): SKRSContext2D {
  if (measureCtx === undefined) measureCtx = createCanvas(10, 10).getContext("2d");
  return measureCtx;
}

function fontShorthand(weight: string, size: number, family: string): string {
  return `${weight} ${size}px "${family.replace(/"/g, "")}"`;
}

/** 单次测量宽度 */
function measureWidth(weight: string, size: number, family: string, text: string): number {
  const ctx = measureContext();
  ctx.font = fontShorthand(weight, size, family);
  return ctx.measureText(text).width;
}

const tools = [
  defineTool(
    "font.list",
    "List all registered font families (system + registered via font.register) with their style variants.",
    z.object({}),
    () => {
      const families = GlobalFonts.families.map((f) => ({
        family: f.family,
        styles: [...new Set(f.styles.map((s) => s.style))].sort(),
        weightRange: f.styles.length > 0
          ? { min: Math.min(...f.styles.map((s) => s.weight)), max: Math.max(...f.styles.map((s) => s.weight)) }
          : undefined,
      }));
      return ok({ families, total: families.length });
    },
  ),
  defineTool(
    "font.check",
    "Check whether a font family name is registered (usable in canvas text rendering).",
    z.object({ family: z.string().describe("font family name, e.g. \"DejaVu Sans\"") }),
    ({ family }) => ok({ family, registered: GlobalFonts.has(family) }),
  ),
  defineTool(
    "font.register",
    "Register a font file (ttf/otf) from jail roots under an alias; idempotent — re-registering reports alreadyRegistered.",
    z.object({
      path: z.string().describe("font file path, relative to jail root or absolute inside roots"),
      alias: z.string().describe("family alias to register under (default: file name without extension)").optional(),
    }),
    async ({ path, alias }) => {
      const abs = await jail.resolve(path);
      const fileStat = await stat(abs).catch(() => undefined);
      if (fileStat === undefined || !fileStat.isFile()) {
        return err(`E_NOT_FOUND: font file ${JSON.stringify(path)} does not exist`);
      }
      const name = alias ?? basename(abs, extname(abs));
      if (GlobalFonts.has(name)) {
        return ok({ success: true, alias: name, alreadyRegistered: true });
      }
      const key = GlobalFonts.registerFromPath(abs, name);
      if (key === null) {
        return err(`E_FONT: registerFromPath failed for ${JSON.stringify(path)} (not a valid ttf/otf font?)`);
      }
      return ok({ success: true, alias: name, alreadyRegistered: false });
    },
  ),
  defineTool(
    "font.measure",
    "Measure text metrics for a family at a given size/weight: width, ink ascent/descent, approx height.",
    z.object({
      family: z.string().describe('font family name, e.g. "Liberation Sans"'),
      text: z.string().describe("the text to measure"),
      size: z.number().min(1).max(512).describe("font size in px").default(48),
      weight: z.enum(["normal", "bold"]).describe("font weight").default("normal"),
    }),
    ({ family, text, size, weight }) => {
      const ctx = measureContext();
      ctx.font = fontShorthand(weight, size, family);
      const metrics = ctx.measureText(text);
      const ascent = Math.max(0, metrics.actualBoundingBoxAscent);
      const descent = Math.max(0, metrics.actualBoundingBoxDescent);
      return ok({
        family,
        size,
        weight,
        width: Math.round(metrics.width * 100) / 100,
        actualBoundingBoxAscent: Math.round(ascent * 100) / 100,
        actualBoundingBoxDescent: Math.round(descent * 100) / 100,
        approxHeight: Math.round((ascent + descent) * 100) / 100,
        registered: GlobalFonts.has(family),
      });
    },
  ),
  defineTool(
    "font.best",
    "Find the best (family, size) that fits given text within maxWidth: binary-searches the largest size ≤ size across candidate families. For subtitle/layout fitting.",
    z.object({
      text: z.string().describe("the text that must fit"),
      size: z.number().min(1).max(512).describe("maximum font size in px"),
      maxWidth: z.number().min(1).describe("available width in px"),
      weight: z.enum(["normal", "bold"]).describe("font weight").default("normal"),
      families: z.array(z.string()).describe("candidate families (default: all registered families)").optional(),
    }),
    ({ text, size, maxWidth, weight, families }) => {
      const candidates = (families ?? GlobalFonts.families.map((f) => f.family)).filter((f) => GlobalFonts.has(f));
      if (candidates.length === 0) {
        return err("E_FONT: none of the candidate families are registered (check with font.list)");
      }
      let best: { family: string; size: number; width: number } | undefined;
      for (const family of candidates) {
        const widthAtMax = measureWidth(weight, size, family, text);
        if (widthAtMax <= maxWidth) {
          if (best === undefined || size > best.size) {
            best = { family, size, width: widthAtMax }; // 已在给定上限处放得下
          }
          continue;
        }
        // 二分 [1, size]：找最大可容纳字号
        let lo = 1;
        let hi = size;
        if (measureWidth(weight, lo, family, text) > maxWidth) continue; // 1px 都放不下
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (measureWidth(weight, mid, family, text) <= maxWidth) lo = mid;
          else hi = mid;
        }
        const width = measureWidth(weight, lo, family, text);
        if (best === undefined || lo > best.size) {
          best = { family, size: lo, width };
        }
      }
      if (best === undefined) {
        return err(`E_FONT: no candidate family fits ${JSON.stringify(text)} within ${maxWidth}px even at 1px`);
      }
      const ctx = measureContext();
      ctx.font = fontShorthand(weight, best.size, best.family);
      const metrics = ctx.measureText(text);
      return ok({
        ...best,
        width: Math.round(best.width * 100) / 100,
        maxWidth,
        fits: best.width <= maxWidth,
        actualBoundingBoxAscent: Math.round(Math.max(0, metrics.actualBoundingBoxAscent) * 100) / 100,
        actualBoundingBoxDescent: Math.round(Math.max(0, metrics.actualBoundingBoxDescent) * 100) / 100,
      });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-font", serverVersion: "0.1.0" });
