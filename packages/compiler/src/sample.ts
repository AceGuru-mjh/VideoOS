// 测试共享样例：两场景 + crossfade + audio + 全部图层类型（M2+ 渲染冒烟亦可复用）
import { defineVideo } from "@videoos/dsl";
import type { VideoDefinition } from "@videoos/dsl";

/** intro(4s, bg #101020, push-in) --crossfade 0.5s--> features(6s)；总时长 9.5s */
export function buildSampleDefinition(): VideoDefinition {
  return defineVideo({ title: "VideoOS Launch", seed: 42 }, (v) => {
    v.scene("intro", { duration: 4, background: "#101020" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "主标题入场" });
      s.beat("logo-reveal", { at: 1.5 });
      s.rect("glow", { width: 600, height: 600, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: "50%", y: "40%" } });
      s.text("title", "VideoOS", {
        size: 140, weight: 800, at: { x: "50%", y: "40%" },
        enter: { effect: "blur-up", duration: 0.8, params: { distance: 40, blur: 12 } },
      });
      s.text("subtitle", "Programmable Video Runtime", {
        size: 42, color: "#8b8ba7", at: { x: "50%", y: "52%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });
      s.camera("push-in", { from: 1.0, to: 1.08 });
    });
    v.scene("features", { duration: 6 }, (s) => {
      s.ellipse("dot", { width: 200, height: 200, fill: "#22d3ee", at: { x: "30%", y: "50%" }, enter: { effect: "scale-pop", duration: 0.5 } });
      s.image("logo", "assets/images/logo.png", { width: 256, height: 256, at: { x: "70%", y: "50%" } });
      s.text("typed", "Hello VideoOS", { size: 48, font: "Inter", at: { x: "50%", y: "80%" }, enter: { effect: "typewriter", duration: 1.2 } });
      s.text("outro", "bye", { size: 32, in: 5.0, out: 6.0, exit: { effect: "fade", duration: 0.5 } });
    });
    v.transition("crossfade", { duration: 0.5, between: ["intro", "features"] });
    v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.8, fadeIn: 1, fadeOut: 2 });
  });
}
