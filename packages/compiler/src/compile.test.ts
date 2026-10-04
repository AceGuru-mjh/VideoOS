// compiler 测试：VIR 结构/语义索引/FramePlan 求值/过渡/动画效果/诊断/确定性
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineVideo } from "@videoos/dsl";
import type { RawAnimation, RawLayer, RawScene, RawTransform, VideoDefinition } from "@videoos/dsl";
import { parseVir } from "@videoos/vir";
import { compile } from "./compile";
import { buildSampleDefinition } from "./sample";

// ---------- 手工构造工具（绕过 DSL 校验以测试编译器诊断与 VIR 级动画） ----------

const STD_TRANSFORM: RawTransform = {
  anchor: { x: 0.5, y: 0.5 },
  position: { x: "50%", y: "50%" },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
};

function mkText(id: string, name: string, content: string, animations: RawAnimation[], inT = 0, outT = 2): RawLayer {
  return {
    id, name, type: "text", in: inT, out: outT,
    transform: STD_TRANSFORM,
    animations,
    text: { content, font: "sans-serif", size: 100, weight: 400, color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.2 },
  };
}

function handMadeDef(scenes: RawScene[], transitions: VideoDefinition["program"]["transitions"] = []): VideoDefinition {
  return {
    kind: "videoos-definition",
    version: "1.0",
    program: {
      meta: { title: "hand", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 1 },
      scenes,
      transitions,
      audio: [],
    },
  };
}

// ---------- 样例编译：VIR 结构 ----------

describe("compile：样例 VIR 结构", () => {
  const result = compile(buildSampleDefinition());
  const { vir } = result;

  test("meta 默认值与 duration 派生（4s - 0.5 重叠 + 6s = 9.5s）", () => {
    expect(vir.virVersion).toBe("1.0");
    expect(vir.meta).toEqual({
      title: "VideoOS Launch", width: 1920, height: 1080, fps: 30,
      duration: 9.5, background: "#0a0a12", seed: 42,
    });
  });

  test("场景 start：crossfade 使后场景提前重叠", () => {
    expect(vir.scenes.map((s) => s.start)).toEqual([0, 3.5]);
    expect(vir.scenes[1]!.name).toBe("features");
  });

  test("assets 注册表（字体家族/image src/audio src，确定性 id 与顺序）", () => {
    expect(vir.assets).toEqual([
      { id: "asset_font_sans_serif", type: "font", src: "font:sans-serif" },
      { id: "asset_image_assets_images_logo_png", type: "image", src: "assets/images/logo.png" },
      { id: "asset_font_inter", type: "font", src: "font:Inter" },
      { id: "asset_audio_assets_audio_launch_mp3", type: "audio", src: "assets/audio/launch.mp3" },
    ]);
  });

  test("layers.uses 正确推导", () => {
    const title = vir.scenes[0]!.layers.find((l) => l.name === "title")!;
    expect(title.uses).toEqual(["asset_font_sans_serif"]);
    const logo = vir.scenes[1]!.layers.find((l) => l.name === "logo")!;
    expect(logo.uses).toEqual(["asset_image_assets_images_logo_png"]);
    const glow = vir.scenes[0]!.layers.find((l) => l.name === "glow")!;
    expect(glow.uses).toEqual([]);
  });

  test("graphs 三图", () => {
    expect(vir.graphs.temporal.nodes).toHaveLength(2);
    expect(vir.graphs.temporal.edges).toEqual([{ from: "scene_intro", to: "scene_features" }]);
    expect(vir.graphs.temporal.nodes[0]).toEqual({ id: "scene_intro", kind: "scene", start: 0, end: 4 });
    expect(vir.graphs.spatial.roots).toEqual({
      scene_intro: ["layer_intro_glow", "layer_intro_title", "layer_intro_subtitle"],
      scene_features: ["layer_features_dot", "layer_features_logo", "layer_features_typed", "layer_features_outro"],
    });
    expect(vir.graphs.dependency.nodes).toHaveLength(2 + 7 + 4); // scene + layer + asset
    expect(vir.graphs.dependency.edges).toHaveLength(7 + 5);     // scene→layer 7 + layer→asset 5
    expect(vir.graphs.dependency.edges).toContainEqual({ from: "layer_intro_title", to: "asset_font_sans_serif" });
    expect(vir.graphs.dependency.edges).toContainEqual({ from: "scene_features", to: "layer_features_logo" });
  });

  test("transitions / audio 原样保留", () => {
    expect(vir.transitions).toEqual([{ type: "crossfade", duration: 0.5, between: ["intro", "features"] }]);
    expect(vir.audio[0]!.id).toBe("audio_bgm");
    expect(vir.audio[0]!.volume).toBe(0.8);
  });

  test("干净样例无诊断", () => {
    expect(result.diagnostics).toEqual([]);
  });

  test("产物通过 parseVir（round-trip）且确定性（字节级一致）", () => {
    expect(() => parseVir(vir)).not.toThrow();
    const again = compile(buildSampleDefinition());
    expect(JSON.stringify(again.vir)).toBe(JSON.stringify(vir));
  });
});

