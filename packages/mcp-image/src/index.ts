// @videoos/mcp-image —— 图像处理工具服务器（stdio MCP）：@napi-rs/canvas 纯本地像素操作。
// 关键设计点：info/resize/crop/compose/palette 五工具；等比缩放 + 边界 clamp；palette 用 64x64 采样
// + 每通道 4bit 桶量化取主色；全部落盘路径过 jailFromEnv("MCP_IMAGE_ROOTS")。
import { defineTool, runStdioServer, ok, err, jailFromEnv, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";
import { writeFile, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";

const jail = await jailFromEnv("MCP_IMAGE_ROOTS");

type OutputFormat = "png" | "jpeg" | "webp";

/** 输出格式缺省值：从 output 扩展名推断，否则 png */
function resolveFormat(output: string, format?: OutputFormat): OutputFormat {
  if (format !== undefined) return format;
  const ext = extname(output).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return "png";
}

function encode(canvas: Canvas, format: OutputFormat, quality: number): Buffer {
  if (format === "png") return canvas.toBuffer("image/png");
  if (format === "jpeg") return canvas.toBuffer("image/jpeg", quality);
  return canvas.toBuffer("image/webp", quality);
}

/** 加载监狱内图片；不存在/损坏 → 结构化错误 */
async function loadJailImage(path: string): Promise<{ image: Image; abs: string; sizeBytes: number }> {
  const abs = await jail.resolve(path);
  const fileStat = await stat(abs).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    throw new ToolError("E_NOT_FOUND", `image ${JSON.stringify(path)} does not exist`);
  }
  let image: Image;
  try {
    image = await loadImage(abs);
  } catch (error) {
    throw new ToolError("E_IMAGE", `cannot decode ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { image, abs, sizeBytes: fileStat.size };
}

/** 写入监狱内输出文件（父目录必须已存在） */
async function writeOutput(output: string, buffer: Buffer): Promise<string> {
  const abs = await jail.resolve(output);
  const parent = dirname(abs);
  const parentStat = await stat(parent).catch(() => undefined);
  if (parentStat === undefined || !parentStat.isDirectory()) {
    throw new ToolError("E_NOT_FOUND", `output directory ${JSON.stringify(dirname(output))} does not exist`);
  }
  await writeFile(abs, buffer);
  return abs;
}

function highQualityContext(width: number, height: number): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

const formatSchema = z.enum(["png", "jpeg", "webp"]).describe("output encoding (default: from output extension, else png)");
const qualitySchema = z.number().int().min(1).max(100).describe("jpeg/webp quality 1-100").default(90);

const tools = [
  defineTool(
    "image.info",
    "Get image dimensions, type (from extension) and file size without modifying it.",
    z.object({ path: z.string().describe("image path, relative to jail root or absolute inside roots") }),
    async ({ path }) => {
      const { image, abs, sizeBytes } = await loadJailImage(path);
      const ext = extname(abs).slice(1).toLowerCase();
      return ok({ path: abs, width: image.width, height: image.height, type: ext.length > 0 ? ext : "unknown", sizeBytes });
    },
  ),
  defineTool(
    "image.resize",
    "Resize an image with proportional scaling (give width or height only to keep aspect ratio) and re-encode as png/jpeg/webp.",
    z.object({
      path: z.string().describe("input image path inside jail roots"),
      width: z.number().int().min(1).max(8192).describe("target width in px (omit to derive from height)").optional(),
      height: z.number().int().min(1).max(8192).describe("target height in px (omit to derive from width)").optional(),
      output: z.string().describe("output image path inside jail roots"),
      format: formatSchema.optional(),
      quality: qualitySchema,
    }),
    async ({ path, width, height, output, format, quality }) => {
      if (width === undefined && height === undefined) {
        return err("E_ARGS: provide at least one of width or height");
      }
      const { image } = await loadJailImage(path);
      let targetW = width;
      let targetH = height;
      if (targetW === undefined) targetW = Math.max(1, Math.round((image.width / image.height) * targetH!));
      if (targetH === undefined) targetH = Math.max(1, Math.round((image.height / image.width) * targetW));
      const { canvas, ctx } = highQualityContext(targetW, targetH);
      ctx.drawImage(image, 0, 0, targetW, targetH);
      const out = resolveFormat(output, format);
      const abs = await writeOutput(output, encode(canvas, out, quality));
      return ok({ output: abs, width: targetW, height: targetH, format: out });
    },
  ),
  defineTool(
    "image.crop",
    "Crop a rectangle out of an image; the rect is clamped to image bounds (fully outside → E_RANGE).",
    z.object({
      path: z.string().describe("input image path inside jail roots"),
      x: z.number().int().min(0).describe("left edge in px"),
      y: z.number().int().min(0).describe("top edge in px"),
      width: z.number().int().min(1).describe("crop width in px"),
      height: z.number().int().min(1).describe("crop height in px"),
      output: z.string().describe("output image path inside jail roots"),
      format: formatSchema.optional(),
      quality: qualitySchema,
    }),
    async ({ path, x, y, width, height, output, format, quality }) => {
      const { image } = await loadJailImage(path);
      const sx = Math.min(Math.max(x, 0), image.width);
      const sy = Math.min(Math.max(y, 0), image.height);
      const ex = Math.min(Math.max(x + width, 0), image.width);
      const ey = Math.min(Math.max(y + height, 0), image.height);
      const cropW = ex - sx;
      const cropH = ey - sy;
      if (cropW < 1 || cropH < 1) {
        return err(`E_RANGE: crop rect (x=${x},y=${y},w=${width},h=${height}) is fully outside the ${image.width}x${image.height} image`);
      }
      const { canvas, ctx } = highQualityContext(cropW, cropH);
      ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
      const out = resolveFormat(output, format);
      const abs = await writeOutput(output, encode(canvas, out, quality));
      return ok({ output: abs, width: cropW, height: cropH, clamped: cropW !== width || cropH !== height });
    },
  ),
  defineTool(
    "image.compose",
    "Composite an overlay image onto a base image at (x, y) with an opacity in [0,1]; canvas size = base size (overflow is clipped).",
    z.object({
      base: z.string().describe("base image path inside jail roots (defines canvas size)"),
      overlay: z.string().describe("overlay image path inside jail roots (not scaled)"),
      x: z.number().int().describe("overlay left edge in px (may be negative)"),
      y: z.number().int().describe("overlay top edge in px (may be negative)"),
      output: z.string().describe("output image path inside jail roots"),
      opacity: z.number().min(0).max(1).describe("overlay alpha 0-1").default(1),
      format: formatSchema.optional(),
      quality: qualitySchema,
    }),
    async ({ base, overlay, x, y, output, opacity, format, quality }) => {
      const baseImage = await loadJailImage(base);
      const overlayImage = await loadJailImage(overlay);
      const { canvas, ctx } = highQualityContext(baseImage.image.width, baseImage.image.height);
      ctx.drawImage(baseImage.image, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlayImage.image, x, y);
      ctx.globalAlpha = 1;
      const out = resolveFormat(output, format);
      const abs = await writeOutput(output, encode(canvas, out, quality));
      return ok({
        output: abs,
        width: baseImage.image.width,
        height: baseImage.image.height,
        format: out,
      });
    },
  ),
  defineTool(
    "image.palette",
    "Extract the dominant colors of an image: 64x64 sampling, per-channel 4-bit quantized buckets → top-N colors with ratios.",
    z.object({
      path: z.string().describe("input image path inside jail roots"),
      count: z.number().int().min(1).max(16).describe("number of dominant colors to return").default(5),
    }),
    async ({ path, count }) => {
      const { image } = await loadJailImage(path);
      const size = 64;
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        if (a < 128) continue; // 透明像素不参与
        total++;
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
      }
      if (total === 0) return err("E_IMAGE: image has no visible (opaque) pixels to sample");
      const top = [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, count)
        .map((bucket) => {
          const r = Math.round(bucket.r / bucket.count);
          const g = Math.round(bucket.g / bucket.count);
          const b = Math.round(bucket.b / bucket.count);
          const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
          return { hex, ratio: Math.round((bucket.count / total) * 10_000) / 10_000 };
        });
      return ok({ colors: top, sampleSize: size * size, buckets: buckets.size });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-image", serverVersion: "0.1.0" });
