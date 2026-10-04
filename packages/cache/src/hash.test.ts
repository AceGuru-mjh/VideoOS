// hash 工具测试：SHA-256 已知向量 / canonicalJson 稳定性 / virHash 键序无关 / assetHash 文件字节
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Vir, VirLayer } from "@videoos/vir";
import { assetHash, canonicalJson, sha256Hex, virHash } from "./hash";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "videoos-cache-hash-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 最小合法 VIR 字面量（仅类型层面满足；virHash 不做 schema 校验） */
function makeVir(): Vir {
  return {
    virVersion: "1.0",
    meta: { title: "t", width: 64, height: 64, fps: 30, duration: 1, background: "#000000", seed: 42 },
    scenes: [{
      id: "scene_a",
      name: "a",
      start: 0,
      duration: 1,
      layers: [{
        id: "layer_t", name: "t", type: "text", in: 0, out: 1,
        transform: { anchor: { x: 0.5, y: 0.5 }, position: { x: "50%", y: "50%" }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 },
        animations: [], uses: [],
        text: { content: "hi", font: "Inter", size: 12, weight: 400, color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.2 },
      }],
      beats: [],
    }],
    transitions: [],
    audio: [],
    assets: [],
    graphs: {
      temporal: { nodes: [{ id: "scene_a", kind: "scene", start: 0, end: 1 }], edges: [] },
      spatial: { roots: { scene_a: ["layer_t"] } },
      dependency: { nodes: [], edges: [] },
    },
  };
}

describe("sha256Hex", () => {
  test("已知向量：sha256('hello')", () => {
    expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("字符串与等价 Buffer 输入产出一致", () => {
    expect(sha256Hex("videoos")).toBe(sha256Hex(Buffer.from("videoos", "utf8")));
    expect(sha256Hex("视频操作系统")).toBe(createHash("sha256").update("视频操作系统", "utf8").digest("hex"));
  });

  test("输出为 64 位小写 hex", () => {
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("canonicalJson", () => {
  test("对象键排序与插入序无关（嵌套亦然）", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { y: 2, x: 1 }, a: [3, 2, 1] })).toBe('{"a":[3,2,1],"z":{"x":1,"y":2}}');
  });

  test("数组保持顺序", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  test("数字：整数直出、浮点保留原值", () => {
    expect(canonicalJson({ n: 1 })).toBe('{"n":1}');
    expect(canonicalJson({ n: 1.5 })).toBe('{"n":1.5}');
    expect(canonicalJson({ n: 0.1 + 0.2 })).toBe('{"n":0.30000000000000004}');
  });

  test("null / 布尔 / 字符串转义", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson('a"b\\c\n')).toBe(JSON.stringify('a"b\\c\n'));
  });

  test("undefined / NaN 与 null 一致（确定性退化）", () => {
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(Number.NaN)).toBe("null");
  });
});

describe("virHash", () => {
  test("键序不同的等价 VIR 产出相同哈希", () => {
    const v1 = makeVir();
    const v2: Vir = JSON.parse(JSON.stringify(v1));
    // 打乱若干层级的键插入序（JSON 往返后重新逆序插入）
    v2.scenes[0]!.layers[0]!.transform = { rotation: 0, opacity: 1, scale: { y: 1, x: 1 }, position: { y: "50%", x: "50%" }, anchor: { y: 0.5, x: 0.5 } };
    v2.meta = { seed: 42, background: "#000000", duration: 1, fps: 30, height: 64, width: 64, title: "t" };
    expect(virHash(v1)).toBe(virHash(v2));
  });

  test("内容不同则哈希不同", () => {
    const v1 = makeVir();
    const v2 = makeVir();
    const textLayer = v2.scenes[0]!.layers[0] as Extract<VirLayer, { type: "text" }>;
    textLayer.text.content = "changed";
    expect(virHash(v1)).not.toBe(virHash(v2));
  });

  test("确定性：同对象重复调用一致", () => {
    const v = makeVir();
    expect(virHash(v)).toBe(virHash(v));
    expect(virHash(v)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("assetHash", () => {
  test("等于文件字节的 SHA-256", async () => {
    const data = Buffer.from("binary-asset-content-视频");
    const p = join(dir, "a.bin");
    writeFileSync(p, data);
    expect(await assetHash(p)).toBe(sha256Hex(data));
  });

  test("内容相同的不同文件哈希一致；内容不同则不同", async () => {
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "copy.bin"), "same");
    writeFileSync(join(dir, "orig.bin"), "same");
    writeFileSync(join(dir, "other.bin"), "different");
    expect(await assetHash(join(dir, "sub", "copy.bin"))).toBe(await assetHash(join(dir, "orig.bin")));
    expect(await assetHash(join(dir, "other.bin"))).not.toBe(await assetHash(join(dir, "orig.bin")));
  });
});