// ---------- 语义索引（经编译产出） ----------

describe("compile：语义索引", () => {
  const { semantic } = compile(buildSampleDefinition());

  test("frameOf / timeOf", () => {
    expect(semantic.frameOf("intro")).toBe(0);
    expect(semantic.frameOf("intro", "title-enter")).toBe(6);
    expect(semantic.frameOf("intro", "logo-reveal")).toBe(45);
    expect(semantic.frameOf("features", undefined, 0.5)).toBe(105 + 15);
    expect(semantic.timeOf("features")).toBe(3.5);
    expect(semantic.timeOf("intro", "logo-reveal")).toBe(1.5);
  });

  test("sceneAt（重叠段取先启动场景）与总量", () => {
    expect(semantic.sceneAt(0)!.name).toBe("intro");
    expect(semantic.sceneAt(3.9)!.name).toBe("intro");
    expect(semantic.sceneAt(4.5)!.name).toBe("features");
    expect(semantic.sceneAt(9.5)).toBe(null);
    expect(semantic.totalFrames).toBe(285);
    expect(semantic.totalDuration).toBe(9.5);
  });

  test("layer / beatFrames", () => {
    const { vir } = compile(buildSampleDefinition());
    expect(semantic.layer(vir, "features", "typed")!.id).toBe("layer_features_typed");
    expect(semantic.beatFrames("intro")).toEqual([
      { name: "title-enter", frame: 6 },
      { name: "logo-reveal", frame: 45 },
    ]);
  });
});

// ---------- FramePlan：intro 段 ----------

describe("compile：framePlan（intro 段）", () => {
  const { framePlan } = compile(buildSampleDefinition());

  test("frame 0：窗口内图层全部生成命令，enter 起点为隐藏态", () => {
    const plan = framePlan(0);
    expect(plan.frame).toBe(0);
    expect(plan.time).toBe(0);
    expect(plan.sceneId).toBe("scene_intro");
    expect(plan.background).toBe("#101020");
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.camera.scale).toBe(1.0);
    expect(plan.commands.map((c) => c.layerId)).toEqual(["layer_intro_glow", "layer_intro_title", "layer_intro_subtitle"]);

    const glow = plan.commands[0]!;
    expect(glow.op).toBe("draw-rect");
    expect(glow).toMatchObject({ x: 660, y: 132, width: 600, height: 600, fill: "#6d28d9", opacity: 0.25, radius: 0, blur: 120, rotation: 0 });

    const title = plan.commands[1]!;
    expect(title).toMatchObject({ op: "draw-text", x: 960, y: 432 + 40, content: "VideoOS", size: 140, weight: 800, opacity: 0, blur: 12 });

    const subtitle = plan.commands[2]!;
    expect(subtitle).toMatchObject({ op: "draw-text", opacity: 0 }); // delay 0.4 期间
  });

  test("frame 30（t=1.0）：入场完成，相机 push-in 进行中", () => {
    const plan = framePlan(30);
    expect(plan.time).toBe(1.0);
    expect(plan.camera.scale).toBeCloseTo(1 + 0.08 * (1 - Math.pow(0.75, 3)), 10); // easeOutCubic(0.25)
    const title = plan.commands[1]!;
    expect(title).toMatchObject({ opacity: 1, blur: 0, y: 432 });
    expect(plan.commands[2]!).toMatchObject({ opacity: 1 });
  });
});

