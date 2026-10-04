// 语义索引测试：frameOf/timeOf/sceneAt/layer/beatFrames 与错误语义
import { describe, expect, test } from "bun:test";
import type { Vir } from "./types";
import { buildSemanticIndex, SemanticError } from "./semantic";

function makeVir(): Vir {
  return {
    virVersion: "1.0",
    meta: { title: "t", width: 1920, height: 1080, fps: 30, duration: 5, background: "#0a0a12", seed: 42 },
    scenes: [
      {
        id: "scene_intro", name: "intro", start: 0, duration: 4,
        layers: [
          { id: "layer_intro_title", name: "title", type: "text", in: 0, out: 4, transform: { anchor: { x: 0.5, y: 0.5 }, position: { x: "50%", y: "50%" }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }, animations: [], uses: [], text: { content: "A", font: "Inter", size: 64, weight: 400, color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.2 } },
        ],
        beats: [{ id: "beat_intro_b1", name: "b1", at: 0.2 }, { id: "beat_intro_b2", name: "b2", at: 1.5 }],
      },
      {
        id: "scene_next", name: "next", start: 3.5, duration: 1.5,
        layers: [
          { id: "layer_next_title", name: "title", type: "rect", in: 0, out: 1.5, transform: { anchor: { x: 0.5, y: 0.5 }, position: { x: 100, y: 100 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }, animations: [], uses: [], rect: { width: 10, height: 10, fill: "#ff0000" } },
        ],
        beats: [],
      },
    ],
    transitions: [{ type: "crossfade", duration: 0.5, between: ["intro", "next"] }],
    audio: [],
    assets: [],
    graphs: { temporal: { nodes: [], edges: [] }, spatial: { roots: {} }, dependency: { nodes: [], edges: [] } },
  };
}

describe("buildSemanticIndex", () => {
  const vir = makeVir();
  const index = buildSemanticIndex(vir);

  test("场景信息与帧边界", () => {
    expect(index.scenes).toHaveLength(2);
    const intro = index.scenes[0]!;
    expect(intro.frameStart).toBe(0);
    expect(intro.frameEnd).toBe(120);
    expect(intro.layerIds).toEqual(["layer_intro_title"]);
    const next = index.scenes[1]!;
    expect(next.frameStart).toBe(105); // 3.5s * 30
    expect(next.frameEnd).toBe(150);
  });

  test("总量", () => {
    expect(index.totalDuration).toBe(5);
    expect(index.totalFrames).toBe(150);
  });

  test("frameOf：场景 / beat / 偏移", () => {
    expect(index.frameOf("intro")).toBe(0);
    expect(index.frameOf("intro", "b1")).toBe(6);          // 0.2s * 30
    expect(index.frameOf("intro", "b2")).toBe(45);         // 1.5s * 30
    expect(index.frameOf("next")).toBe(105);
    expect(index.frameOf("intro", "b1", 0.5)).toBe(21);    // (0.2+0.5)*30
    expect(index.frameOf("intro", undefined, 1)).toBe(30);
  });

  test("timeOf", () => {
    expect(index.timeOf("intro")).toBe(0);
    expect(index.timeOf("intro", "b2")).toBe(1.5);
    expect(index.timeOf("next")).toBe(3.5);
  });

  test("sceneAt：常规 / 重叠段取先启动场景 / 越界 null", () => {
    expect(index.sceneAt(0)!.name).toBe("intro");
    expect(index.sceneAt(3.9)!.name).toBe("intro");   // 重叠段 [3.5,4)：intro 仍为主场景
    expect(index.sceneAt(4.2)!.name).toBe("next");
    expect(index.sceneAt(5)).toBe(null);
    expect(index.sceneAt(-1)).toBe(null);
  });

  test("layer：按名称查找（含跨场景同名）", () => {
    expect(index.layer(vir, "intro", "title")!.id).toBe("layer_intro_title");
    expect(index.layer(vir, "next", "title")!.id).toBe("layer_next_title");
    expect(index.layer(vir, "intro", "nope")).toBeUndefined();
    expect(index.layer(vir, "nope", "title")).toBeUndefined();
  });

  test("beatFrames", () => {
    expect(index.beatFrames("intro")).toEqual([
      { name: "b1", frame: 6 },
      { name: "b2", frame: 45 },
    ]);
  });

  test("找不到时抛 SEMANTIC_NOT_FOUND", () => {
    expect(() => index.frameOf("nope")).toThrow(SemanticError);
    try { index.frameOf("nope"); } catch (err) {
      expect((err as SemanticError).code).toBe("SEMANTIC_NOT_FOUND");
    }
    expect(() => index.frameOf("intro", "nope")).toThrow(SemanticError);
    expect(() => index.timeOf("nope")).toThrow(SemanticError);
    expect(() => index.beatFrames("nope")).toThrow(SemanticError);
  });
});
