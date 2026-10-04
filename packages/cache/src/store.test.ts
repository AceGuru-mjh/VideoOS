// ContentStore + FrameCache 测试：put/get/has/stats/clear、二级分片路径、并发写完整性、
// frameKey/sceneKey 确定性与区分度、命中统计（临时目录测试后清理）
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheError, ContentStore } from "./store";
import type { CacheStats } from "./store";
import { FrameCache, frameKey, sceneKey, FRAMES_NAMESPACE } from "./frame-cache";
import { BACKEND_VERSION } from "./index";

let root: string;
let store: ContentStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "videoos-cache-store-"));
  store = new ContentStore(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ContentStore：put/get/has", () => {
  test("put 返回落位路径，get/has 往返一致", async () => {
    const data = Buffer.from("frame-png-bytes-0");
    const p = await store.put("frames", "aabbccdd0000.png", data);
    expect(p).toBe(store.path("frames", "aabbccdd0000.png"));
    expect(existsSync(p)).toBe(true);
    expect(await store.has("frames", "aabbccdd0000.png")).toBe(true);
    const got = await store.get("frames", "aabbccdd0000.png");
    expect(got).not.toBeNull();
    expect(Buffer.compare(got!, data)).toBe(0);
  });

  test("缺失 key：get 返回 null、has 返回 false", async () => {
    expect(await store.get("frames", "ffffffffffff.png")).toBeNull();
    expect(await store.has("frames", "ffffffffffff.png")).toBe(false);
  });

  test("同 key 重复 put = 覆盖（读到最新内容）", async () => {
    await store.put("frames", "overwrite0000.png", Buffer.from("v1"));
    await store.put("frames", "overwrite0000.png", Buffer.from("v2-longer"));
    const got = await store.get("frames", "overwrite0000.png");
    expect(got!.toString()).toBe("v2-longer");
  });

  test("非法 namespace/key 抛 CacheError（防路径穿越）", () => {
    expect(() => store.path("../evil", "k.png")).toThrow(CacheError);
    expect(() => store.path("a/b", "k.png")).toThrow(/CACHE_INVALID_NAME/);
    expect(() => store.path("", "k.png")).toThrow(/CACHE_INVALID_NAME/);
    expect(() => store.path("frames", "../evil.png")).toThrow(CacheError);
    expect(() => store.path("frames", "a/b.png")).toThrow(CacheError);
    expect(() => new ContentStore("")).toThrow(/CACHE_INVALID_ROOT/);
  });
});

describe("ContentStore：二级分片路径", () => {
  test("path = root/namespace/aa/bb/<key>", () => {
    const key = "0123456789abcdef.png";
    expect(store.path("frames", key)).toBe(join(root, "frames", "01", "23", key));
    // 不足 4 字符的 key 不分片（退化为平铺）
    expect(store.path("scenes", "ab")).toBe(join(root, "scenes", "ab"));
    expect(store.path("scenes", "abc")).toBe(join(root, "scenes", "abc"));
  });

  test("写入后文件确实位于分片目录", async () => {
    const key = "feedfacebeef.png";
    const p = await store.put("frames", key, Buffer.from("x"));
    expect(p).toBe(join(root, "frames", "fe", "ed", key));
    expect(existsSync(join(root, "frames", "fe", "ed", key))).toBe(true);
  });
});

describe("ContentStore：stats 与 clear", () => {
  test("stats 汇总条目数与字节数（按命名空间细分）", async () => {
    await store.put("frames", "aaaa00000001.png", Buffer.alloc(100));
    await store.put("frames", "aaaa00000002.png", Buffer.alloc(50));
    await store.put("scenes", "bbbb00000003.json", Buffer.alloc(25));
    const stats: CacheStats = await store.stats();
    expect(stats.namespaces["frames"]!.entries).toBeGreaterThanOrEqual(2);
    expect(stats.namespaces["frames"]!.bytes).toBeGreaterThanOrEqual(150);
    expect(stats.namespaces["scenes"]!.entries).toBeGreaterThanOrEqual(1);
    expect(stats.namespaces["scenes"]!.bytes).toBeGreaterThanOrEqual(25);
    expect(stats.entries).toBe(stats.namespaces["frames"]!.entries + stats.namespaces["scenes"]!.entries);
    expect(stats.bytes).toBe(stats.namespaces["frames"]!.bytes + stats.namespaces["scenes"]!.bytes);
  });

  test("clear(namespace) 只清该命名空间", async () => {
    await store.clear("scenes");
    const stats = await store.stats();
    expect(stats.namespaces["scenes"]).toBeUndefined();
    expect((stats.namespaces["frames"]?.entries ?? 0)).toBeGreaterThan(0);
  });

  test("clear() 清空全部", async () => {
    await store.clear();
    const stats = await store.stats();
    expect(stats.entries).toBe(0);
    expect(Object.keys(stats.namespaces)).toHaveLength(0);
    // 清空后可继续写入（目录惰性重建）
    await store.put("frames", "reborn000000.png", Buffer.from("again"));
    expect(await store.has("frames", "reborn000000.png")).toBe(true);
  });

  test("不存在的 root：stats 返回空、clear 无副作用", async () => {
    const empty = new ContentStore(join(root, "not-exist"));
    const stats = await empty.stats();
    expect(stats.entries).toBe(0);
    await empty.clear();
    await empty.clear("frames");
  });
});