// ---------- FramePlan：过渡重叠段 ----------

describe("compile：framePlan（crossfade 过渡段）", () => {
  const { framePlan } = compile(buildSampleDefinition());

  test("frame 108（t=3.6, progress 0.2）：主场景全量 + 后场景按 progress 渐入", () => {
    const plan = framePlan(108);
    expect(plan.sceneId).toBe("scene_intro");
    expect(plan.background).toBe("#101020");
    expect(plan.transition!.type).toBe("crossfade");
    expect(plan.transition!.progress).toBeCloseTo(0.2, 10); // (3.6-3.5)/0.5

    // intro 3 条 + features 背景 1 条 + features 3 条（outro 窗口外）
    expect(plan.commands.map((c) => c.layerId)).toEqual([
      "layer_intro_glow", "layer_intro_title", "layer_intro_subtitle",
      "scene_features:bg",
      "layer_features_dot", "layer_features_logo", "layer_features_typed",
    ]);

    // 主场景 opacity 不衰减（crossfade）
    expect(plan.commands[0]!).toMatchObject({ opacity: 0.25 });
    // 后场景背景整幅渐入
    const bg = plan.commands[3]!;
    expect(bg).toMatchObject({ op: "draw-rect", layerId: "scene_features:bg", x: 0, y: 0, width: 1920, height: 1080, fill: "#0a0a12" });
    expect((bg as { opacity: number }).opacity).toBeCloseTo(0.2, 10);
    // dot：scale-pop(p=0.2, e=0.488) × 0.2
    const dot = plan.commands[4]!;
    expect(dot).toMatchObject({ op: "draw-ellipse", cx: 576, cy: 540 });
    expect((dot as { rx: number }).rx).toBeCloseTo(79.52, 6);
    expect((dot as { opacity: number }).opacity).toBeCloseTo(0.976 * 0.2, 8);
    // logo 无动画 → opacity = progress
    expect(plan.commands[5]!).toMatchObject({ width: 256, height: 256 });
    expect((plan.commands[5]! as { opacity: number }).opacity).toBeCloseTo(0.2, 10);
    // typewriter：e=easeOutCubic(1/12)≈0.2297 → ceil(13×e)=3 → "Hel"（typewriter 不改 opacity）
    const typed = plan.commands[6]!;
    expect(typed).toMatchObject({ content: "Hel", visibleChars: 3 });
    expect((typed as { opacity: number }).opacity).toBeCloseTo(0.2, 10);
  });

  test("frame 120（t=4.0）：intro 结束，features 成为主场景", () => {
    const plan = framePlan(120);
    expect(plan.sceneId).toBe("scene_features");
    expect(plan.background).toBe("#0a0a12");
    expect(plan.transition).toBeUndefined();
    expect(plan.camera.scale).toBe(1); // features 无相机
    // outro in=5.0（local 0.5）窗口外
    expect(plan.commands.map((c) => c.layerId)).toEqual(["layer_features_dot", "layer_features_logo", "layer_features_typed"]);
    const typed = plan.commands[2]!;
    expect(typed).toMatchObject({ content: "Hello Video", visibleChars: 11 }); // ceil(13×easeOutCubic(5/12))
  });

  test("typewriter 中段：frame 123 → 12 字符", () => {
    const plan = framePlan(123);
    const typed = plan.commands[2]!;
    expect(typed).toMatchObject({ content: "Hello VideoO", visibleChars: 12 });
  });

  test("末帧 frame 282：outro exit 进行中；frame 285 为空计划", () => {
    const plan = framePlan(282);
    expect(plan.sceneId).toBe("scene_features");
    expect(plan.commands.map((c) => c.layerId)).toEqual([
      "layer_features_dot", "layer_features_logo", "layer_features_typed", "layer_features_outro",
    ]);
    const outro = plan.commands[3]!;
    expect(outro).toMatchObject({ content: "bye", size: 32 });
    // exit 窗口 [5.5, 6.0)：p=0.8 → e=easeOutCubic(1-0.8)=1-0.8³=0.488
    expect((outro as { opacity: number }).opacity).toBeCloseTo(1 - Math.pow(0.8, 3), 10);
    
    const end = framePlan(285);
    expect(end.sceneId).toBe(null);
    expect(end.background).toBe("#0a0a12");
    expect(end.commands).toEqual([]);
    expect(end.camera).toEqual({ scale: 1, translateX: 0, translateY: 0, rotation: 0 });
  });
});

