// UpdateStore 测试（临时目录全离线）：缓存读写 / current 切换与回滚 / listInstalled / lruTrim / 平台目录
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBaseDir, UpdateStore } from "./store";
import type { ReleaseInfo } from "./provider";

let base: string;
let store: UpdateStore;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "videoos-store-"));
  store = new UpdateStore(base);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const release: ReleaseInfo = {
  version: "0.4.0",
  tag: "v0.4.0",
  channel: "stable",
  publishedAt: "2026-02-01T00:00:00Z",
  notes: "feat: ...",
  assets: [{ name: "videoos-linux-x64.tar.gz", url: "https://example.com/a", size: 1 }],
};

describe("检查缓存（latest.json）", () => {
  test("初始为 null；写入后往返一致", () => {
    expect(store.readLatestCache()).toBeNull();
    store.writeLatestCache({ release, etag: '"abc"', checkedAt: 123, channel: "stable", notifiedVersion: "0.4.0" });
    const cache = store.readLatestCache();
    expect(cache?.release?.version).toBe("0.4.0");
    expect(cache?.etag).toBe('"abc"');
    expect(cache?.checkedAt).toBe(123);
    expect(cache?.channel).toBe("stable");
    expect(cache?.notifiedVersion).toBe("0.4.0");
  });

  test("release 为 null（无任何 Release）也可缓存", () => {
    store.writeLatestCache({ release: null, etag: null, checkedAt: 456, channel: "beta" });
    expect(store.readLatestCache()?.release).toBeNull();
    expect(store.readLatestCache()?.channel).toBe("beta");
  });

  test("损坏 JSON → null（不抛）", () => {
    mkdirSync(join(base, "cache"), { recursive: true });
    writeFileSync(store.cachePath, "{broken json", "utf8");
    expect(store.readLatestCache()).toBeNull();
  });
});

describe("current.json：切换与回滚", () => {
  test("首次切换 previous 为 null；再切记录前一版本", () => {
    store.switchTo("0.4.0", 1000);
    expect(store.readCurrent()).toEqual({ version: "0.4.0", switchedAt: 1000, previous: null });
    store.switchTo("0.4.1", 2000);
    expect(store.readCurrent()?.version).toBe("0.4.1");
    expect(store.previousVersion()).toBe("0.4.0");
  });

  test("回滚后再切，previous 指向回滚前版本", () => {
    store.switchTo("0.4.0", 3000);
    expect(store.readCurrent()).toEqual({ version: "0.4.0", switchedAt: 3000, previous: "0.4.1" });
  });

  test("损坏 current.json → readCurrent/previousVersion 均 null", () => {
    writeFileSync(store.currentPath, "[]", "utf8");
    expect(store.readCurrent()).toBeNull();
    expect(store.previousVersion()).toBeNull();
  });
});

describe("listInstalled / lruTrim", () => {
  test("空目录 → 空列表", () => {
    expect(new UpdateStore(join(base, "empty-store")).listInstalled()).toEqual([]);
  });

  test("扫描 versions/ 并标记 current；按安装时间倒序", () => {
    rmSync(store.versionsDir, { recursive: true, force: true });
    for (const v of ["0.1.0", "0.2.0", "0.3.0"]) {
      mkdirSync(store.versionDir(v), { recursive: true });
      writeFileSync(join(store.versionDir(v), "videoos"), v, "utf8");
    }
    // 人为错开 mtime：0.1.0 最旧
    utimesSync(store.versionDir("0.1.0"), new Date(1000), new Date(1000));
    utimesSync(store.versionDir("0.2.0"), new Date(2000), new Date(2000));
    utimesSync(store.versionDir("0.3.0"), new Date(3000), new Date(3000));
    writeFileSync(store.currentPath, JSON.stringify({ version: "0.1.0", switchedAt: 1, previous: null }), "utf8");

    const installed = store.listInstalled();
    expect(installed.map((v) => v.version)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
    expect(installed.find((v) => v.version === "0.1.0")?.current).toBe(true);
    expect(installed.find((v) => v.version === "0.3.0")?.current).toBe(false);
  });

  test("lruTrim(3)：淘汰最旧且永不删 current", () => {
    mkdirSync(store.versionDir("0.4.0"), { recursive: true }); // 最新
    utimesSync(store.versionDir("0.4.0"), new Date(4000), new Date(4000));
    const removed = store.lruTrim(3);
    // current=0.1.0（最旧）+ 0.2.0/0.3.0/0.4.0 → 保留 current 与最新两个，淘汰 0.2.0
    expect(removed).toEqual(["0.2.0"]);
    const left = store.listInstalled().map((v) => v.version).sort();
    expect(left).toEqual(["0.1.0", "0.3.0", "0.4.0"]);
  });
});

describe("defaultBaseDir（平台目录约定）", () => {
  test("linux 尊重 XDG_DATA_HOME，缺省 ~/.local/share", () => {
    const saved = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "/xdg-data";
      expect(defaultBaseDir("linux")).toBe(join("/xdg-data", "videoos", "updater"));
      delete process.env.XDG_DATA_HOME;
      expect(defaultBaseDir("linux").replace(/\\/g, "/")).toContain(".local/share/videoos/updater");
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("win32 走 LOCALAPPDATA；darwin 走 Application Support", () => {
    const saved = process.env.LOCALAPPDATA;
    try {
      process.env.LOCALAPPDATA = "C:\\Users\\u\\AppData\\Local";
      expect(defaultBaseDir("win32")).toBe(join("C:\\Users\\u\\AppData\\Local", "videoos", "updater"));
    } finally {
      if (saved === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = saved;
    }
    expect(defaultBaseDir("darwin").replace(/\\/g, "/")).toContain("Library/Application Support/videoos/updater");
  });
});
