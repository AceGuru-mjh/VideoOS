// VideoOS 应用图标生成器 —— 零依赖（node:zlib PNG 编码 + 像素几何）。
// 生成：512×512 深色圆角方底 + 琥珀渐变播放三角（3×3 超采样抗锯齿）。
// 运行：bun apps/desktop/scripts/gen-icon.mjs  → apps/desktop/build/icon.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const SS = 3; // supersample
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.png");

// ---- PNG 编码（RGBA8，filter 0）----
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// ---- 几何（归一化 0..1，像素中心采样）----
const round = 96 / SIZE; // 圆角半径
function roundedRectSDF(x: number, y: number, cx: number, cy: number, r: number): number {
  const dx = Math.abs(x - cx) - (0.5 - r);
  const dy = Math.abs(y - cy) - (0.5 - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}
// 播放三角（顶点），返回内部权重（重心插值用）与内外判定
const TRI = { a: [0.4, 0.3], b: [0.4, 0.7], c: [0.7, 0.5] };
function barycentric(px: number, py: number): [number, number, number] | null {
  const [ax, ay] = TRI.a;
  const [bx, by] = TRI.b;
  const [cx2, cy2] = TRI.c;
  const v0x = cx2 - ax;
  const v0y = cy2 - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (denom === 0) return null;
  const u = (dot11 * dot02 - dot01 * dot12) / denom;
  const v = (dot00 * dot12 - dot01 * dot02) / denom;
  const w = 1 - u - v;
  if (u < 0 || v < 0 || w < 0) return null;
  return [w, v, u]; // [A, B, C]
}

const BG = [16, 21, 31]; // #10151F
const BORDER = [35, 45, 64]; // #232D40
const TRI_TOP = [255, 201, 77]; // #FFC94D
const TRI_BOTTOM = [245, 166, 35]; // #F5A623

const px = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const nx = (x + (sx + 0.5) / SS) / SIZE;
        const ny = (y + (sy + 0.5) / SS) / SIZE;
        const dOut = roundedRectSDF(nx, ny, 0.5, 0.5, round);
        if (dOut > 0) continue; // 透明外部
        let cr: number;
        let cg: number;
        let cb: number;
        const wTri = barycentric(nx, ny);
        if (wTri !== null) {
          const [wa, wb, wc] = wTri;
          // 渐变：A(顶) 亮 → B(底) 暗；C(右) 中间
          const t = wb; // B 权重 = 越靠下越暗
          const mid = 0.5;
          const k = t * 0.85 + wc * mid * 0.3;
          cr = TRI_TOP[0] + (TRI_BOTTOM[0] - TRI_TOP[0]) * k;
          cg = TRI_TOP[1] + (TRI_BOTTOM[1] - TRI_TOP[1]) * k;
          cb = TRI_TOP[2] + (TRI_BOTTOM[2] - TRI_TOP[2]) * k;
        } else {
          // 背景 + 4px 内描边
          const edge = Math.max(-dOut - (round - 6 / SIZE), 0);
          const borderMix = Math.min(edge / (4 / SIZE), 1);
          cr = BG[0] + (BORDER[0] - BG[0]) * borderMix;
          cg = BG[1] + (BORDER[1] - BG[1]) * borderMix;
          cb = BG[2] + (BORDER[2] - BG[2]) * borderMix;
        }
        r += cr;
        g += cg;
        b += cb;
        a += 255;
      }
    }
    const samples = SS * SS;
    const idx = (y * SIZE + x) * 4;
    if (a === 0) {
      px[idx] = 0;
      px[idx + 1] = 0;
      px[idx + 2] = 0;
      px[idx + 3] = 0;
    } else {
      const solid = a === samples * 255;
      px[idx] = Math.round(r / (a / 255));
      px[idx + 1] = Math.round(g / (a / 255));
      px[idx + 2] = Math.round(b / (a / 255));
      px[idx + 3] = solid ? 255 : Math.round((a / samples) * 255 / 255 * 255);
    }
  }
}

// ---- 组装 PNG ----
const stride = SIZE * 4;
const raw = new Uint8Array((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0; // filter none
  raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
}
const ihdr = new Uint8Array(13);
const dv = new DataView(ihdr.buffer);
dv.setUint32(0, SIZE);
dv.setUint32(4, SIZE);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = new Uint8Array([
  ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ...chunk("IHDR", ihdr),
  ...chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
  ...chunk("IEND", new Uint8Array(0)),
]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`icon written: ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`);
