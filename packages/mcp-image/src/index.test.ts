// mcp-image 协议级 E2E：spawn 真子进程；测试夹具用 @napi-rs/canvas 本地生成 PNG/JPEG（离线）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const SERVER = join(import.meta.dir, "index.ts");

/** 生成 w×h 的 PNG：左半 red、右半 blue，中央绿块 */
function makePng(path: string, width = 200, height = 100): void {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, width / 2, height);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(width / 2, 0, width / 2, height);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(width / 2 - 10, height / 2 - 10, 20, 20);
  writeFileSync(path, canvas.toBuffer("image/png"));
}

describe("mcp-image (E2E)", () => {
  it(
    "exposes 5 image tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "image.compose",
          "image.crop",
          "image.info",
          "image.palette",
          "image.resize",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "image.info reports dimensions, type and size",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "photo.png"), 320, 200);
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        const result = await server.call("image.info", { path: "photo.png" });
        expect(result.ok).toBe(true);
        const data = result.data as { width: number; height: number; type: string; sizeBytes: number };
        expect(data.width).toBe(320);
        expect(data.height).toBe(200);
        expect(data.type).toBe("png");
        expect(data.sizeBytes).toBe(statSync(join(root, "photo.png")).size);

        const missing = await server.call("image.info", { path: "ghost.png" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const corrupt = await server.call("image.info", { path: "corrupt.png" });
        expect(corrupt.ok).toBe(false); // 未创建 → E_NOT_FOUND（不存在/坏文件都不炸）
        expect(corrupt.error).toMatch(/E_NOT_FOUND|E_IMAGE/);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "image.resize scales proportionally (width only) and re-encodes jpeg",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "in.png"), 400, 200);
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        const half = await server.call("image.resize", {
          path: "in.png",
          width: 100, // 只给宽 → 高按比例 = 50
          output: "half.png",
        });
        expect(half.ok).toBe(true);
        expect(half.data).toMatchObject({ width: 100, height: 50, format: "png" });
        const halfImage = await loadImage(join(root, "half.png"));
        expect(halfImage.width).toBe(100);
        expect(halfImage.height).toBe(50);

        const jpeg = await server.call("image.resize", {
          path: "in.png",
          width: 80,
          height: 40,
          output: "small.jpg",
          format: "jpeg",
          quality: 75,
        });
        expect(jpeg.ok).toBe(true);
        expect(jpeg.data).toMatchObject({ format: "jpeg", width: 80, height: 40 });
        expect(existsSync(join(root, "small.jpg"))).toBe(true);

        const noDims = await server.call("image.resize", { path: "in.png", output: "x.png" });
        expect(noDims.ok).toBe(false);
        expect(noDims.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "image.crop clamps to bounds and rejects fully-outside rects",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "in.png"), 200, 100);
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        // 部分越界：x=150 w=100 → clamp 到 200-150=50
        const clamped = await server.call("image.crop", {
          path: "in.png",
          x: 150,
          y: 25,
          width: 100,
          height: 60,
          output: "crop.png",
        });
        expect(clamped.ok).toBe(true);
        expect(clamped.data).toMatchObject({ width: 50, height: 60, clamped: true });
        const cropped = await loadImage(join(root, "crop.png"));
        expect(cropped.width).toBe(50);

        // 全出界 → E_RANGE
        const outside = await server.call("image.crop", {
          path: "in.png",
          x: 500,
          y: 500,
          width: 10,
          height: 10,
          output: "never.png",
        });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_RANGE");
        expect(existsSync(join(root, "never.png"))).toBe(false);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "image.compose overlays with opacity on a base-sized canvas",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "base.png"), 200, 100);
      makePng(join(root, "overlay.png"), 60, 40);
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        const result = await server.call("image.compose", {
          base: "base.png",
          overlay: "overlay.png",
          x: 20,
          y: 30,
          output: "composited.png",
          opacity: 0.5,
        });
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ width: 200, height: 100, format: "png" });
        const composed = await loadImage(join(root, "composited.png"));
        expect(composed.width).toBe(200);
        expect(composed.height).toBe(100);
        // overlay 中心点应被绿覆盖一半（0.5 alpha 混合后红→黄调）
        const ctx = createCanvas(1, 1).getContext("2d");
        ctx.drawImage(composed, -(20 + 30), -(30 + 20)); // overlay 中心 (50,50) 采到 1x1
        const px = ctx.getImageData(0, 0, 1, 1).data;
        expect(px[1]!).toBeGreaterThan(60); // 绿通道明显抬升
        expect(px[0]!).toBeGreaterThan(60); // 红底仍保留
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "image.palette returns dominant colors with ratios",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "photo.png"), 200, 100); // 红/蓝各半 + 小绿块
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        const result = await server.call("image.palette", { path: "photo.png", count: 3 });
        expect(result.ok).toBe(true);
        const data = result.data as { colors: Array<{ hex: string; ratio: number }>; buckets: number };
        expect(data.colors.length).toBe(3);
        expect(data.colors.length).toBeLessThanOrEqual(3);
        const hexes = data.colors.map((c) => c.hex);
        expect(hexes).toContain("#ff0000");
        expect(hexes).toContain("#0000ff");
        expect(data.colors[0]!.ratio).toBeGreaterThan(0.4);
        const sum = data.colors.reduce((acc, c) => acc + c.ratio, 0);
        expect(sum).toBeLessThanOrEqual(1.0001);
        expect(data.buckets).toBeGreaterThanOrEqual(2);

        const small = await server.call("image.palette", { path: "photo.png", count: 1 });
        expect((small.data as { colors: unknown[] }).colors.length).toBe(1);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "jail escapes are rejected (E_JAIL)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-image-"));
      makePng(join(root, "in.png"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_IMAGE_ROOTS: root } });
      try {
        const outside = await server.call("image.resize", {
          path: "in.png",
          width: 10,
          output: "../escape.png",
        });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