// ---------- 过渡类型 ----------

describe("compile：fade-black / cut / 无过渡", () => {
  test("fade-black：前场景 ×(1-progress)，后场景 × progress", () => {
    const def = handMadeDef([
      { id: "scene_a", name: "a", duration: 2, layers: [mkText("layer_a_t", "t", "A", [])], beats: [] },
      { id: "scene_b", name: "b", duration: 2, layers: [mkText("layer_b_t", "t", "B", [])], beats: [] },
    ], [{ type: "fade-black", duration: 0.5, between: ["a", "b"] }]);
    const { framePlan, vir } = compile(def);
    expect(vir.scenes[1]!.start).toBe(1.5);
    const plan = framePlan(48); // t=1.6, progress 0.2
    expect(plan.transition!.type).toBe("fade-black");
    expect(plan.transition!.progress).toBeCloseTo(0.2, 10);
    expect(plan.sceneId).toBe("scene_a");
    expect(plan.commands.map((c) => c.layerId)).toEqual(["layer_a_t", "scene_b:bg", "layer_b_t"]);
    expect((plan.commands[0] as { opacity: number }).opacity).toBeCloseTo(0.8, 10);
    expect((plan.commands[1] as { opacity: number }).opacity).toBeCloseTo(0.2, 10);
    expect((plan.commands[2] as { opacity: number }).opacity).toBeCloseTo(0.2, 10);
  });

  test("cut：不重叠", () => {
    const def = handMadeDef([
      { id: "scene_a", name: "a", duration: 1, layers: [mkText("layer_a_t", "t", "A", [], 0, 1)], beats: [] },
      { id: "scene_b", name: "b", duration: 1, layers: [mkText("layer_b_t", "t", "B", [], 0, 1)], beats: [] },
    ], [{ type: "cut", duration: 0.5, between: ["a", "b"] }]);
    const { framePlan, vir } = compile(def);
    expect(vir.meta.duration).toBe(2);
    expect(vir.scenes[1]!.start).toBe(1);
    expect(framePlan(29).sceneId).toBe("scene_a");
    const plan = framePlan(30); // t=1.0：a 的 [0,1) 已结束
    expect(plan.sceneId).toBe("scene_b");
    expect(plan.transition).toBeUndefined();
    expect(plan.commands).toHaveLength(1);
  });

  test("未声明过渡：等价 cut", () => {
    const def = handMadeDef([
      { id: "scene_a", name: "a", duration: 1, layers: [], beats: [] },
      { id: "scene_b", name: "b", duration: 1, layers: [], beats: [] },
    ]);
    const { vir } = compile(def);
    expect(vir.scenes[1]!.start).toBe(1);
    expect(vir.meta.duration).toBe(2);
  });
});

// ---------- 动画效果与相机（手工 VIR 级） ----------

