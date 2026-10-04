// VIR schema 测试：合法/非法样例、strict 模式、默认值、递归 children
import { describe, expect, test } from "bun:test";
import type { Vir, VirLayer } from "./types";
import { parseVir, VirLayerSchema, VirParseError } from "./schema";

function makeTextLayer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "layer_intro_title",
    name: "title",
    type: "text",
    in: 0,
    out: 4,
    transform: {
      anchor: { x: 0.5, y: 0.5 },
      position: { x: "50%", y: "42%" },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    },
    animations: [
      { type: "enter", effect: "blur-up", duration: 0.8, delay: 0, easing: "easeOutCubic", params: { distance: 40, blur: 12 } },
      { type: "loop", effect: "fade", duration: 0.5, delay: 0, easing: "linear", params: { period: 2 } },
    ],
    uses: ["asset_font_inter"],
    text: {
      content: "VideoOS", font: "Inter", size: 120, weight: 700,
      color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.2,
    },
    ...overrides,
  };
}

function makeVir(overrides: Record<string, unknown> = {}): Vir {
  return {
    virVersion: "1.0",
    meta: { title: "t", width: 1920, height: 1080, fps: 30, duration: 4, background: "#0a0a12", seed: 42 },
    scenes: [
      {
        id: "scene_intro", name: "intro", start: 0, duration: 4,
        layers: [makeTextLayer() as unknown as VirLayer],
        beats: [{ id: "beat_intro_title-enter", name: "title-enter", at: 0.2, description: "主标题入场" }],
      },
    ],
    transitions: [{ type: "crossfade", duration: 0.5, between: ["intro", "next"] }],
    audio: [{ id: "audio_bgm", name: "bgm", src: "a.mp3", start: 0, volume: 1, fadeIn: 1, fadeOut: 2, loop: true }],
    assets: [{ id: "asset_font_inter", type: "font", src: "font:Inter", hash: "abc" }],
    graphs: {
      temporal: { nodes: [{ id: "scene_intro", kind: "scene", start: 0, end: 4 }], edges: [] },
      spatial: { roots: { scene_intro: ["layer_intro_title"] } },
      dependency: {
        nodes: [
          { id: "scene_intro", kind: "scene" },
          { id: "layer_intro_title", kind: "layer" },
          { id: "asset_font_inter", kind: "asset" },
        ],
        edges: [{ from: "layer_intro_title", to: "asset_font_inter" }],
      },
    },
    ...overrides,
  } as Vir;
}

describe("parseVir 合法样例", () => {
  test("完整 VIR 原样通过", () => {
    const vir = parseVir(makeVir());
    expect(vir.meta.title).toBe("t");
    expect(vir.scenes[0]!.layers[0]!.type).toBe("text");
    expect(vir.scenes[0]!.layers[0]!.animations).toHaveLength(2);
  });

  test("layer.uses 缺省默认为 []", () => {
    const layer = makeTextLayer();
    delete layer.uses;
    const vir = parseVir(makeVir({
      scenes: [{
        id: "scene_intro", name: "intro", start: 0, duration: 4,
        layers: [layer as unknown as VirLayer], beats: [],
      }],
    }));
    expect(vir.scenes[0]!.layers[0]!.uses).toEqual([]);
  });

  test("params 允许自定义数值键", () => {
    const layer = makeTextLayer({
      animations: [{ type: "enter", effect: "fade", duration: 1, delay: 0, easing: "spring", params: { stiffness: 120, damping: 8, custom: 3 } }],
    });
    const vir = parseVir(makeVir({
      scenes: [{ id: "scene_intro", name: "intro", start: 0, duration: 4, layers: [layer as unknown as VirLayer], beats: [] }],
    }));
    expect(vir.scenes[0]!.layers[0]!.animations[0]!.params).toEqual({ stiffness: 120, damping: 8, custom: 3 });
  });

  test("group 图层递归解析 children", () => {
    const group = {
      id: "layer_intro_g", name: "g", type: "group", in: 0, out: 4,
      transform: { anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 },
      animations: [], uses: [],
      children: [makeTextLayer({ id: "layer_intro_inner", name: "inner" })],
    };
    const vir = parseVir(makeVir({
      scenes: [{ id: "scene_intro", name: "intro", start: 0, duration: 4, layers: [group as unknown as VirLayer], beats: [] }],
    }));
    const g = vir.scenes[0]!.layers[0]!;
    expect(g.type).toBe("group");
    expect(g.children).toHaveLength(1);
    expect(g.children![0]!.type).toBe("text");
  });

  test("VirLayerSchema 可独立解析图层", () => {
    const parsed = VirLayerSchema.parse(makeTextLayer());
    expect(parsed.name).toBe("title");
  });
});

describe("parseVir 非法样例（结构化错误）", () => {
  const expectVirError = (vir: unknown): void => {
    let caught: unknown;
    try { parseVir(vir); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(VirParseError);
    const e = caught as VirParseError;
    expect(e.code).toBe("VIR_PARSE_ERROR");
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.message).toContain("Invalid VIR");
  };

  test("virVersion 错误", () => {
    expectVirError(makeVir({ virVersion: "2.0" }));
  });
  test("meta 字段缺失/类型错误", () => {
    expectVirError(makeVir({ meta: { title: "t", width: 1920, height: 1080, fps: 30, duration: 4, background: "#0a0a12" } }));
    expectVirError(makeVir({ meta: { title: "t", width: -1, height: 1080, fps: 30, duration: 4, background: "#0a0a12", seed: 1 } }));
  });
  test("未知顶层字段被 strict 拒绝", () => {
    expectVirError(makeVir({ extra: true }));
  });
  test("图层 type 非法", () => {
    expectVirError(makeVir({
      scenes: [{ id: "s", name: "s", start: 0, duration: 1, layers: [makeTextLayer({ type: "video" }) as unknown as VirLayer], beats: [] }],
    }));
  });
  test("text 图层缺少 text 属性", () => {
    const layer = makeTextLayer();
    delete layer.text;
    expectVirError(makeVir({
      scenes: [{ id: "s", name: "s", start: 0, duration: 1, layers: [layer as unknown as VirLayer], beats: [] }],
    }));
  });
  test("opacity 超出 [0,1]", () => {
    expectVirError(makeVir({
      scenes: [{
        id: "s", name: "s", start: 0, duration: 1,
        layers: [makeTextLayer({ transform: { anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1.5 } }) as unknown as VirLayer],
        beats: [],
      }],
    }));
  });
  test("transition between 不是二元组", () => {
    expectVirError(makeVir({ transitions: [{ type: "cut", duration: 0, between: ["a"] }] }));
  });
  test("camera 枚举非法", () => {
    expectVirError(makeVir({
      scenes: [{ id: "s", name: "s", start: 0, duration: 1, camera: { type: "orbit", params: {} }, layers: [], beats: [] }],
    }));
  });
  test("非对象输入", () => {
    expectVirError("nope");
    expectVirError(42);
  });
});
