// diff 单元测试：compareImages 容差/尺寸契约、renderDiff 可视化颜色、loadImageDataSync 同步解码与缓存失效
import { beforeAll, afterAll, expect as bunExpect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { compareImages, loadImageDataSync, renderDiff } from "./diff";

const TMP = join(tmpdir(), "videoos-qa-diff-tests");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function solidImage(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return new ImageData(data, width, height);
}

test("compareImages：完全相同 → similarity 1", () => {
  const a = solidImage(4, 4, [255, 0, 0, 255]);
  const b = solidImage(4, 4, [255, 0, 0, 255]);
  const result = compareImages(a, b);
  bunExpect(result.similarity).toBe(1);
  bunExpect(result.width).toBe(4);
  bunExpect(result.height).toBe(4);
});

test("compareImages：容差 ±6（RGBA 四通道）内视为相同", () => {
  const a = solidImage(2, 2, [10, 10, 10, 255]);
  bunExpect(compareImages(a, solidImage(2, 2, [16, 16, 16, 249])).similarity).toBe(1); // |Δ|=6/6/6/6 → 相同
  bunExpect(compareImages(a, solidImage(2, 2, [17, 10, 10, 255])).similarity).toBe(0); // R 通道 |Δ|=7 → 不同
  bunExpect(compareImages(a, solidImage(2, 2, [10, 10, 10, 248])).similarity).toBe(0); // A 通道 |Δ|=7 → 不同
});

test("compareImages：尺寸不同 → similarity 0（不抛错）", () => {
  const a = solidImage(4, 4, [0, 0, 0, 255]);
  const b = solidImage(5, 4, [0, 0, 0, 255]);
  const result = compareImages(a, b);
  bunExpect(result.similarity).toBe(0);
  bunExpect(result.width).toBe(4);
  bunExpect(result.height).toBe(4);
});

test("compareImages：部分像素不同 → 精确比例（2/4 像素不同 → 0.5）", () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const a = new ImageData(data, 2, 2);
  const b = solidImage(2, 2, [255, 0, 0, 255]);
  bunExpect(compareImages(a, b).similarity).toBe(0.5);
});

test("renderDiff：生成合法 PNG，相同像素半透明白、不同像素红色叠加", () => {
  const a = solidImage(2, 1, [255, 0, 0, 255]);
  const b = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1);
  const png = renderDiff(a, b);
  bunExpect(png.readUInt32BE(16)).toBe(2); // IHDR width
  bunExpect(png.readUInt32BE(20)).toBe(1); // IHDR height
  // 解码回像素验证颜色（走 loadImageDataSync，同时覆盖其正确性）
  const file = join(TMP, "diff-probe.png");
  writeFileSync(file, png);
  const decoded = loadImageDataSync(file);
  bunExpect(Array.from(decoded.data.slice(0, 4))).toEqual([255, 255, 255, 96]); // 相同 → 半透明白
  bunExpect(Array.from(decoded.data.slice(4, 8))).toEqual([255, 0, 0, 192]);   // 不同 → 红色叠加
});

test("renderDiff：尺寸不一致 → 最大包围盒，越界像素视为不同", () => {
  const a = solidImage(2, 2, [10, 10, 10, 255]);
  const b = solidImage(3, 3, [10, 10, 10, 255]);
  const png = renderDiff(a, b);
  bunExpect(png.readUInt32BE(16)).toBe(3);
  bunExpect(png.readUInt32BE(20)).toBe(3);
});

test("loadImageDataSync：解码 PNG → 精确 RGBA；同内容命中缓存（实例恒等）", () => {
  const canvas = createCanvas(8, 6);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#336699";
  ctx.fillRect(0, 0, 8, 6);
  const file = join(TMP, "solid.png");
  writeFileSync(file, canvas.toBuffer("image/png"));

  const first = loadImageDataSync(file);
  bunExpect(first.width).toBe(8);
  bunExpect(first.height).toBe(6);
  bunExpect(Array.from(first.data.slice(0, 4))).toEqual([51, 102, 153, 255]);
  bunExpect(loadImageDataSync(file)).toBe(first); // 缓存命中（同一实例）
});

test("loadImageDataSync：文件内容变化（篡改）→ 缓存自动失效并重新解码", () => {
  const file = join(TMP, "mutable.png");
  const canvas = createCanvas(4, 4);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 4, 4);
  writeFileSync(file, canvas.toBuffer("image/png"));
  const red = loadImageDataSync(file);
  bunExpect(red.data[0]).toBe(255);

  ctx.fillStyle = "#0000ff"; // 重画为蓝
  ctx.fillRect(0, 0, 4, 4);
  writeFileSync(file, canvas.toBuffer("image/png"));
  const blue = loadImageDataSync(file);
  bunExpect(blue.data[0]).toBe(0);
  bunExpect(blue.data[2]).toBe(255);
});

test("loadImageDataSync：损坏文件抛解码错误", () => {
  const file = join(TMP, "corrupt.png");
  writeFileSync(file, Buffer.from("this is not a png at all"));
  bunExpect(() => loadImageDataSync(file)).toThrow(/Failed to decode/);
});