describe("compile：动画效果求值", () => {
  test("slide-up：offsetY = (1-e)·distance", () => {
    const def = handMadeDef([{
      id: "scene_s", name: "s", duration: 2,
      layers: [mkText("layer_s_t", "t", "slide", [
        { type: "enter", effect: "slide-up", duration: 1, delay: 0, easing: "linear", params: { distance: 100 } },
      ])],
      beats: [],
    }]);
    const { framePlan } = compile(def);
    const plan = framePlan(15); // t=0.5, e=0.5
    expect(plan.commands[0]!).toMatchObject({ op: "draw-text", x: 960, y: 590, opacity: 1 });
  });

  test("wipe：clip 按进度揭示（文本盒用启发式宽 chars×size×0.62）", () => {
    const def = handMadeDef([{
      id: "scene_s", name: "s", duration: 2,
      layers: [mkText("layer_s_t", "t", "wipe", [
        { type: "enter", effect: "wipe", duration: 1, delay: 0, easing: "linear" },
      ])],
      beats: [],
    }]);
    const { framePlan } = compile(def);
    const cmd = framePlan(15).commands[0]! as Extract<import("./frame-plan").FrameCommand, { op: "draw-text" }>;
    expect(cmd.clip).toEqual({ x: 960 - 124, y: 540 - 60, width: 124, height: 120 }); // 4×100×0.62=248
  });

  test("loop：opacity = 0.5 + 0.5·sin(2πt/period)", () => {
    const def = handMadeDef([{
      id: "scene_s", name: "s", duration: 2,
      layers: [mkText("layer_s_t", "t", "pulse", [
        { type: "loop", effect: "fade", duration: 0.5, delay: 0, easing: "linear", params: { period: 1 } },
      ])],
      beats: [],
    }]);
    const { framePlan } = compile(def);
    expect((framePlan(15).commands[0] as { opacity: number }).opacity).toBeCloseTo(0.5, 10); // sin(π)≈0
    expect((framePlan(8).commands[0] as { opacity: number }).opacity).toBeGreaterThan(0.9); // 接近波峰
  });

  test("exit 未开始时 e=1（完全可见）", () => {
    const def = handMadeDef([{
      id: "scene_s", name: "s", duration: 2,
      layers: [mkText("layer_s_t", "t", "x", [
        { type: "exit", effect: "fade", duration: 0.5, delay: 0, easing: "linear" },
      ], 0, 2)],
      beats: [],
    }]);
    const { framePlan } = compile(def);
    expect((framePlan(30).commands[0] as { opacity: number }).opacity).toBeCloseTo(1, 10); // exit 窗口 [1.5,2) 尚未开始
    // t=55/30≈1.833：p=(1.833-1.5)/0.5≈0.667 → e=linear(1-p)=1/3
    expect((framePlan(55).commands[0] as { opacity: number }).opacity).toBeCloseTo(1 / 3, 5);
  });

  test("相机 pan / pull-out", () => {
    const def = handMadeDef([
      { id: "scene_a", name: "a", duration: 2, camera: { type: "pan", params: { fromX: 0, toX: 100 } }, layers: [], beats: [] },
      { id: "scene_b", name: "b", duration: 2, camera: { type: "pull-out", params: { from: 1.1, to: 1.0 } }, layers: [], beats: [] },
    ]);
    const { framePlan } = compile(def);
    expect(framePlan(30).camera).toEqual({ scale: 1, translateX: 87.5, translateY: 0, rotation: 0 }); // e=0.875
    expect(framePlan(90).camera.scale).toBeCloseTo(1.0125, 10); // 1.1 + (1.0-1.1)×0.875
  });

  test("image 未指定尺寸 → 默认画布大小", () => {
    const def = handMadeDef([{
      id: "scene_s", name: "s", duration: 1,
      layers: [{
        id: "layer_s_img", name: "img", type: "image", src: "logo.png", in: 0, out: 1,
        transform: STD_TRANSFORM, animations: [],
        image: {},
      }],
      beats: [],
    }]);
    const { framePlan } = compile(def);
    expect(framePlan(0).commands[0]!).toMatchObject({ op: "draw-image", x: 0, y: 0, width: 1920, height: 1080, src: "logo.png" });
  });
});

