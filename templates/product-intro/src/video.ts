// product-intro — 30 秒五幕产品介绍（16:9，1920×1080，30fps，静音可看）：
// 痛点钩子 → 解决方案 → 三特性逐条 → 数据证明 → CTA 定版。
// 时间轴（crossfade 0.5s 使后一场景提前 0.5s 开始）：
//   hook [0,6) 6s 痛点钩子(1s 可读) → solution [5.5,11) 5.5s → features [10.5,19.5) 9s
//   → proof [19,26) 7s 大数字 count-up → cta [25.5,30) 4.5s 定版（尾部 3s 静止）。总 30s = 900 帧
import { defineVideo } from "@videoos/dsl";

// 改这里换皮：品牌名 / 主色 / 链接 / 三条特性（每条 ≤ 22 字防溢出）
const BRAND = "VideoOS";
const ACCENT = "#22d3ee";
const URL = "videoos.dev";
const FEATURES = ["确定性管线：同一份代码，永远同一份成片", "帧级视觉回归：每个关键帧都有断言", "事务化编辑：不满意就回滚，零风险试错"];

export default defineVideo(
  { title: "产品介绍", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    // 一幕：痛点钩子 —— 帧零有墨（光斑无入场动画），标题 0.8s 完成 → 1s 契约成立
    v.scene("hook", { duration: 6, background: "#0a0a12" }, (s) => {
      s.beat("pain", { at: 0.2, description: "痛点提问 1s 内可读" });
      s.ellipse("glow", { width: 1100, height: 620, fill: ACCENT, opacity: 0.14, blur: 150, at: { x: "50%", y: "42%" } });
      s.text("pain", "还在手动重导出视频？", {
        size: 110, weight: 800, color: "#f8fafc", at: { x: "50%", y: "42%" },
        enter: { effect: "blur-up", duration: 0.8, easing: "easeOutCubic" } }); // 0.8s 完成 → 1s 契约成立
      s.text("pain-sub", "改一行文案，等一次渲染；改一次版式，再等一次", {
        size: 42, color: "#8b8ba7", at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.6, delay: 0.9 } });
    });

    // 二幕：解决方案 —— 品牌名 0.7s 落定，一句话价值随后
    v.scene("solution", { duration: 5.5, background: "#0a0a12" }, (s) => {
      s.beat("reveal", { at: 0.3, description: "产品名 + 一句话价值" });
      s.ellipse("glow", { width: 900, height: 560, fill: ACCENT, opacity: 0.16, blur: 140, at: { x: "50%", y: "40%" } });
      s.text("brand", BRAND, {
        size: 170, weight: 800, letterSpacing: 6, color: "#f8fafc", at: { x: "50%", y: "40%" },
        enter: { effect: "blur-up", duration: 0.7, easing: "easeOutCubic" } });
      s.text("value", "把视频当代码写：改即所见，帧帧可测", {
        size: 46, weight: 600, color: "#7dd3fc", at: { x: "50%", y: "56%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 },
      });
    });

    // 三幕：三特性逐条 —— 0.4s 节拍（0.3 / 0.7 / 1.1），第三条 1.1 + 0.6 = 1.7s 落定
    v.scene("features", { duration: 9, background: "#0a0a12" }, (s) => {
      s.beat("list-start", { at: 0.3, description: "标题 + 强调线入场" });
      s.beat("settled", { at: 1.7, description: "第三条落定，进入静止读窗" });
      s.text("heading", "为什么选择我们", {
        size: 76, weight: 800, color: "#ffffff", letterSpacing: 4, at: { x: "50%", y: "24%" },
        enter: { effect: "blur-in", duration: 0.6 } });
      s.rect("accent-line", { width: 240, height: 6, fill: ACCENT, radius: 3, at: { x: "50%", y: "31%" },
        enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
      for (const [i, text] of FEATURES.entries()) {
        s.text(`feature-${i + 1}`, `0${i + 1} · ${text}`, {
          size: 46, weight: 600, color: "#e2e8f0", at: { x: "50%", y: `${44 + i * 12}%` },
          enter: { effect: "slide-up", duration: 0.6, delay: 0.3 + i * 0.4, easing: "easeOutCubic", params: { distance: 60 } },
        });
      }
    });

    // 四幕：数据证明 —— 等宽数字防抖动；0.4 + 1.4 = 1.8s 落定，增幅 2.4s 落定（数字请替换为真实数据）
    v.scene("proof", { duration: 7, background: "#0a0a12" }, (s) => {
      s.beat("kpi", { at: 0.3, description: "大数字 count-up 开始，2.4s 全部落定" });
      s.ellipse("glow", { width: 1100, height: 520, fill: ACCENT, opacity: 0.12, blur: 150, at: { x: "50%", y: "44%" } });
      s.text("kpi-label", "每周稳定渲染成片", {
        size: 40, weight: 700, letterSpacing: 5, color: "#94a3b8", at: { x: "50%", y: "28%" },
        enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
      s.text("kpi-value", "12,847", {
        size: 170, weight: 800, font: "monospace", color: "#f8fafc", at: { x: "50%", y: "46%" },
        enter: { effect: "typewriter", duration: 1.4, delay: 0.4, easing: "easeOutCubic" } });
      s.text("kpi-delta", "较上季度 +38%", {
        size: 34, weight: 600, color: "#22c55e", at: { x: "50%", y: "62%" },
        enter: { effect: "scale-pop", duration: 0.4, delay: 2.0, easing: "easeOutBack" } });
    });

    // 五幕：CTA 定版 —— url 1.5s 落定 → 尾部 3.0s 全静止（≥0.8s 尾帧）
    v.scene("cta", { duration: 4.5, background: "#0a0a12" }, (s) => {
      s.beat("cta-in", { at: 0.2, description: "行动号召入场" });
      s.beat("still", { at: 1.7, description: "1.7s 后全画面静止" });
      s.text("cta", "现在就开始", {
        size: 96, weight: 800, color: "#ffffff", at: { x: "50%", y: "44%" },
        enter: { effect: "fade", duration: 0.8, delay: 0.2 } });
      s.text("cta-url", URL, {
        size: 44, color: "#8b8ba7", at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.6, delay: 0.9 },
      });
    });

    // 仅相邻场景之间；0.5s 短于两端所有场景时长
    v.transition("crossfade", { duration: 0.5, between: ["hook", "solution"] });
    v.transition("crossfade", { duration: 0.5, between: ["solution", "features"] });
    v.transition("crossfade", { duration: 0.5, between: ["features", "proof"] });
    v.transition("crossfade", { duration: 0.5, between: ["proof", "cta"] });
  },
);
