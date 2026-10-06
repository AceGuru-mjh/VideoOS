// data-dashboard — 15 秒数据看板叙事（16:9，1920×1080，30fps，静音可看）：
// 主指标 count-up → 2×1 对比双卡 → 阶梯柱生长 + 结论句。数字全部来自真实数据（示例值为占位，交付前必改）。
//
// 时间轴（crossfade 0.4s 使后一场景提前 0.4s 开始）：
//   hero  [0.0s,  4.5s)  4.5s  标签 0.7s / 大数字 1.8s / 增幅 2.4s 落定，相机缓推
//   duo   [4.1s,  9.1s)  5.0s  双卡 0.45s 成对入场（禁 2×2），2.75s 全落定
//   trend [8.7s, 15.0s)  6.3s  六柱 0.3s 阶梯生长 2.35s 完成，结论句 3.7s 落定后静止 2.6s
//   总时长 15.0s = 450 帧
import { defineVideo } from "@videoos/dsl";

// 改这里换数据：主指标 / 对比对 / 趋势六步（柱高 = round(值 × 3)）/ 结论句
const HERO = { label: "每周稳定渲染成片", value: "12,847", delta: "较上季度 +38%" };
const DUO = [
  { x: "29%", label: "渲染总量", value: "12,847", delta: "+38%" },
  { x: "71%", label: "P95 预览耗时", value: "1.9s", delta: "-44%" },
];
const STEPS = [120, 180, 170, 260, 330, 420]; // 高度 px = round(值 × 3)，末柱强调色
const CONCLUSION = "量翻倍的同时，耗时降了四成";

export default defineVideo(
  { title: "数据看板", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    // ------------------------------------------------ 一幕：主指标（一个数字独占全屏）
    v.scene("hero", { duration: 4.5, background: "#0a0a12" }, (s) => {
      s.beat("hero-open", { at: 0.2, description: "标签 1s 内可读" });
      // 帧零有墨：光晕无入场动画
      s.ellipse("glow", { width: 1100, height: 520, fill: "#22d3ee", opacity: 0.12, blur: 150, at: { x: "50%", y: "44%" } });
      s.text("label", HERO.label, { size: 40, weight: 700, letterSpacing: 5, color: "#94a3b8",
        at: { x: "50%", y: "30%" }, enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
      // 等宽数字防抖动（比例字体会横向晃）；0.4 + 1.4 = 1.8s 落定
      s.text("value", HERO.value, { size: 170, weight: 800, font: "monospace", color: "#f8fafc",
        at: { x: "50%", y: "46%" }, enter: { effect: "typewriter", duration: 1.4, delay: 0.4, easing: "easeOutCubic" } });
      s.text("delta", HERO.delta, { size: 34, weight: 600, color: "#22c55e",
        at: { x: "50%", y: "62%" }, enter: { effect: "scale-pop", duration: 0.4, delay: 2.0, easing: "easeOutBack" } });
      s.camera("push-in", { from: 1.0, to: 1.05 }); // 本幕唯一的持续运动
    });

    // ------------------------------------------------ 二幕：对比双卡（2×1，禁 2×2）
    v.scene("duo", { duration: 5.0, background: "#0a0a12" }, (s) => {
      s.beat("card-1", { at: 0.15, description: "第一卡入场" });
      s.beat("card-2", { at: 0.6, description: "第二卡 0.45s 后成对入场" });
      for (const [i, k] of DUO.entries()) {
        const d = 0.15 + i * 0.45; // 成对错峰（0.3-0.45s 区间），不是同时砸墙
        s.rect(`card-${i + 1}`, { width: 560, height: 460, fill: "#12121f", radius: 16, at: { x: k.x, y: "52%" },
          enter: { effect: "slide-up", duration: 0.5, delay: d, easing: "easeOutCubic", params: { distance: 60 } } });
        s.text(`label-${i + 1}`, k.label, { size: 30, weight: 700, letterSpacing: 3, color: "#94a3b8",
          at: { x: k.x, y: "36%" }, enter: { effect: "fade", duration: 0.4, delay: d + 0.2 } });
        s.text(`value-${i + 1}`, k.value, { size: 104, weight: 800, font: "monospace", color: "#f8fafc",
          at: { x: k.x, y: "50%" }, enter: { effect: "typewriter", duration: 1.2, delay: d + 0.35, easing: "easeOutCubic" } });
        // 增幅必须带符号（颜色只是第二通道：静音 + 色盲都要能读）
        s.text(`delta-${i + 1}`, k.delta, { size: 32, weight: 600, color: k.delta.startsWith("+") ? "#22c55e" : "#f59e0b",
          at: { x: k.x, y: "64%" }, enter: { effect: "fade", duration: 0.35, delay: d + 1.8 } });
      }
    });

    // ------------------------------------------------ 三幕：阶梯柱生长 → 结论句
    v.scene("trend", { duration: 6.3, background: "#0a0a12" }, (s) => {
      s.beat("trend-start", { at: 0.3, description: "阶梯自左向右生长" });
      s.beat("takeaway", { at: 3.7, description: "结论句落定，静止开始" });
      const BASELINE = 640;          // 柱底基线 y
      const STEP_W = 150, GAP = 20;  // 六柱总宽 6×150 + 5×20 = 1000，居中自 x 460 起
      for (const [i, h] of STEPS.entries()) {
        const x = 460 + i * (STEP_W + GAP) + STEP_W / 2;
        // slide-up distance = h：柱从基线下方整根升起——遮罩保证"从基线长出来"
        s.rect(`step-${i + 1}`, { width: STEP_W, height: h, fill: i === STEPS.length - 1 ? "#f59e0b" : "#38bdf8",
          radius: 4, at: { x, y: BASELINE - h / 2 },
          enter: { effect: "slide-up", duration: 0.55, delay: 0.3 + i * 0.3, easing: "easeOutCubic", params: { distance: h } } });
      }
      // 基线以下遮罩：高 440 盖到画布底（640 → 1080），入场中的柱根不露馅
      s.rect("mask", { width: 1920, height: 440, fill: "#0a0a12", at: { x: 960, y: 860 } });
      // 趋势箭头（rect 只用 fade——wipe 是文本层专用效果）：最后一步 2.35s 完成后出现
      s.rect("arrow-shaft", { width: 110, height: 6, fill: "#f59e0b", radius: 3,
        at: { x: 1420, y: 170 }, enter: { effect: "fade", duration: 0.35, delay: 2.5 } });
      s.rect("arrow-head", { width: 24, height: 24, fill: "#f59e0b", rotation: 45,
        at: { x: 1480, y: 170 }, enter: { effect: "fade", duration: 0.2, delay: 2.8 } });
      // 结论句：阶梯不收束到一句话就是屏保（3.2 + 0.5 = 3.7s 落定）
      s.text("conclusion", CONCLUSION, { size: 52, weight: 700, color: "#f8fafc",
        at: { x: "50%", y: "78%" }, enter: { effect: "blur-in", duration: 0.5, delay: 3.2 } });
    });

    v.transition("crossfade", { duration: 0.4, between: ["hero", "duo"] });
    v.transition("crossfade", { duration: 0.4, between: ["duo", "trend"] });
  },
);
