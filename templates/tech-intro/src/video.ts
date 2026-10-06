// tech-intro — 6 秒科技感片头（16:9，1920×1080，30fps，单场景，静音可看）：
// 暗色网格 + 大标题 blur-up + 相机缓推 + 副标题，2.0s 后进入呼吸，尾部 4s 静止。
//
// 时间轴（单场景，帧数学 @30fps）：
//   0.0s  网格与光斑从第 0 帧渐显（帧零有墨）
//   0.7s  主标题 blur-up 落定（第 21 帧 → 1s 可读契约成立）
//   1.4s  副标题淡入完成，此后无新元素（6s × 60% = 3.6s 前全部结束）
//   2.0s-6.0s  呼吸 + 静止（≥0.8s 尾帧）
import { defineVideo } from "@videoos/dsl";

// 改这里换皮：主标题 / 副标题 / 强调色（避免默认靛紫，用青色系）
const WORDMARK = "VideoOS";
const TAGLINE = "把视频当代码写的运行时";
const ACCENT = "#22d3ee";

export default defineVideo(
  { title: "科技感片头", width: 1920, height: 1080, fps: 30, background: "#05070d", seed: 42 },
  (v) => {
    v.scene("intro", { duration: 6, background: "#05070d" }, (s) => {
      s.beat("land", { at: 0, description: "主标题 1s 内可读" });
      s.beat("breathe", { at: 1.4, description: "相机缓推，画面开始呼吸" });
      s.beat("hold", { at: 2.0, description: "全部入场完成，进入静止" });

      // 网格：120px 间距的横竖线（15 竖 + 8 横），透明度 ≤0.08 永不抢过文字
      for (let x = 1; x < 16; x++) {
        s.rect(`grid-v-${x}`, {
          width: 1, height: 1080, fill: ACCENT, opacity: 0.08,
          at: { x: `${(x / 16) * 100}%`, y: "50%" },
          enter: { effect: "fade", duration: 1.2, delay: 0.1 },
        });
      }
      for (let y = 1; y < 9; y++) {
        s.rect(`grid-h-${y}`, {
          width: 1920, height: 1, fill: ACCENT, opacity: 0.08,
          at: { x: "50%", y: `${(y / 9) * 100}%` },
          enter: { effect: "fade", duration: 1.2, delay: 0.2 },
        });
      }

      // 帧零有墨：光斑无入场动画；位于标题正下方
      s.rect("glow", { width: 760, height: 420, fill: ACCENT, opacity: 0.16, blur: 130, at: { x: "50%", y: "42%" } });

      // 主标题：blur-up 0.7s，第 21 帧完成
      s.text("wordmark", WORDMARK, {
        size: 170, weight: 800, letterSpacing: 6, color: "#f8fafc",
        at: { x: "50%", y: "42%" },
        enter: { effect: "blur-up", duration: 0.7, easing: "easeOutCubic" },
      });

      // 强调线（rect 只支持 slide/fade——wipe 是文本层专用效果）
      s.rect("underline", {
        width: 200, height: 3, fill: ACCENT, radius: 2,
        at: { x: "50%", y: "52%" },
        enter: { effect: "fade", duration: 0.5, delay: 0.9 },
      });

      // 副标题：1.4s 前落定，之后再无新元素进入
      s.text("tagline", TAGLINE, {
        size: 40, color: "#7dd3fc", letterSpacing: 2,
        at: { x: "50%", y: "60%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.8 },
      });

      // 相机缓推 ≤8%：整场景唯一的持续运动，2s 后读作呼吸而非位移
      s.camera("push-in", { from: 1.0, to: 1.06 });
    });
  },
);
