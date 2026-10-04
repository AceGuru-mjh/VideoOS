// product-promo — 3-scene launch video: title card (blur-up + push-in camera),
// kinetic feature list (staggered slide-up), CTA outro (fade). Crossfades between scenes.
//
// Timeline math (fps 30, 1920×1080):
//   title    [0.0s, 4.0s)   4.0s
//   features [3.5s, 8.5s)   5.0s (crossfade 0.5s overlaps the title tail)
//   cta      [8.0s, 11.0s)  3.0s (crossfade 0.5s overlaps the features tail)
//   total: 11.0s = 330 frames — fully deterministic (fixed seed, no unseeded
//   randomness, no wall-clock reads).
import { defineVideo } from "@videoos/dsl";

export default defineVideo(
  {
    title: "VideoOS Product Promo",
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    // ---------------------------------------------------------------- title
    v.scene("title", { duration: 4, background: "#0a0a12" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "Main title blur-up entrance" });
      s.beat("subtitle-enter", { at: 0.8, description: "Subtitle fades in below the title" });

      // soft violet glow behind the title (no enter animation → visible at frame 0)
      s.rect("glow", {
        width: 700,
        height: 700,
        fill: "#6d28d9",
        opacity: 0.25,
        blur: 120,
        at: { x: "50%", y: "38%" },
      });

      s.text("title", "SHIP VIDEO", {
        size: 140,
        weight: 800,
        color: "#ffffff",
        letterSpacing: 6,
        at: { x: "50%", y: "38%" },
        enter: { effect: "blur-up", duration: 0.8, easing: "easeOutCubic", params: { distance: 40, blur: 12 } },
      });

      s.text("subtitle", "The agent-native video runtime", {
        size: 44,
        color: "#8b8ba7",
        at: { x: "50%", y: "52%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });

      s.camera("push-in", { from: 1.0, to: 1.08 });
    });

    // ------------------------------------------------------------- features
    v.scene("features", { duration: 5 }, (s) => {
      s.beat("list-enter", { at: 0.2, description: "Heading + accent line enter" });
      s.beat("item-two", { at: 0.9, description: "Second feature slides up" });
      s.beat("item-three", { at: 1.5, description: "Third feature slides up" });

      s.text("heading", "BUILT FOR AGENTS", {
        size: 76,
        weight: 800,
        color: "#ffffff",
        letterSpacing: 4,
        at: { x: "50%", y: "24%" },
        enter: { effect: "blur-in", duration: 0.6 },
      });

      // amber accent line under the heading
      s.rect("accent", {
        width: 240,
        height: 6,
        fill: "#f59e0b",
        radius: 3,
        at: { x: "50%", y: "31%" },
        enter: { effect: "fade", duration: 0.5, delay: 0.2 },
      });

      // kinetic list: identical slide-up effect, staggered delays (0.3 / 0.9 / 1.5)
      s.text("item-1", "01 · Deterministic pipeline", {
        size: 46,
        weight: 600,
        color: "#e2e8f0",
        at: { x: "50%", y: "44%" },
        enter: { effect: "slide-up", duration: 0.6, delay: 0.3, easing: "easeOutCubic", params: { distance: 60 } },
      });

      s.text("item-2", "02 · Visual QA on every frame", {
        size: 46,
        weight: 600,
        color: "#e2e8f0",
        at: { x: "50%", y: "56%" },
        enter: { effect: "slide-up", duration: 0.6, delay: 0.9, easing: "easeOutCubic", params: { distance: 60 } },
      });

      s.text("item-3", "03 · Rollback-safe agent edits", {
        size: 46,
        weight: 600,
        color: "#e2e8f0",
        at: { x: "50%", y: "68%" },
        enter: { effect: "slide-up", duration: 0.6, delay: 1.5, easing: "easeOutCubic", params: { distance: 60 } },
      });
    });

    // ------------------------------------------------------------------ cta
    v.scene("cta", { duration: 3 }, (s) => {
      s.beat("cta-enter", { at: 0.2, description: "Call-to-action headline fades in" });
      s.beat("url-enter", { at: 0.9, description: "Repository URL fades in" });

      s.text("cta", "Start shipping today", {
        size: 88,
        weight: 800,
        color: "#ffffff",
        at: { x: "50%", y: "44%" },
        enter: { effect: "fade", duration: 0.8, delay: 0.2 },
      });

      s.text("url", "github.com/AceGuru-mjh/VideoOS", {
        size: 44,
        color: "#8b8ba7",
        at: { x: "50%", y: "58%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.8 },
      });
    });

    // transitions only between ADJACENT scenes; duration must be shorter than both scenes
    v.transition("crossfade", { duration: 0.5, between: ["title", "features"] });
    v.transition("crossfade", { duration: 0.5, between: ["features", "cta"] });
  },
);
