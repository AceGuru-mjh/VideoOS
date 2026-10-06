// comparison — 12 秒产品对比（16:9，1920×1080，30fps，静音可看）：
// 分屏对阵板 → 三回合逐项 PK（胜方绿勾 ✓ / 负方灰点 ·，每回合 1.2s 定格读窗）→ 裁决帧三理由。
// 诚实原则：让掉真的会输的一回合（3:0 是广告不是对比）。
//
// 时间轴（crossfade 0.3s 使后一场景提前 0.3s 开始）：
//   versus [0,2) 2s 双板入场，名字 1s 可读 → round-1 [1.7,4.3) → round-2 [4,6.6)
//   → round-3 [6.3,8.9)（让分回合）→ verdict [8.6,12) 3.4s 三理由 + 尾部 0.95s 静止。总 12s = 360 帧
import { defineVideo } from "@videoos/dsl";

// 改这里换内容：双方名字 / 三回合（议题 + 双方主张 ≤ 14 字 + 诚实胜者）/ 裁决三理由
const US = "VideoOS";
const THEM = "LegacyTool";
const ROUNDS = [
  { topic: "上手", us: "3 分钟一条命令", them: "半天 YAML 配置", winner: "us" },
  { topic: "速度", us: "预览 1.9 秒出帧", them: "整段重渲染", winner: "us" },
  { topic: "价格", us: "按量计费", them: "有免费档", winner: "them" }, // 诚实让分
];
const REASONS = ["上手是分钟级，不是天级", "预览速度肉眼可感", "路线图开放，定价诚实"];

