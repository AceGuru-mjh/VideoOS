// quote-card — 8 秒金句卡（1:1，1080×1080，30fps，单场景，零素材，静音可看）：
// 巨型引号作家具 → 引文打字机逐句揭示 → 关键句 scale-pop 定格 → 署名最后淡入。
//
// 时间轴（帧数学 @30fps）：
//   0.0s   巨型引号从第 0 帧在场（帧零有墨，透明度 0.12 不抢戏）
//   0.2-2.6s  两行引文先后打字机揭示（linear 保持字距节奏）
//   2.9s   关键句整体弹出（打字机的反衬：结论一次性落地）
//   3.3-5.0s  分隔线 → 作者 → 头衔依次淡入
//   5.0-8.0s  全画面静止 3.0s（≥0.8s 尾帧，适合循环播放）
import { defineVideo } from "@videoos/dsl";

// 改这里换内容：引文必须逐字来自原始出处（禁改写）；无自然断句时整句作关键句
const LEAD_LINES = ["预测未来的最好方式，", "不是等待它发生，"];
const KEY_LINE = "而是发明它。";
const AUTHOR = "Alan Kay";
const ROLE = "计算机科学家 · 1971";
const ACCENT = "#f59e0b";

export default defineVideo(
  { title: "金句卡", width: 1080, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    v.scene("quote", { duration: 8, background: "#0a0a12" }, (s) => {
      s.beat("mark", { at: 0, description: "引号墨迹在场" });
      s.beat("key-pop", { at: 2.9, description: "关键句弹出" });
      s.beat("still", { at: 5.0, description: "署名落定，静止开始" });

      // 巨型开引号（U+201C）：家具层，opacity ≤0.15，align left 时 at.x 是左边缘
      s.text("quote-mark", "\u201C", {
        size: 420, weight: 800, color: "#f8fafc", opacity: 0.12,
        at: { x: 170, y: 260 }, align: "left",
      });

      // 引文两行：先后打字机（v1 文本单行绘制，多行必须拆层）
      // 节奏：10 字 × 0.045s ≈ 1.2s/行；第二行在第一行完成后 0.2s 接棒
      s.text("lead-1", LEAD_LINES[0]!, {
        size: 56, weight: 600, color: "#e2e8f0", maxWidth: 840,
        at: { x: "50%", y: "38%" },
        enter: { effect: "typewriter", duration: 1.2, delay: 0.2, easing: "linear" },
      });
      s.text("lead-2", LEAD_LINES[1]!, {
        size: 56, weight: 600, color: "#e2e8f0", maxWidth: 840,
        at: { x: "50%", y: "47%" },
        enter: { effect: "typewriter", duration: 1.0, delay: 1.6, easing: "linear" }, // 2.6s 完成
      });

      // 关键句：不逐字、整句弹出——结论一次性落地，全卡唯一的强调色
      s.text("quote-key", KEY_LINE, {
        size: 88, weight: 800, color: ACCENT, maxWidth: 840,
        at: { x: "50%", y: "61%" },
        enter: { effect: "scale-pop", duration: 0.5, delay: 2.9, easing: "easeOutCubic" }, // 3.4s 落定
      });

      s.rect("rule", {
        width: 120, height: 3, fill: "#94a3b8", radius: 1.5,
        at: { x: "50%", y: "71%" },
        enter: { effect: "fade", duration: 0.4, delay: 3.7 },
      });

      // 署名永远最后：作者先于头衔（头衔 4.5 + 0.5 = 5.0s 落定）
      s.text("author", AUTHOR, {
        size: 44, weight: 700, color: "#f8fafc",
        at: { x: "50%", y: "79%" },
        enter: { effect: "fade", duration: 0.5, delay: 4.1 },
      });
      s.text("role", ROLE, {
        size: 32, color: "#8b8ba7",
        at: { x: "50%", y: "86%" },
        enter: { effect: "fade", duration: 0.5, delay: 4.5 },
      });
    });
  },
);
