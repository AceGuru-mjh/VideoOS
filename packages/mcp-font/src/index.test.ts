// mcp-font 协议级 E2E：spawn 真子进程；字体样本从系统字体目录复制进监狱（离线、无网络）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, existsSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

/** 在系统字体目录找一个 .ttf（无则返回 null → 注册用例 skip） */
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

const systemTtf = findSystemTtf();

/** 选一个真正可测量的字体（跳过 Noto Color Emoji 等墨水边界为 0 的彩色字体） */
async function pickMeasurableFamily(server: Awaited<ReturnType<typeof spawnLiteServer>>): Promise<string> {
  const listed = await server.call("font.list", {});
  const families = (listed.data as { families: Array<{ family: string }> }).families;
  for (const { family } of families) {
    if (/emoji|symbol|dingbat/i.test(family)) continue;
    const probe = await server.call("font.measure", { family, text: "H", size: 24 });
    if ((probe.data as { actualBoundingBoxAscent: number }).actualBoundingBoxAscent > 0) return family;
  }
  throw new Error("no measurable font family found on this system");
}

describe("mcp-font (E2E)", () => {
  it(
    "exposes 5 font tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "font.best",
          "font.check",
          "font.list",
          "font.measure",
          "font.register",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "font.list returns registered families with styles",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("font.list", {});
        expect(result.ok).toBe(true);
        const data = result.data as { families: Array<{ family: string; styles: string[] }>; total: number };
        expect(data.total).toBeGreaterThan(0);
        expect(data.families.length).toBe(data.total);
        for (const family of data.families.slice(0, 10)) {
          expect(typeof family.family).toBe("string");
          expect(Array.isArray(family.styles)).toBe(true);
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "font.check reports registered vs unknown families",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const listed = await server.call("font.list", {});
        const families = (listed.data as { families: Array<{ family: string }> }).families;
        const known = families[0]!.family;
        const good = await server.call("font.check", { family: known });
        expect(good.data).toMatchObject({ family: known, registered: true });

        const bad = await server.call("font.check", { family: "zzz-definitely-not-a-font" });
        expect(bad.data).toMatchObject({ registered: false });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (systemTtf !== null ? it : it.skip)(
    "font.register is idempotent and validates input files",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-font-"));
      copyFileSync(systemTtf!, join(root, "custom.ttf"));
      writeFileSync(join(root, "garbage.ttf"), "this is not a font");
      const server = await spawnLiteServer(SERVER, { env: { MCP_FONT_ROOTS: root } });
      try {
        const first = await server.call("font.register", { path: "custom.ttf" });
        expect(first.ok).toBe(true);
        expect(first.data).toMatchObject({ success: true, alias: "custom", alreadyRegistered: false });

        const again = await server.call("font.register", { path: "custom.ttf" });
        expect(again.data).toMatchObject({ success: true, alias: "custom", alreadyRegistered: true });

        const aliased = await server.call("font.register", { path: "custom.ttf", alias: "brand-font" });
        expect(aliased.data).toMatchObject({ success: true, alias: "brand-font", alreadyRegistered: false });

        const check = await server.call("font.check", { family: "custom" });
        expect(check.data).toMatchObject({ registered: true });

        const badFont = await server.call("font.register", { path: "garbage.ttf" });
        expect(badFont.ok).toBe(false);
        expect(badFont.error).toContain("E_FONT");

        const missing = await server.call("font.register", { path: "ghost.ttf" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const outside = await server.call("font.register", { path: "../escape.ttf" });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "font.measure returns width/ascent/descent that scale with size",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const family = await pickMeasurableFamily(server);
        const small = await server.call("font.measure", { family, text: "Hello VideoOS", size: 24 });
        expect(small.ok).toBe(true);
        const smallData = small.data as {
          width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number; approxHeight: number; registered: boolean;
        };
        expect(smallData.width).toBeGreaterThan(10);
        expect(smallData.actualBoundingBoxAscent).toBeGreaterThan(0);
        expect(smallData.approxHeight).toBeGreaterThanOrEqual(smallData.actualBoundingBoxAscent);
        expect(smallData.registered).toBe(true);

        const big = await server.call("font.measure", { family, text: "Hello VideoOS", size: 48 });
        const bigData = big.data as { width: number };
        expect(bigData.width).toBeGreaterThan(smallData.width * 1.5); // 两倍字号 → 明显更宽
        expect(bigData.width).toBeLessThan(smallData.width * 3);

        const bold = await server.call("font.measure", { family, text: "Hello VideoOS", size: 48, weight: "bold" });
        expect((bold.data as { width: number }).width).toBeGreaterThan(0);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "font.best finds the largest fitting size via binary search",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const family = await pickMeasurableFamily(server);

        // 上限字号放得下 → 直接返回该字号
        const easy = await server.call("font.best", { text: "Hi", size: 100, maxWidth: 1000 });
        expect(easy.ok).toBe(true);
        expect(easy.data).toMatchObject({ size: 100, fits: true });

        // 放不下 → 二分缩小，结果宽度必须 ≤ maxWidth
        const tight = await server.call("font.best", {
          text: "The quick brown fox jumps over the lazy dog",
          size: 200,
          maxWidth: 300,
          families: [family],
        });
        expect(tight.ok).toBe(true);
        const tightData = tight.data as { family: string; size: number; width: number; fits: boolean; actualBoundingBoxAscent: number };
        expect(tightData.size).toBeLessThan(200);
        expect(tightData.size).toBeGreaterThanOrEqual(1);
        expect(tightData.width).toBeLessThanOrEqual(300);
        expect(tightData.fits).toBe(true);
        expect(tightData.actualBoundingBoxAscent).toBeGreaterThan(0);

        // 指定候选字体（未注册的会被过滤）
        const scoped = await server.call("font.best", {
          text: "Hi",
          size: 50,
          maxWidth: 500,
          families: [family, "zzz-unregistered"],
        });
        expect(scoped.ok).toBe(true);
        expect((scoped.data as { family: string }).family).toBe(family);

        const none = await server.call("font.best", { text: "Hi", size: 50, maxWidth: 500, families: ["zzz-unregistered"] });
        expect(none.ok).toBe(false);
        expect(none.error).toContain("E_FONT");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