export default defineVideo(
  { title: "产品对比", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    // ------------------------------------------------ 一幕：对阵板
    v.scene("versus", { duration: 2.0, background: "#0a0a12" }, (s) => {
      s.beat("boards-in", { at: 0, description: "双方名字 1s 内可读" });
      s.ellipse("glow", { width: 700, height: 420, fill: "#f59e0b", opacity: 0.12, blur: 140, at: { x: "50%", y: "42%" } });
      // 板几何全场唯一：我方 x 27% / 对方 x 73%，双板 840×760——跨场景漂移是本类第一大 bug
      s.rect("board-us", { width: 840, height: 760, fill: "#0d1a14", radius: 20, at: { x: "27%", y: "52%" },
        enter: { effect: "slide-right", duration: 0.5, easing: "easeOutCubic", params: { distance: 120 } } });
      s.rect("board-them", { width: 840, height: 760, fill: "#16161f", radius: 20, at: { x: "73%", y: "52%" },
        enter: { effect: "slide-left", duration: 0.5, easing: "easeOutCubic", params: { distance: 120 } } });
      s.text("name-us", US, { size: 84, weight: 800, color: "#f8fafc", at: { x: "27%", y: "24%" },
        enter: { effect: "blur-up", duration: 0.5, delay: 0.3 } }); // 0.8s 可读
      s.text("name-them", THEM, { size: 84, weight: 800, color: "#94a3b8", at: { x: "73%", y: "24%" },
        enter: { effect: "blur-up", duration: 0.5, delay: 0.45 } }); // 0.95s 可读
      s.text("vs", "VS", { size: 46, weight: 800, letterSpacing: 2, color: "#f59e0b", at: { x: "50%", y: "42%" },
        enter: { effect: "scale-pop", duration: 0.4, delay: 0.9, easing: "easeOutBack" } });
    });

    // ------------------------------------------------ 二至四幕：三回合（数据驱动）
    let scoreUs = 0;
    let scoreThem = 0;
    for (const [r, round] of ROUNDS.entries()) {
      const winUs = round.winner === "us";
      if (winUs) scoreUs += 1; else scoreThem += 1;
      v.scene(`round-${r + 1}`, { duration: 2.6, background: "#0a0a12" }, (s) => {
        s.beat("topic", { at: 0.15, description: "回合议题落地" });
        s.beat("freeze", { at: 1.4, description: "1.4s 全落定，随后 1.2s 定格读窗" });
        // 板几何与 versus 完全一致（无入场 = 定格基准）
        s.rect("board-us", { width: 840, height: 760, fill: "#0d1a14", radius: 20, at: { x: "27%", y: "52%" } });
        s.rect("board-them", { width: 840, height: 760, fill: "#16161f", radius: 20, at: { x: "73%", y: "52%" } });
        s.text("topic", `回合 ${r + 1} · ${round.topic}`, { size: 30, weight: 700, letterSpacing: 4, color: "#94a3b8",
          at: { x: "50%", y: "12%" }, enter: { effect: "fade", duration: 0.3, delay: 0.15 } });
        s.text("claim-us", round.us, { size: 40, weight: 600, color: "#e2e8f0", at: { x: "27%", y: "42%" },
          enter: { effect: "slide-up", duration: 0.45, delay: 0.3, easing: "easeOutCubic", params: { distance: 60 } } });
        s.text("claim-them", round.them, { size: 40, weight: 600, color: "#94a3b8", at: { x: "73%", y: "42%" },
          enter: { effect: "slide-up", duration: 0.45, delay: 0.6, easing: "easeOutCubic", params: { distance: 60 } } });
        // 胜方绿点 + 勾，负方灰点；勾后声明 → 绘制在点上层
        s.ellipse("dot-win", { width: 44, height: 44, fill: "#22c55e", at: { x: winUs ? "27%" : "73%", y: "60%" },
          enter: { effect: "scale-pop", duration: 0.4, delay: 0.95, easing: "easeOutBack" } });
        s.text("check", "\u2713", { size: 34, weight: 800, color: "#0a0a12", at: { x: winUs ? "27%" : "73%", y: "60%" },
          enter: { effect: "fade", duration: 0.2, delay: 1.15 } });
        s.ellipse("dot-lose", { width: 26, height: 26, fill: "#475569", opacity: 0.7, at: { x: winUs ? "73%" : "27%", y: "60%" },
          enter: { effect: "fade", duration: 0.3, delay: 1.05 } });
        s.text("score", `${scoreUs} : ${scoreThem}`, { size: 36, weight: 800, font: "monospace", color: "#f59e0b",
          at: { x: "88%", y: "12%" }, enter: { effect: "scale-pop", duration: 0.35, delay: 1.05, easing: "easeOutBack" } });
      });
    }

    // 五幕：裁决帧 —— 三理由 0.4s 逐条（1.2 / 1.6 / 2.0 + 0.45 = 2.45s 全落定），尾部 0.95s 静止
    v.scene("verdict", { duration: 3.4, background: "#0a0a12" }, (s) => {
      s.beat("verdict", { at: 0.2, description: "裁决落地；三理由 2.45s 全落定后静止" });
      s.text("headline", `为什么 ${US} 赢`, { size: 84, weight: 800, color: "#f8fafc", at: { x: "50%", y: "28%" },
        enter: { effect: "blur-up", duration: 0.6, delay: 0.2 } });
      s.text("final-score", `${scoreUs} : ${scoreThem}`, { size: 44, weight: 800, font: "monospace", color: "#f59e0b",
        at: { x: "50%", y: "44%" }, enter: { effect: "scale-pop", duration: 0.4, delay: 0.8, easing: "easeOutBack" } });
      // 三理由 0.4s 逐条：1.2 / 1.6 / 2.0 + 0.45 = 2.45s 全落定
      for (const [i, reason] of REASONS.entries()) {
        s.text(`reason-${i + 1}`, reason, { size: 42, weight: 600, color: "#e2e8f0", at: { x: "50%", y: `${58 + i * 11}%` },
          enter: { effect: "slide-up", duration: 0.45, delay: 1.2 + i * 0.4, easing: "easeOutCubic", params: { distance: 50 } } });
      }
    });

    // 相邻场景 crossfade 0.3s（短于所有场景时长）；要更硬的拳击铃节奏可改 "cut"
    v.transition("crossfade", { duration: 0.3, between: ["versus", "round-1"] });
    v.transition("crossfade", { duration: 0.3, between: ["round-1", "round-2"] });
    v.transition("crossfade", { duration: 0.3, between: ["round-2", "round-3"] });
    v.transition("crossfade", { duration: 0.3, between: ["round-3", "verdict"] });
  },
);
