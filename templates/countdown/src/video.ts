// countdown — 5 秒倒计时（16:9，1920×1080，30fps，静音可看）：
// 数字 5→1 每 0.8s 向上翻滚一次（旧数字向上离场 + 新数字自下升入），锁定帧硬切到活动定版卡。
//
// 时间轴（cut 不重叠，两场景首尾相接）：
//   tick   [0.0s, 4.0s)  4.0s  数字 k 占窗口 [(5-k)×0.8, (6-k)×0.8)
//   lockup [4.0s, 5.0s)  1.0s  定版 0.2s 内落定 + 0.8s 全静止
//   总时长 5.0s = 150 帧
import { defineVideo } from "@videoos/dsl";

// 改这里换内容：活动名（≤ 12 字符）/ 日期时间（必须来自真实活动，禁编造）/ CTA
const EVENT = "SHIP CONF";
const DATE = "2026-06-06 · 18:00";
const CTA = "立即预约 · videoos.dev";
const ACCENT = "#22d3ee";

export default defineVideo(
  { title: "倒计时", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    // ------------------------------------------------ 一幕：数字翻滚
    v.scene("tick", { duration: 4, background: "#0a0a12" }, (s) => {
      // 帧零有墨：光晕无入场动画，数字翻滚全程托底
      s.ellipse("halo", { width: 900, height: 900, fill: ACCENT, opacity: 0.14, blur: 140, at: { x: "50%", y: "42%" } });

      // 翻滚机构（引擎语义）：exit slide-down = 向上离场（原路返回），enter slide-up = 自下升入
      // —— 一上一下组成整版向上滚动；切勿 exit slide-up + enter slide-up（同曲线完全重叠）
      for (let k = 5; k >= 1; k--) {
        const start = (5 - k) * 0.8; // 数字 5 → 0s，4 → 0.8s，…，1 → 3.2s；窗口 [start, start+0.8)
        s.beat(`tick-${k}`, { at: start, description: `数字 ${k} 落地` });
        // 每窗一次脉冲光环：可读的心跳节拍
        s.ellipse(`pulse-${k}`, {
          width: 560, height: 560, fill: ACCENT, opacity: 0.15,
          at: { x: "50%", y: "42%" }, in: start, out: start + 0.8,
          enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutCubic" },
        });
        s.text(`digit-${k}`, String(k), {
          size: 360, weight: 800, color: "#f8fafc",
          at: { x: "50%", y: "42%" }, in: start, out: start + 0.8,
          enter: { effect: "slide-up", duration: 0.25, easing: "easeOutCubic", params: { distance: 220 } },
          exit: { effect: "slide-down", duration: 0.25, easing: "easeInQuad" }, // 向上离场
        });
      }
    });

    // ------------------------------------------------ 二幕：活动定版
    v.scene("lockup", { duration: 1, background: "#05070d" }, (s) => {
      s.beat("lockup", { at: 0, description: "定版 0.2s 内落定，随后 0.8s 静止" });
      s.ellipse("halo", { width: 1000, height: 640, fill: "#f59e0b", opacity: 0.12, blur: 130, at: { x: "50%", y: "44%" } });
      s.text("event", EVENT, {
        size: 110, weight: 800, letterSpacing: 6, color: "#f8fafc",
        at: { x: "50%", y: "38%" },
        enter: { effect: "scale-pop", duration: 0.15, easing: "easeOutCubic" }, // 0.15s 落定
      });
      s.text("date", DATE, {
        size: 44, color: "#7dd3fc",
        at: { x: "50%", y: "54%" },
        enter: { effect: "fade", duration: 0.15 }, // 0.15s 落定
      });
      s.text("cta", CTA, {
        size: 40, weight: 700, color: "#f59e0b",
        at: { x: "50%", y: "68%" },
        enter: { effect: "fade", duration: 0.15, delay: 0.05 }, // 0.2s 落定 → 静止 0.8s
      });
    });

    // 下拍瞬间要硬切：crossfade 会稀释 tick 归零的落点感
    v.transition("cut", { between: ["tick", "lockup"] });
  },
);
