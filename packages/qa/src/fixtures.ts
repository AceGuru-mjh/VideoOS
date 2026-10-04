// 测试共享 fixture：小型确定性视频定义（小画布保证像素断言快速；无 image/audio 资产 → 零子进程解码成本）
import { defineVideo } from "@videoos/dsl";
import type { VideoDefinition } from "@videoos/dsl";

/** 基础样例：1 场景 "hello"（1s@30fps，640×360，#101020）= rect 面板 + 静态文本 "Hello VideoOS"（无动画 → 全帧恒定） */
export function basicDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Basic", width: 640, height: 360, fps: 30, background: "#101020" }, (v) => {
    v.scene("hello", { duration: 1 }, (s) => {
      s.beat("show", { at: 0 });
      s.rect("panel", { width: 320, height: 180, fill: "#334155", at: { x: "50%", y: "50%" } });
      s.text("greeting", "Hello VideoOS", { size: 48, at: { x: "50%", y: "40%" } });
    });
  });
}

/** typewriter 样例：文本 "Hello VideoOS"（13 字符）1s 打字机入场（easeOutCubic）→ 早期帧仅部分字符可见 */
export function typewriterDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Typewriter", width: 320, height: 180, fps: 30, background: "#101020" }, (v) => {
    v.scene("typed", { duration: 1 }, (s) => {
      s.beat("typing", { at: 0 });
      s.text("typed", "Hello VideoOS", {
        size: 24, at: { x: "50%", y: "50%" },
        enter: { effect: "typewriter", duration: 1 },
      });
    });
  });
}

/** 纯黑样例：场景 "empty"（#000000、无图层）→ toBeBlack/toBeBlank 均成立 */
export function blackDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Black", width: 320, height: 180, fps: 30, background: "#000000" }, (v) => {
    v.scene("empty", { duration: 1, background: "#000000" }, (s) => {
      s.beat("start", { at: 0 });
    });
  });
}

/** 内容样例：黑底 + 近满幅白矩形 → not.toBeBlack / not.toBeBlank 成立 */
export function contentDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Content", width: 320, height: 180, fps: 30, background: "#000000" }, (v) => {
    v.scene("filled", { duration: 1, background: "#000000" }, (s) => {
      s.rect("panel", { width: 300, height: 160, fill: "#ffffff", at: { x: "50%", y: "50%" } });
    });
  });
}

/** 双场景样例（cut）：red(0.5s) → blue(0.5s)，rect 同位不同色 → 跨场景帧低相似、同场景帧全等 */
export function twoSceneDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Two Scenes", width: 320, height: 180, fps: 30, background: "#000000" }, (v) => {
    v.scene("red", { duration: 0.5, background: "#000000" }, (s) => {
      s.rect("block", { width: 300, height: 160, fill: "#ff0000", at: { x: "50%", y: "50%" } });
    });
    v.scene("blue", { duration: 0.5, background: "#000000" }, (s) => {
      s.rect("block", { width: 300, height: 160, fill: "#0000ff", at: { x: "50%", y: "50%" } });
    });
  });
}

/** 文本溢出样例：crowded（maxWidth=100 显然溢出）/ wide-default（超出默认画布-32 上限）/ spacious（正常） */
export function overflowDefinition(): VideoDefinition {
  return defineVideo({ title: "QA Overflow", width: 640, height: 360, fps: 30, background: "#101020" }, (v) => {
    v.scene("crowded", { duration: 1 }, (s) => {
      s.text("big", "Wide Overflow Text", { size: 80, maxWidth: 100, at: { x: "50%", y: "50%" } });
    });
    v.scene("wide-default", { duration: 1 }, (s) => {
      s.text("wide", "Wide Overflow Text", { size: 80, at: { x: "50%", y: "50%" } });
    });
    v.scene("spacious", { duration: 1 }, (s) => {
      s.text("ok", "Fits Fine", { size: 24, at: { x: "50%", y: "50%" } });
    });
  });
}
