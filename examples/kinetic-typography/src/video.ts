// kinetic-typography — text-motion showcase: typewriter reveals and the four
// directional "pop/slide" moves, on two crossfaded scenes. Zero assets.
//
// Timeline math (fps 30, 1280×720):
//   typewriter [0.0s, 4.0s)  4.0s — two typewriter lines (monospace)
//   moves      [3.6s, 7.6s)  4.0s — scale-pop heading + slide-up/left/right labels
//   total: 7.6s = 228 frames (crossfade 0.4s overlaps the two scenes)
import { defineVideo } from "@videoos/dsl";

export default defineVideo(
  {
    title: "Kinetic Typography",
    width: 1280,
    height: 720,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    // ----------------------------------------------------------- typewriter
    v.scene("typewriter", { duration: 4, background: "#0a0a12" }, (s) => {
      s.beat("type-start", { at: 0.2, description: "First typewriter line starts" });
      s.beat("line-2-start", { at: 1.7, description: "Second typewriter line starts" });

      // warm glow, visible from frame 0 (keeps frame 0 non-black while text types)
      s.ellipse("glow", {
        width: 420,
        height: 420,
        fill: "#f59e0b",
        opacity: 0.22,
        blur: 80,
        at: { x: "50%", y: "35%" },
      });

      // typewriter reveal: content is sliced to ceil(len * easing(t)) — 15 chars
      s.text("line-1", "TYPE IS MOTION.", {
        size: 60,
        weight: 700,
        font: "monospace",
        color: "#ffffff",
        letterSpacing: 2,
        at: { x: "50%", y: "52%" },
        enter: { effect: "typewriter", duration: 1.5, easing: "linear" },
      });

      // second line starts only after the first one finished typing (delay 1.6s)
      s.text("line-2", "Every character lands on a beat.", {
        size: 38,
        font: "monospace",
        color: "#8b8ba7",
        at: { x: "50%", y: "66%" },
        enter: { effect: "typewriter", duration: 1.6, delay: 1.6, easing: "easeOutCubic" },
      });
    });

    // ---------------------------------------------------------------- moves
    v.scene("moves", { duration: 4 }, (s) => {
      s.beat("pop", { at: 0.2, description: "Heading scale-pops in" });
      s.beat("slides", { at: 0.9, description: "Directional slide labels arrive" });

      s.text("pop", "FOUR WAYS TO MOVE", {
        size: 56,
        weight: 800,
        color: "#ffffff",
        letterSpacing: 3,
        at: { x: "50%", y: "26%" },
        enter: { effect: "scale-pop", duration: 0.6, easing: "easeOutBack" },
      });

      // slide directions are named by where the text ENDS UP moving:
      // slide-up    → rises from below (distance px, default 40)
      // slide-left  → travels leftwards from the right
      // slide-right → travels rightwards from the left
      s.text("up", "SLIDE UP", {
        size: 44,
        weight: 700,
        color: "#7dd3fc",
        at: { x: "50%", y: "45%" },
        enter: { effect: "slide-up", duration: 0.5, delay: 0.5, easing: "easeOutCubic", params: { distance: 50 } },
      });

      s.text("left", "SLIDE LEFT", {
        size: 44,
        weight: 700,
        color: "#34d399",
        at: { x: "50%", y: "58%" },
        enter: { effect: "slide-left", duration: 0.5, delay: 1.0, easing: "easeOutCubic", params: { distance: 120 } },
      });

      s.text("right", "SLIDE RIGHT", {
        size: 44,
        weight: 700,
        color: "#f59e0b",
        at: { x: "50%", y: "71%" },
        enter: { effect: "slide-right", duration: 0.5, delay: 1.5, easing: "easeOutCubic", params: { distance: 120 } },
      });
    });

    v.transition("crossfade", { duration: 0.4, between: ["typewriter", "moves"] });
  },
);
