// 源码锚点编辑（applySceneModify / applyLayerModify / applyAudioSet）纯函数测试：
// 正常替换 / 插入 / 追加选项对象 / 注释与转义 / 深度 0 保护 / PATTERN_NOT_FOUND 边界
import { describe, expect, it } from "bun:test";
import { applyAudioSet, applyLayerModify, applySceneModify } from "./tools-scene";

const SRC = `import { defineVideo } from "@videoos/dsl";

export default defineVideo(
  { title: "t", width: 640, height: 360, fps: 12, background: "#101020", seed: 7 },
  (v) => {
    v.scene("intro", { duration: 1, background: "#101020" }, (s) => {
      s.beat("title", { at: 0.1 });
      s.text("greeting", "Hello", { size: 64, color: "#ffffff", enter: { effect: "fade", duration: 0.3 } });
      s.rect("bar", { width: 100, height: 10, fill: "#ff0000" });
      s.ellipse("dot", { width: 20, height: 20, fill: "#00ff00" });
    });
    v.scene("outro", { duration: 2 }, (s) => {
      s.text("bye", "Bye", { size: 48 });
    });
    v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.8, fadeIn: 1 });
  },
);
`;

function edit(source: string, args: Parameters<typeof applySceneModify>[1]): string {
  const outcome = applySceneModify(source, args);
  if (!outcome.ok) throw new Error(`unexpected failure: ${outcome.reason}`);
  return outcome.source as string;
}

describe("applySceneModify", () => {
  it("replace_text：换内容字符串（含转义）", () => {
    const next = edit(SRC, { scene: "intro", operation: "replace_text", layer: "greeting", value: 'He said "hi"\\n' });
    expect(next).toContain('"greeting", "He said \\"hi\\"\\\\n"');
    expect(next).toContain('s.text("bye", "Bye"'); // 其它场景不动
  });

  it("replace_text 只改目标场景的同名图层（outro 的 bye 不受影响）", () => {
    const next = edit(SRC, { scene: "outro", operation: "replace_text", layer: "bye", value: "See you" });
    expect(next).toContain('"bye", "See you"');
    expect(next).toContain('"greeting", "Hello"');
  });

  it("set_color：text 图层改 color；rect 改 fill；ellipse 改 fill", () => {
    const t = edit(SRC, { scene: "intro", operation: "set_color", layer: "greeting", value: "#ffcc00" });
    expect(t).toContain('color: "#ffcc00"');
    const r = edit(SRC, { scene: "intro", operation: "set_color", layer: "bar", value: "#00ccff" });
    expect(r).toContain('fill: "#00ccff"');
    const e = edit(SRC, { scene: "intro", operation: "set_color", layer: "dot", value: "#123456" });
    expect(e).toContain('fill: "#123456"');
  });

  it("set_color 无 layer：改场景 background（已有值替换）", () => {
    const next = edit(SRC, { scene: "intro", operation: "set_color", value: "#abcdef" });
    expect(next).toContain('{ duration: 1, background: "#abcdef" }');
    expect(next).toContain('fill: "#ff0000"'); // 图层不动
  });

  it("set_color 无 layer 且场景无 background：插入", () => {
    const next = edit(SRC, { scene: "outro", operation: "set_color", value: "#0f0f0f" });
    expect(next).toContain('{ background: "#0f0f0f", duration: 2 }');
  });

  it("set_duration：替换场景时长（不动 enter.duration）", () => {
    const next = edit(SRC, { scene: "intro", operation: "set_duration", value: 2.5 });
    expect(next).toContain('v.scene("intro", { duration: 2.5,');
    expect(next).toContain("enter: { effect: \"fade\", duration: 0.3 }"); // 图层动画时长不受影响
  });

  it("set_animation：改图层 enter.effect", () => {
    const next = edit(SRC, { scene: "intro", operation: "set_animation", layer: "greeting", value: "slide-up" });
    expect(next).toContain('enter: { effect: "slide-up", duration: 0.3 }');
  });

  it("选项缺失时插入属性（bye 无 color → 在选项 { 后插入）", () => {
    const inserted = edit(SRC, { scene: "outro", operation: "set_color", layer: "bye", value: "#eeeeee" });
    expect(inserted).toContain('{ color: "#eeeeee", size: 48 }');
  });

  it("注释掉的调用不是有效锚点", () => {
    const withComment = SRC.replace(
      'v.scene("intro"',
      '// v.scene("intro", { duration: 99 }, (s) => { s.text("greeting", "FAKE", {}); });\n    v.scene("intro"',
    );
    const next = edit(withComment, { scene: "intro", operation: "set_duration", value: 3 });
    expect(next).toContain('v.scene("intro", { duration: 3,'); // 活跃调用被编辑
    expect(next).toContain("duration: 99");                       // 注释保持原样
    expect(next).toContain('"FAKE"');                             // 注释内容未被改写
  });

  it("深度 0 保护：嵌套对象内同名属性不误中", () => {
    const nested = `v.scene("s", { duration: 1 }, (s) => {
  s.text("t", "X", { size: 10, enter: { effect: "fade", duration: 9 } });
});`;
    const next = applyLayerModify(nested, { scene: "s", layer: "t", property: "opacity", value: 0.5 });
    if (!next.ok) throw new Error(next.reason);
    // opacity 不存在（enter 内也没有）→ 插入顶层；enter.duration 原样
    expect(next.source).toContain("{ opacity: 0.5, size: 10, enter:");
    expect(next.source).toContain("duration: 9 }");

    // 嵌套含同名属性：enter 内的 opacity 不是图层的 opacity
    const nested2 = `v.scene("s", { duration: 1 }, (s) => {
  s.text("t", "X", { enter: { effect: "fade", opacity: 0.2 } });
});`;
    const next2 = applyLayerModify(nested2, { scene: "s", layer: "t", property: "opacity", value: 0.9 });
    if (!next2.ok) throw new Error(next2.reason);
    expect(next2.source).toContain("opacity: 0.2"); // 嵌套原样
    expect(next2.source).toContain("{ opacity: 0.9, enter:"); // 顶层插入
  });

  it("PATTERN_NOT_FOUND / INVALID_* 边界", () => {
    const ghost = applySceneModify(SRC, { scene: "ghost", operation: "set_duration", value: 2 });
    expect(ghost.ok).toBe(false);
    expect(ghost.reason).toMatch(/^PATTERN_NOT_FOUND: v\.scene\("ghost"/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "replace_text", layer: "ghost", value: "x" }).reason).toMatch(/PATTERN_NOT_FOUND.*图层/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "replace_text", layer: "bar", value: "x" }).reason).toMatch(/仅适用于 text 图层/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_duration", layer: "bar", value: 2 }).reason).toMatch(/不接受 layer/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_duration", value: -1 }).reason).toMatch(/INVALID_VALUE/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_color", layer: "greeting", value: "red" }).reason).toMatch(/INVALID_VALUE.*#/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_animation", layer: "greeting", value: "warp-speed" }).reason).toMatch(/INVALID_VALUE.*effect/);
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_animation", layer: "bye", value: "fade" }).reason).toMatch(/PATTERN_NOT_FOUND/); // bye 在 outro 不在 intro
    expect(applySceneModify(SRC, { scene: "intro", operation: "set_color", layer: undefined, value: "#fff" }).ok).toBe(true);
    expect(applySceneModify(SRC, { scene: "intro", operation: "replace_text", value: "x" }).reason).toMatch(/INVALID_ARGS.*layer/);
    // set_animation：图层无 enter → PATTERN_NOT_FOUND
    expect(applySceneModify(SRC, { scene: "outro", operation: "set_animation", layer: "bye", value: "fade" }).reason).toMatch(/PATTERN_NOT_FOUND.*enter/);
  });

  it("模板字符串内容 / 变量内容 → PATTERN_NOT_FOUND（保守拒绝）", () => {
    const withTemplate = SRC.replace('"Hello"', "`Hello ${name}`");
    expect(applySceneModify(withTemplate, { scene: "intro", operation: "replace_text", layer: "greeting", value: "x" }).reason).toMatch(/PATTERN_NOT_FOUND.*内容字符串/);
  });
});

