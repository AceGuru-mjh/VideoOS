// code-walkthrough — a terminal window mock (rect + traffic-light ellipses)
// with typewriter "shell output" lines, followed by a caption scene.
// Everything is drawn: zero assets, zero screenshots.
//
// Timeline math (fps 30, 1280×720):
//   terminal [0.0s, 6.5s)  6.5s — CLI session types itself line by line
//   caption  [6.0s, 9.0s)  3.0s — blur-up takeaway + fade subline
//   total: 9.0s = 270 frames (crossfade 0.5s overlaps the two scenes)
import { defineVideo } from "@videoos/dsl";

const PROMPT = "#7dd3fc"; // shell prompt lines (light blue)
const OK = "#34d399";     // success lines (green)
const MUTED = "#8b8ba7";  // chrome / captions

interface LineSpec {
  name: string;
  content: string;
  y: number;
  color: string;
  delay: number;
  duration: number;
}

// Each line completes typing at delay + duration; the last one lands at 5.8s < 6.5s.
const LINES: LineSpec[] = [
  { name: "line-1", content: "$ videoos compile", y: 200, color: PROMPT, delay: 0.4, duration: 0.7 },
  { name: "line-2", content: "ok - 3 scenes, 330 frames, 0 errors", y: 260, color: OK, delay: 1.3, duration: 1.2 },
  { name: "line-3", content: "$ videoos test", y: 320, color: PROMPT, delay: 2.8, duration: 0.6 },
  { name: "line-4", content: "ok - 12/12 assertions passed", y: 380, color: OK, delay: 3.7, duration: 1.0 },
  { name: "line-5", content: "$ videoos render", y: 440, color: PROMPT, delay: 5.0, duration: 0.8 },
];

export default defineVideo(
  {
    title: "Code Walkthrough — VideoOS CLI",
    width: 1280,
    height: 720,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    // -------------------------------------------------------------- terminal
    v.scene("terminal", { duration: 6.5, background: "#0a0a12" }, (s) => {
      s.beat("boot", { at: 0.2, description: "Terminal window appears" });
      s.beat("compile-ok", { at: 1.3, description: "Compile output starts typing" });
      s.beat("test-ok", { at: 3.7, description: "Test output starts typing" });
      s.beat("render-start", { at: 5.0, description: "Render command types" });

      // window body + title bar (no enter animation → visible at frame 0)
      s.rect("window", {
        width: 1040,
        height: 560,
        fill: "#141a26",
        radius: 16,
        at: { x: 640, y: 360 },
      });

      s.rect("titlebar", {
        width: 1040,
        height: 52,
        fill: "#1f2937",
        radius: 10,
        at: { x: 640, y: 106 },
      });

      // traffic lights (macOS-style), painted above the title bar
      s.ellipse("light-red", { width: 16, height: 16, fill: "#ff5f57", at: { x: 168, y: 106 } });
      s.ellipse("light-yellow", { width: 16, height: 16, fill: "#febc2e", at: { x: 196, y: 106 } });
      s.ellipse("light-green", { width: 16, height: 16, fill: "#28c840", at: { x: 224, y: 106 } });

      s.text("shell-title", "videoos - zsh", {
        size: 20,
        font: "monospace",
        color: MUTED,
        at: { x: 640, y: 106 },
      });

      // the session types itself: monospace lines, staggered typewriter enters
      for (const line of LINES) {
        s.text(line.name, line.content, {
          size: 26,
          font: "monospace",
          color: line.color,
          at: { x: 640, y: line.y },
          enter: { effect: "typewriter", duration: line.duration, delay: line.delay, easing: "easeOutCubic" },
        });
      }

      // static block cursor below the last line
      s.rect("cursor", {
        width: 14,
        height: 28,
        fill: PROMPT,
        at: { x: 640, y: 500 },
      });
    });

    // --------------------------------------------------------------- caption
    v.scene("caption", { duration: 3 }, (s) => {
      s.beat("caption-enter", { at: 0.3, description: "Takeaway caption enters" });

      s.text("caption", "Every frame is a function call.", {
        size: 52,
        weight: 700,
        color: "#ffffff",
        at: { x: "50%", y: "44%" },
        enter: { effect: "blur-up", duration: 0.8 },
      });

      s.text("sub", "compile | test | render, all deterministic", {
        size: 34,
        color: MUTED,
        at: { x: "50%", y: "58%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.6 },
      });
    });

    v.transition("crossfade", { duration: 0.5, between: ["terminal", "caption"] });
  },
);
