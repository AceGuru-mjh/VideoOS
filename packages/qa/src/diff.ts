// 像素 diff（SPEC §5.2）：逐像素 RGBA 对比 + diff 可视化 PNG + golden PNG 同步解码
// 注意：@napi-rs/canvas 的 loadImage 位图解码是异步的（M2 已验证），而断言 API 为同步契约，
// 故 golden 解码沿用 render-canvas 的 spawnSync 子进程方案（decode → stdout 原始 RGBA → putImageData）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createCanvas, ImageData } from "@napi-rs/canvas";

export interface DiffResult {
  /** 相同像素数 / 总像素（每像素 RGBA 四通道 |Δ| ≤ PIXEL_TOLERANCE 视为相同）；尺寸不同恒为 0 */
  similarity: number;
  /** diff 可视化 PNG（仅失败路径生成） */
  diffPng?: Buffer;
  width: number;
  height: number;
}

/** 每通道容差（±6/255） */
export const PIXEL_TOLERANCE = 6;

/** diff 可视化颜色：相同像素半透明白 / 不同像素红色叠加 */
const DIFF_SAME_RGBA: [number, number, number, number] = [255, 255, 255, 96];
const DIFF_DIFFERENT_RGBA: [number, number, number, number] = [255, 0, 0, 192];

/** 逐像素比较；尺寸不同 → similarity 0（不生成 diff） */
export function compareImages(a: ImageData, b: ImageData): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    return { similarity: 0, width: a.width, height: a.height };
  }
  const ad = a.data;
  const bd = b.data;
  const total = a.width * a.height;
  let same = 0;
  for (let i = 0; i < ad.length; i += 4) {
    if (
      Math.abs(ad[i] - bd[i]) <= PIXEL_TOLERANCE &&
      Math.abs(ad[i + 1] - bd[i + 1]) <= PIXEL_TOLERANCE &&
      Math.abs(ad[i + 2] - bd[i + 2]) <= PIXEL_TOLERANCE &&
      Math.abs(ad[i + 3] - bd[i + 3]) <= PIXEL_TOLERANCE
    ) {
      same++;
    }
  }
  return { similarity: total === 0 ? 1 : same / total, width: a.width, height: a.height };
}

/** 生成 diff 可视化 PNG：相同像素半透明白、不同像素红色叠加；尺寸不一致时取最大包围盒（越界视为不同） */
export function renderDiff(a: ImageData, b: ImageData): Buffer {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inA = y < a.height && x < a.width;
      const inB = y < b.height && x < b.width;
      let same = false;
      if (inA && inB) {
        const ai = (y * a.width + x) * 4;
        const bi = (y * b.width + x) * 4;
        same =
          Math.abs(a.data[ai] - b.data[bi]) <= PIXEL_TOLERANCE &&
          Math.abs(a.data[ai + 1] - b.data[bi + 1]) <= PIXEL_TOLERANCE &&
          Math.abs(a.data[ai + 2] - b.data[bi + 2]) <= PIXEL_TOLERANCE &&
          Math.abs(a.data[ai + 3] - b.data[bi + 3]) <= PIXEL_TOLERANCE;
      }
      const rgba = same ? DIFF_SAME_RGBA : DIFF_DIFFERENT_RGBA;
      const oi = (y * width + x) * 4;
      out[oi] = rgba[0];
      out[oi + 1] = rgba[1];
      out[oi + 2] = rgba[2];
      out[oi + 3] = rgba[3];
    }
  }
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas.toBuffer("image/png");
}

// ---- golden PNG 同步解码（子进程方案，与 render-canvas 图像解码同构） ----

const nodeRequire = createRequire(import.meta.url);

function resolveCanvasModulePath(): string {
  try {
    return nodeRequire.resolve("@napi-rs/canvas");
  } catch (err) {
    throw new Error(`Cannot resolve @napi-rs/canvas for sync decode: ${(err as Error).message}`);
  }
}

const DECODE_CHILD_SCRIPT = `
const { createCanvas, loadImage } = require(process.env.VIDEOOS_CANVAS_MODULE);
const p = process.env.VIDEOOS_DECODE_PATH;
loadImage(p).then(
  (img) => {
    if (img.width <= 0 || img.height <= 0) throw new Error('empty image');
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const out = Buffer.alloc(8 + d.length);
    out.writeUInt32LE(img.width, 0);
    out.writeUInt32LE(img.height, 4);
    out.set(d, 8);
    process.stdout.write(out);
  },
  (err) => {
    process.stderr.write(String((err && err.message) || err));
    process.exit(1);
  },
);
`;

/** 按文件内容哈希缓存解码结果（容量 32 的 LRU）：同一 golden 重复比对零子进程成本；文件被篡改后自动失效 */
const decodeCache = new Map<string, ImageData>();
const DECODE_CACHE_CAPACITY = 32;

/** 同步解码 PNG 文件为 ImageData（golden 比对用；文件被修改后按新内容重新解码） */
export function loadImageDataSync(path: string): ImageData {
  const bytes = readFileSync(path);
  const key = createHash("sha256").update(bytes).digest("hex");
  const cached = decodeCache.get(key);
  if (cached !== undefined) {
    decodeCache.delete(key);
    decodeCache.set(key, cached); // 刷新 LRU 新鲜度
    return cached;
  }
  const res = spawnSync(process.execPath, ["-e", DECODE_CHILD_SCRIPT], {
    env: {
      ...process.env,
      VIDEOOS_CANVAS_MODULE: resolveCanvasModulePath(),
      VIDEOOS_DECODE_PATH: path,
    },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error !== undefined) {
    throw new Error(`Failed to decode image ${path}: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`Failed to decode image ${path}: ${res.stderr.toString().trim()}`);
  }
  const out = res.stdout;
  if (out.length < 9) {
    throw new Error(`Malformed decode output (too short) for ${path}`);
  }
  const w = out.readUInt32LE(0);
  const h = out.readUInt32LE(4);
  if (w <= 0 || h <= 0 || out.length < 8 + w * h * 4) {
    throw new Error(`Malformed decode output for ${path} (${w}x${h}, ${out.length} bytes)`);
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  rgba.set(out.subarray(8, 8 + w * h * 4));
  const image = new ImageData(rgba, w, h);
  decodeCache.set(key, image);
  while (decodeCache.size > DECODE_CACHE_CAPACITY) {
    const oldest = decodeCache.keys().next().value;
    if (oldest === undefined) break;
    decodeCache.delete(oldest);
  }
  return image;
}