describe("applyLayerModify", () => {
  it("text/color/size/opacity 四类属性", () => {
    const t = applyLayerModify(SRC, { scene: "intro", layer: "greeting", property: "text", value: "VideoOS" });
    expect(t.ok && t.source).toContain('"VideoOS"');
    const c = applyLayerModify(SRC, { scene: "intro", layer: "greeting", property: "color", value: "#ff0000" });
    expect(c.ok && c.source).toContain('color: "#ff0000"');
    const s = applyLayerModify(SRC, { scene: "intro", layer: "greeting", property: "size", value: 96 });
    expect(s.ok && s.source).toContain("size: 96");
    const o = applyLayerModify(SRC, { scene: "outro", layer: "bye", property: "opacity", value: 0.25 });
    expect(o.ok && o.source).toContain("opacity: 0.25");
  });

  it("size 对非 text 图层 → INVALID_ARGS；数值校验", () => {
    expect(applyLayerModify(SRC, { scene: "intro", layer: "bar", property: "size", value: 10 }).reason).toMatch(/仅适用于 text/);
    expect(applyLayerModify(SRC, { scene: "intro", layer: "greeting", property: "size", value: 0 }).reason).toMatch(/INVALID_VALUE/);
    expect(applyLayerModify(SRC, { scene: "intro", layer: "greeting", property: "opacity", value: 1.5 }).reason).toMatch(/INVALID_VALUE/);
  });
});

describe("applyAudioSet", () => {
  it("volume 替换 + fadeIn 已存在替换", () => {
    const v = applyAudioSet(SRC, { clip: "bgm", volume: 0.5 });
    expect(v.ok && v.source).toContain("volume: 0.5");
    expect(v.ok && v.source).toContain("fadeIn: 1");
    const f = applyAudioSet(SRC, { clip: "bgm", fadeIn: 2 });
    expect(f.ok && f.source).toContain("fadeIn: 2");
  });

  it("同时设置两个属性（顺序应用，每次重新定位）", () => {
    const both = applyAudioSet(SRC, { clip: "bgm", volume: 0.3, fadeIn: 0.5 });
    expect(both.ok).toBe(true);
    expect(both.source).toContain("volume: 0.3");
    expect(both.source).toContain("fadeIn: 0.5");
    expect(both.edits).toHaveLength(2);
  });

  it("无选项对象的 audio 调用 → 追加选项参数", () => {
    const noOpts = SRC.replace(', { volume: 0.8, fadeIn: 1 }', "");
    const outcome = applyAudioSet(noOpts, { clip: "bgm", volume: 0.6 });
    expect(outcome.ok).toBe(true);
    expect(outcome.source).toContain('v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.6 })');
  });

  it("未提供任何属性 / 未知 clip / 非法值", () => {
    expect(applyAudioSet(SRC, { clip: "bgm" }).reason).toMatch(/INVALID_ARGS/);
    expect(applyAudioSet(SRC, { clip: "ghost", volume: 1 }).reason).toMatch(/PATTERN_NOT_FOUND.*v\.audio/);
    expect(applyAudioSet(SRC, { clip: "bgm", volume: -1 }).reason).toMatch(/INVALID_VALUE/);
  });
});
