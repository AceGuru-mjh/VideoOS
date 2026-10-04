// data-story — animated bar chart built from pure rect layers (zero assets).
//
// Bar growth trick: each bar is a rect whose final center sits on the baseline;
// a `slide-up` enter with distance = bar height makes it rise from fully below
// the baseline, while a background-colored "mask" rect (declared AFTER the bars,
// so it paints over them) hides everything below the baseline. The visible part
// above the baseline therefore grows from 0 → full height, each bar with its
// own easing — linear / easeOutCubic / easeOutExpo / bounce.
//
// Timeline math (fps 30, 1280×720):
//   chart    [0.0s, 6.5s)  6.5s — bars grow (staggered), labels fade in, hold
//   takeaway [6.0s, 9.0s)  3.0s — typewriter takeaway + fade subline
//   total: 9.0s = 270 frames (crossfade 0.5s overlaps the two scenes)
import { defineVideo } from "@videoos/dsl";

const BASELINE = 560; // y of the x-axis (px); bar heights = round(value × 48)
const BAR_WIDTH = 120;

interface BarSpec {
  name: string;
  value: string;
  height: number; // round(value × 48) — 3.2→154, 5.8→278, 4.4→211, 7.6→365
  x: number;      // bar center x (px)
  fill: string;
  easing: string;
  delay: number;
}

const BARS: BarSpec[] = [
  { name: "bar-1", value: "3.2", height: 154, x: 260, fill: "#6366f1", easing: "linear", delay: 0.15 },
  { name: "bar-2", value: "5.8", height: 278, x: 500, fill: "#22d3ee", easing: "easeOutCubic", delay: 0.35 },
  { name: "bar-3", value: "4.4", height: 211, x: 740, fill: "#a78bfa", easing: "easeOutExpo", delay: 0.55 },
  { name: "bar-4", value: "7.6", height: 365, x: 980, fill: "#f59e0b", easing: "bounce", delay: 0.75 },
];

export default defineVideo(
  {
    title: "Data Story — Render Hours Saved",
    width: 1280,
    height: 720,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    // ---------------------------------------------------------------- chart
    v.scene("chart", { duration: 6.5, background: "#0a0a12" }, (s) => {
      s.beat("bars-grow", { at: 0.2, description: "Bars start growing (staggered)" });
      s.beat("labels-show", { at: 2.6, description: "Value and axis labels fade in" });
      s.beat("settle", { at: 4.5, description: "Chart fully settled, hold for reading" });

      s.text("title", "RENDER HOURS SAVED PER WEEK", {
        size: 44,
        weight: 800,
        color: "#ffffff",
        letterSpacing: 2,
        at: { x: "50%", y: 88 },
        enter: { effect: "fade", duration: 0.6 },
      });

      // growing bars (declared before the mask → the mask paints over them)
      for (const bar of BARS) {
        s.rect(bar.name, {
          width: BAR_WIDTH,
          height: bar.height,
          fill: bar.fill,
          radius: 6,
          at: { x: bar.x, y: BASELINE - bar.height / 2 },
          // distance = own height → at t=0 the bar sits fully below the baseline
          enter: {
            effect: "slide-up",
            duration: 1.8,
            delay: bar.delay,
            easing: bar.easing,
            params: { distance: bar.height },
          },
        });
      }

      // mask: covers everything below the baseline with the background color,
      // turning "slide from below" into "grow from the axis". Declared AFTER bars.
      s.rect("mask", {
        width: 1280,
        height: 160,
        fill: "#0a0a12",
        at: { x: 640, y: 640 },
      });

      // x-axis line, painted above the mask
      s.rect("axis", {
        width: 960,
        height: 3,
        fill: "#8b8ba7",
        opacity: 0.7,
        radius: 1.5,
        at: { x: 640, y: BASELINE },
      });

      // value labels above each bar (fade in after the bars finish growing)
      for (const [i, bar] of BARS.entries()) {
        s.text(`value-${i + 1}`, bar.value, {
          size: 38,
          weight: 700,
          color: "#e2e8f0",
          at: { x: bar.x, y: BASELINE - bar.height - 44 },
          enter: { effect: "fade", duration: 0.5, delay: 2.0 + i * 0.2 },
        });
      }

      // weekday labels below the axis (declared after the mask → visible on it)
      const days = ["MON", "TUE", "WED", "THU"];
      for (const [i, day] of days.entries()) {
        s.text(`day-${i + 1}`, day, {
          size: 26,
          color: "#8b8ba7",
          at: { x: BARS[i].x, y: 608 },
          enter: { effect: "fade", duration: 0.4, delay: 2.6 + i * 0.1 },
        });
      }
    });

    // ------------------------------------------------------------- takeaway
    v.scene("takeaway", { duration: 3 }, (s) => {
      s.beat("takeaway-enter", { at: 0.3, description: "Takeaway line starts typing" });

      s.text("takeaway", "Determinism turns data into story.", {
        size: 48,
        weight: 700,
        color: "#ffffff",
        at: { x: "50%", y: "44%" },
        enter: { effect: "typewriter", duration: 1.4, easing: "easeOutCubic" },
      });

      s.text("sub", "Same input. Same pixels. Every time.", {
        size: 34,
        color: "#8b8ba7",
        at: { x: "50%", y: "58%" },
        enter: { effect: "fade", duration: 0.5, delay: 1.0 },
      });
    });

    v.transition("crossfade", { duration: 0.5, between: ["chart", "takeaway"] });
  },
);