// ---------- 诊断 ----------

describe("compile：诊断", () => {
  test("手工坏样例：错误/警告齐全但不抛错", () => {
    const stdText = { font: "sans-serif", size: 100, weight: 400, color: "#ffffff", align: "center" as const, letterSpacing: 0, lineHeight: 1.2 };
    const def: VideoDefinition = {
      kind: "videoos-definition",
      version: "1.0",
      program: {
        meta: { title: "broken", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 1 },
        scenes: [{
          id: "scene_a", name: "a", duration: 2,
          layers: [
            {
              id: "layer_a_x", name: "x", type: "text", in: 0.5, out: 0.4,
              transform: STD_TRANSFORM, animations: [],
              text: { ...stdText, content: "y".repeat(80), maxWidth: 300 },
            },
            {
              id: "layer_a_x", name: "x2", type: "text", in: 0, out: 2,
              transform: STD_TRANSFORM,
              animations: [{ type: "enter", effect: "nope", duration: 0.5, delay: 0, easing: "warp" }],
              text: { ...stdText, content: "ok" },
            },
          ],
          beats: [],
        }],
        transitions: [{ type: "crossfade", duration: 0.5, between: ["a", "ghost"] }],
        audio: [],
      },
    };
    const result = compile(def);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("INVALID_TIME_WINDOW");
    expect(codes).toContain("DUPLICATE_ID");
    expect(codes).toContain("OVERFLOW_RISK");
    expect(codes).toContain("UNKNOWN_EFFECT");
    expect(codes).toContain("UNKNOWN_EASING");
    expect(codes).toContain("TRANSITION_UNMATCHED");
    const overflow = result.diagnostics.find((d) => d.code === "OVERFLOW_RISK")!;
    expect(overflow.level).toBe("warning");
    expect(overflow.scene).toBe("a");
    expect(overflow.layer).toBe("x");
    const window = result.diagnostics.find((d) => d.code === "INVALID_TIME_WINDOW")!;
    expect(window.level).toBe("error");
  });

  test("assetRoot 指向不存在目录 → image/audio ASSET_MISSING（字体跳过）", () => {
    const result = compile(buildSampleDefinition(), { assetRoot: "/definitely/not/exist-videoos" });
    const missing = result.diagnostics.filter((d) => d.code === "ASSET_MISSING");
    expect(missing).toHaveLength(2);
    expect(missing.every((d) => d.level === "error")).toBe(true);
  });

  test("assetRoot 指向真实目录：存在文件通过，缺失报错", () => {
    const tmp = mkdtempSync(join(tmpdir(), "videoos-assets-"));
    try {
      writeFileSync(join(tmp, "logo.png"), "fake");
      const def = defineVideo({ title: "assets" }, (v) => {
        v.scene("s", { duration: 1 }, (s) => {
          s.image("img", "logo.png", { width: 10, height: 10 });
        });
        v.audio("au", "missing.mp3", {});
      });
      const result = compile(def, { assetRoot: tmp });
      const missing = result.diagnostics.filter((d) => d.code === "ASSET_MISSING");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.message).toContain("missing.mp3");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("非法定义/非法 program 抛 CompilerError", async () => {
    const { CompilerError } = await import("./errors");
    expect(() => compile({ kind: "other", version: "1.0", program: null } as unknown as VideoDefinition)).toThrow(CompilerError);
    expect(() => compile({ kind: "videoos-definition", version: "2.0", program: {} } as unknown as VideoDefinition)).toThrow(CompilerError);
    expect(() => compile({ kind: "videoos-definition", version: "1.0", program: { meta: {} } } as unknown as VideoDefinition)).toThrow(/Invalid video program/);
  });
});