describe("ContentStore：并发写同 key 不损坏", () => {
  test("8 个并发 put（不同内容/长度）后读到某次完整写入", async () => {
    const key = "deadbeefcafe.png";
    const payloads = Array.from({ length: 8 }, (_, i) => Buffer.alloc(64 * (i + 1), i));
    await Promise.all(payloads.map((data) => store.put("frames", key, data)));
    const got = await store.get("frames", key);
    expect(got).not.toBeNull();
    // rename 原子性：最终内容必须与某次写入完全一致（无撕裂/混合）
    const matched = payloads.some((data) => Buffer.compare(data, got!) === 0);
    expect(matched).toBe(true);
    // 且文件可完整读取（长度与某 payload 一致）
    const raw = readFileSync(store.path("frames", key));
    expect(payloads.some((data) => data.length === raw.length)).toBe(true);
  });
});

describe("frameKey / sceneKey", () => {
  const base = { virHash: "a".repeat(64), backendId: "canvas", backendVersion: "0.1.0", frame: 10, width: 1920, height: 1080 };

  test("确定性：同输入同 key；属性来源对象键序无关", () => {
    expect(frameKey(base)).toBe(frameKey({ ...base }));
    const reordered = { height: 1080, width: 1920, frame: 10, backendVersion: "0.1.0", backendId: "canvas", virHash: "a".repeat(64) };
    expect(frameKey(base)).toBe(frameKey(reordered));
  });

  test("区分度：任一成分不同则 key 不同", () => {
    const k = frameKey(base);
    expect(frameKey({ ...base, frame: 11 })).not.toBe(k);
    expect(frameKey({ ...base, width: 1280 })).not.toBe(k);
    expect(frameKey({ ...base, height: 720 })).not.toBe(k);
    expect(frameKey({ ...base, virHash: "b".repeat(64) })).not.toBe(k);
    expect(frameKey({ ...base, backendId: "svg" })).not.toBe(k);
    expect(frameKey({ ...base, backendVersion: "0.2.0" })).not.toBe(k);
  });

  test("输出为 40 位 hex", () => {
    expect(frameKey(base)).toMatch(/^[0-9a-f]{40}$/);
  });

  test("sceneKey 确定性 + 区分度 + 40 hex", () => {
    const s = { virHash: "a".repeat(64), sceneId: "scene_intro", backendId: "canvas", backendVersion: "0.1.0" };
    expect(sceneKey(s)).toBe(sceneKey({ ...s }));
    expect(sceneKey({ ...s, sceneId: "scene_features" })).not.toBe(sceneKey(s));
    expect(sceneKey({ ...s, backendId: "svg" })).not.toBe(sceneKey(s));
    expect(sceneKey({ ...s, virHash: "c".repeat(64) })).not.toBe(sceneKey(s));
    expect(sceneKey(s)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("FrameCache", () => {
  test("miss → null 计 miss；putFrame 计 write；hit 返回原 buffer 计 hit", async () => {
    const cache = new FrameCache(store);
    const key = frameKey({ virHash: "d".repeat(64), backendId: "canvas", backendVersion: BACKEND_VERSION, frame: 3, width: 64, height: 64 });
    expect(await cache.getFrame(key)).toBeNull();
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(0);

    const png = Buffer.from("PNGDATA");
    await cache.putFrame(key, png);
    expect(cache.writes).toBe(1);

    const got = await cache.getFrame(key);
    expect(Buffer.compare(got!, png)).toBe(0);
    expect(cache.hits).toBe(1);

    // 磁盘文件带 .png 扩展名且位于 frames 命名空间
    expect(existsSync(join(root, FRAMES_NAMESPACE, key.slice(0, 2), key.slice(2, 4), `${key}.png`))).toBe(true);
  });

  test("resetStats 归零", async () => {
    const cache = new FrameCache(store);
    const key = frameKey({ virHash: "e".repeat(64), backendId: "canvas", backendVersion: "0.1.0", frame: 0, width: 32, height: 32 });
    await cache.getFrame(key); // miss
    await cache.putFrame(key, Buffer.from("p"));
    await cache.getFrame(key); // hit
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
    expect(cache.writes).toBe(1);
    cache.resetStats();
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
    expect(cache.writes).toBe(0);
  });
});
