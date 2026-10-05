// kinetic-typography — 8 秒纯文字动效（16:9，1920×1080，30fps，零素材，静音可看）：
// 逐字波浪 + 同位换词硬切。文字即画面，rect 只做墨底与强调。
//
// 时间轴（crossfade 0.4s 使 swap 提前 0.4s 开始）：
//   wave [0.0s, 3.8s)  3.8s  逐字波浪，0.6s 波浪完成，1.1s 副句落定
//   swap [3.4s, 8.0s)  4.6s  同位换词：剪出来 → 渲出来 → 写出来（胜者定格）
//   总时长 8.0s = 240 帧
import { defineVideo } from "@videoos/dsl";

// 改这里换文案：主词（波浪逐字）/ 副句 / 换词序列（最后一个词定格不退场）
const HERO = "文字即画面";
const BODY = "每个字都落在节拍上";
const LEAD = "把视频";
const SWAPS = ["剪出来", "渲出来", "写出来"]; // 末位是主张，用强调色定格

export default defineVideo(
  { title: "纯文字动效", width: 1920, height: 1080, fps: 30, background: "#05070d", seed: 42 },
  (v) => {
    // ------------------------------------------------ 一幕：逐字波浪
    v.scene("wave", { duration: 3.8, background: "#05070d" }, (s) => {
      s.beat("wave", { at: 0, description: "波浪 0.6s 完成；副句 1.1s 落定" });
      // 帧零有墨：墨底光斑无入场动画
      s.rect("ink", { width: 900, height: 420, fill: "#22d3ee", opacity: 0.12, blur: 120, at: { x: "50%", y: "40%" } });

      // 逐字波浪：CJK 全角字符步进 ≈ size × 1.0（拉丁粗体约 × 0.72）
      // 5 字 × 160px：字心横跨 640 → 1280，中点 960；delay 0.05 + i × 0.04
      const size = 160;
      const startX = 960 - ((HERO.length - 1) * size) / 2;
      for (const [i, ch] of HERO.split("").entries()) {
        s.text(`hero-ch-${i}`, ch, {
          size, weight: 800, color: "#f8fafc",
          at: { x: startX + i * size, y: "40%" },
          // 逐字 0.04s 错峰 + 0.35s 滑入：最后一字 0.05 + 4×0.04 + 0.35 = 0.6s 落定
          enter: { effect: "slide-up", duration: 0.35, delay: 0.05 + i * 0.04, easing: "easeOutCubic", params: { distance: 70 } },
        });
      }

      s.text("hero-body", BODY, {
        size: 56, color: "#7dd3fc", letterSpacing: 2,
        at: { x: "50%", y: "60%" },
        enter: { effect: "fade", duration: 0.4, delay: 0.7 }, // 1.1s 落定
      });
    });

    // ------------------------------------------------ 二幕：同位换词
    v.scene("swap", { duration: 4.6, background: "#05070d" }, (s) => {
      s.beat("slot-1", { at: 0.7, description: "第一词可读" });
      s.beat("slot-3", { at: 2.6, description: "主张词可读，随后静止" });
      s.text("lead", LEAD, {
        size: 56, weight: 600, color: "#94a3b8",
        at: { x: "50%", y: "34%" },
        enter: { effect: "fade", duration: 0.3, delay: 0.2 },
      });

      // 同一位置的换词槽：wipe 入场 + 硬切 out；前一词 out = 后一词 in
      // 槽位时间表：0.7-1.3 / 1.3-2.3 / 2.3-定格；末词 2.6s 落定后静止 2.0s
      const slot = { x: "50%", y: "55%" };
      const windows: Array<[number, number | undefined]> = [[0.7, 1.3], [1.3, 2.3], [2.3, undefined]];
      for (const [i, word] of SWAPS.entries()) {
        const [tin, tout] = windows[i]!;
        const last = i === SWAPS.length - 1;
        s.text(`word-${i + 1}`, word, {
          size: 180, weight: 800,
          color: last ? "#22d3ee" : "#f8fafc", // 只有主张词用强调色
          at: slot,
          in: tin, ...(tout !== undefined ? { out: tout } : {}),
          enter: { effect: "wipe", duration: 0.3 },
        });
      }
    });

    v.transition("crossfade", { duration: 0.4, between: ["wave", "swap"] });
  },
);
