// logo-reveal — 5 秒 Logo 揭示定版（16:9，1920×1080，30fps，单场景，零素材，静音可看）：
// 背景色遮罩盖住标志 → 遮罩右滑露出（自左向右揭示）→ 光带横扫 → 副标语淡入 → 全静止定版。
//
// 揭示机构（绘制顺序即遮挡关系）：
//   wordmark 先声明（从第 0 帧就在场）→ mask 后声明盖在其上 → mask slide-right 滑出画面 = 揭示
//   遮罩终点 x 2600（画布外）；distance = 2600 - 960 = 1640
//
// 时间轴（帧数学 @30fps）：
//   0.0-1.1s  遮罩滑开 + 扫光条先行；0.8-1.8s 光带横扫跟随
//   1.6-2.1s  副标语淡入，此后无新元素
//   2.5-5.0s  全静止定版 2.5s（≥0.8s 尾帧）；本场景禁用相机（推满 5s 会让定版"活着"）
import { defineVideo } from "@videoos/dsl";

// 改这里换内容：标志文字（有 PNG 时换 s.image 层）/ 副标语 / 品牌色
const WORDMARK = "ACME";
const TAGLINE = "Motion systems studio";
const BRAND = "#22d3ee";

export default defineVideo(
  { title: "Logo 揭示", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    v.scene("reveal", { duration: 5, background: "#0a0a12" }, (s) => {
      s.beat("uncover", { at: 0, description: "扫光条在动，遮罩正在滑开" });
      s.beat("lockup", { at: 2.5, description: "全部运动落定，定版开始" });

      // 帧零有墨：光晕托底（无入场动画）
      s.ellipse("glow", { width: 900, height: 620, fill: "#6d28d9", opacity: 0.16, blur: 130, at: { x: 960, y: 460 } });

      // 标志层：不加入场动画——遮罩滑开本身就是揭示（再叠 blur-up 会变成两个揭示在打架）
      s.text("wordmark", WORDMARK, {
        size: 190, weight: 800, letterSpacing: 18, color: "#f8fafc",
        at: { x: 960, y: 460 }, // 190px × 4 字符 + 字距：宽度约 820px，安全落在 5% 边距内
      });

      // 遮罩：背景色、声明在标志之后（画在上层）；从盖住 (x 960) 滑到画布外 (x 2600)
      s.rect("mask", {
        width: 1300, height: 460, fill: "#0a0a12",
        at: { x: 2600, y: 460 },
        enter: { effect: "slide-right", duration: 1.1, easing: "easeOutCubic", params: { distance: 1640 } },
      });

      // 先导扫光条：终点在画布外（x 2500），第 0 帧已运动中（motion-first）
      s.rect("sweep-bar", {
        width: 150, height: 12, fill: BRAND, radius: 6,
        at: { x: 2500, y: 640 },
        enter: { effect: "slide-right", duration: 0.9, easing: "easeOutCubic", params: { distance: 1600 } },
      });

      // 光带横扫：白色模糊矩形跟在揭示线后面掠过标志
      s.rect("light-pass", {
        width: 380, height: 560, fill: "#ffffff", opacity: 0.3, blur: 60,
        at: { x: 2400, y: 460 },
        enter: { effect: "slide-right", duration: 1.0, delay: 0.8, easing: "easeOutCubic", params: { distance: 2000 } },
      });

      // 副标语：最后淡入（1.6 + 0.5 = 2.1s 落定）
      s.text("tagline", TAGLINE, {
        size: 36, color: "#8b8ba7", letterSpacing: 3,
        at: { x: 960, y: 600 },
        enter: { effect: "fade", duration: 0.5, delay: 1.6 },
      });
    });
  },
);
