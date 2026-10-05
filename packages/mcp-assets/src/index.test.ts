// mcp-assets 协议级 E2E：真子进程 + 临时素材目录（canvas 生成图片 / lavfi 生成视频 / 系统 ttf 复制）。
// ffmpeg 缺失的机器上时长断言退化为 size-only（本机有 ffmpeg → 真跑）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";
import { createCanvas } from "@napi-rs/canvas";

const SERVER = join(import.meta.dir, "index.ts");

const hasFfmpeg = (() => {
  try {
    return spawnSync("ffmpeg", ["-version"], { timeout: 5_000 }).error === undefined;
  } catch {
    return false;
  }
})();

/** 在系统字体目录找一个 .ttf（测试 fontFamily 解析用；找不到则跳过该断言） */
function findSystemTtf(): string | null {
  for (const dir of ["/usr/share/fonts/truetype", "/usr/share/fonts"]) {
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith(".ttf")) return full;
      }
    }
  }
  return null;
}

/** 生成 100x60 红绿双色 PNG */
function makePng(path: string, width = 100, height = 60): void {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(20, 10, 30, 20);
  writeFileSync(path, canvas.toBuffer("image/png"));
}

function makeSampleVideo(dir: string, name: string): void {
  const res = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-pix_fmt", "yuv420p", join(dir, name)],
    { timeout: 30_000 },
  );
  if (res.status !== 0) throw new Error(`sample video failed: ${res.stderr}`);
}

describe("mcp-assets (E2E)", () => {
  it(
    "exposes 3 assets tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["assets.index", "assets.info", "assets.search"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "assets.index scans images/video with dims+duration, then serves from cache",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-assets-"));
      mkdirSync(join(root, "media"));
      makePng(join(root, "hero.png"));
      makeSampleVideo(join(root, "media"), "clip.mp4");
      writeFileSync(join(root, "note.txt"), "not an asset"); // 非素材扩展名 → 忽略
      const server = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        const fresh = await server.call("assets.index", { root: "." });
        expect(fresh.ok).toBe(true);
        const freshData = fresh.data as { assets: Array<{ path: string; type: string; sizeBytes: number; width?: number; durationSec?: number }>; total: number; cached: boolean };
        expect(freshData.cached).toBe(false);
        expect(freshData.total).toBe(2);
        const png = freshData.assets.find((a) => a.path === "hero.png");
        expect(png?.type).toBe("image");
        expect(png?.width).toBe(100);
        expect(png?.sizeBytes).toBeGreaterThan(50);
        const mp4 = freshData.assets.find((a) => a.path === "media/clip.mp4");
        expect(mp4?.type).toBe("video");
        expect(mp4?.durationSec).toBeCloseTo(1, 2);

        // 第二次调用走缓存；磁盘缓存文件已生成
        const cached = await server.call("assets.index", { root: "." });
        expect((cached.data as { cached: boolean }).cached).toBe(true);
        expect(existsSync(join(root, ".assets-index.json"))).toBe(true);

        // refresh 强制重扫
        const refreshed = await server.call("assets.index", { root: ".", refresh: true });
        expect((refreshed.data as { cached: boolean; total: number }).cached).toBe(false);
        expect((refreshed.data as { total: number }).total).toBe(2);

        const badRoot = await server.call("assets.index", { root: "missing-dir" });
        expect(badRoot.ok).toBe(false);
        expect(badRoot.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "assets.search matches names case-insensitively with type filter (and E_INDEX before indexing)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-assets-"));
      makePng(join(root, "Intro-Hero.png"));
      makeSampleVideo(root, "intro-clip.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        // 未建索引 → 提示先 assets.index
        const before = await server.call("assets.search", { query: "intro" });
        expect(before.ok).toBe(false);
        expect(before.error).toContain("E_INDEX");

        await server.call("assets.index", { root: "." });

        const both = await server.call("assets.search", { query: "INTRO" });
        const bothData = both.data as { assets: Array<{ path: string }>; total: number };
        expect(bothData.total).toBe(2);

        const onlyVideo = await server.call("assets.search", { query: "intro", type: "video" });
        const videoData = onlyVideo.data as { assets: Array<{ path: string; type: string }>; total: number };
        expect(videoData.total).toBe(1);
        expect(videoData.assets[0]!.path).toBe("intro-clip.mp4");
        expect(videoData.assets[0]!.type).toBe("video");

        const none = await server.call("assets.search", { query: "zzz-nothing" });
        expect((none.data as { total: number }).total).toBe(0);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "assets.search reloads a persisted index from disk in a fresh server process",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-assets-"));
      makePng(join(root, "poster.png"));
      const first = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        const indexed = await first.call("assets.index", { root: "." });
        expect((indexed.data as { cached: boolean }).cached).toBe(false);
        const raw = JSON.parse(readFileSync(join(root, ".assets-index.json"), "utf8")) as { assets: unknown[] };
        expect(raw.assets.length).toBe(1);
      } finally {
        await first.close();
      }
      // 新进程：搜索时从监狱根磁盘缓存载入
      const second = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        const found = await second.call("assets.search", { query: "poster" });
        expect(found.ok).toBe(true);
        const foundData = found.data as { assets: Array<{ path: string }>; total: number };
        expect(foundData.total).toBe(1);
        expect(foundData.assets[0]!.path).toBe("poster.png");
      } finally {
        await second.close();
      }
    },
    20_000,
  );

  (findSystemTtf() !== null ? it : it.skip)(
    "assets.info reports font family from the sfnt name table and image dims",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-assets-"));
      makePng(join(root, "pic.png"));
      const ttf = findSystemTtf()!;
      copyFileSync(ttf, join(root, "test-font.ttf"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        const image = await server.call("assets.info", { path: "pic.png" });
        expect(image.ok).toBe(true);
        const imageData = image.data as { type: string; width: number; height: number; sizeBytes: number };
        expect(imageData.type).toBe("image");
        expect(imageData.width).toBe(100);
        expect(imageData.height).toBe(60);

        const font = await server.call("assets.info", { path: "test-font.ttf" });
        expect(font.ok).toBe(true);
        const fontData = font.data as { type: string; fontFamily?: string; sizeBytes: number };
        expect(fontData.type).toBe("font");
        expect(typeof fontData.fontFamily).toBe("string");
        expect((fontData.fontFamily ?? "").length).toBeGreaterThan(0);
        expect(fontData.sizeBytes).toBeGreaterThan(1000);

        const missing = await server.call("assets.info", { path: "ghost.png" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "jail escapes are rejected (E_JAIL)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-assets-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_ASSETS_ROOTS: root } });
      try {
        const outside = await server.call("assets.index", { root: ".." });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");
        const outsideInfo = await server.call("assets.info", { path: "/etc/passwd" });
        expect(outsideInfo.ok).toBe(false);
        expect(outsideInfo.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
