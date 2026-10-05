---
name: kinetic-lyrics
version: 0.1.0
description: Kinetic lyric MV (vertical 9:16) - lines and words stagger onto the track's beat grid, active line white, chorus pops amber.
trigger: The user provides song lyrics (with audio, BPM, or per-line timestamps) and asks for a lyric video, MV, karaoke-style cut, or word-by-word music visualization.
---

# Kinetic Lyrics

Goal: a 1080x1920 (9:16) lyric cut - platform-first delivery - where every entrance is computed from the audio grid (BPM or user timestamps), never from feel. Swap the meta to 1920x1080 for a YouTube target; the beat math is identical.

## Workflow

1. Pin the timing source BEFORE writing any DSL: (a) BPM -> beat = 60/BPM s (120 BPM -> 0.5s); (b) per-line timestamps -> line windows directly; (c) neither -> ask, or default to a 0.5s grid and say so. Lyrics come verbatim from the user - never transcribe from memory.
2. `storyboard.plan { intent: "<track> · lyric mv", durationSeconds }` - remap to: hook (2s title card) -> verses (line-by-line) -> chorus (word-by-word). Sections are cut on downbeats: `cut` transitions keep scene math exact (no crossfade overlap).
3. Write `src/video.ts`: one text layer per lyric line with `in`/`out` windows snapped to the grid; chorus words get one layer per word (stack vertically - see Recipes). If the user supplies the track, `v.audio` it and verify `check.missingAssets`.
4. `compile.run` -> 0 errors; `check.overflow` (lyric lines are the longest strings you will ever center).
5. `render.preview` one settled frame per line + one mid-stagger chorus frame - QA cannot hear; you verify sync by ear against `render.range` clips.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

Stagger law (the genre's core formula):

| Timing source | Line window | Word stagger inside a line |
| --- | --- | --- |
| BPM 120, 4 beats/line | 2.0s | lineWindow / wordCount (8 words -> 0.25s) |
| Timestamps | next.start - this.start | same division, same law |
| No source | 2.0s default | cap at 0.3s; faster than 0.12s is unreadable |

## Recipes

Meta + audio + hook - title drops on the first downbeat:

```ts
export default defineVideo(
  { title: "Lyric MV - Nightdrive", width: 1080, height: 1920, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    v.audio("track", "assets/nightdrive.mp3", { volume: 0.9, fadeIn: 0.5, fadeOut: 1.0 });
    v.scene("hook", { duration: 2 }, (s) => {
      s.beat("title-drop", { at: 0.15, description: "Track title on the downbeat" });
      s.rect("glow", { width: 560, height: 560, fill: "#6d28d9", opacity: 0.25, blur: 110, at: { x: "50%", y: "38%" } });
      s.text("title", "NIGHTDRIVE", { size: 110, weight: 800, letterSpacing: 4, color: "#ffffff",
        at: { x: "50%", y: "38%" }, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
      s.text("artist", "kai.exe", { size: 48, color: "#8b8ba7", at: { x: "50%", y: "50%" },
        enter: { effect: "fade", duration: 0.4, delay: 0.5 } });
    });
```

Verse - line-by-line with windows (one line owns the screen; it enters slide-up, exits fade 0.3s before the next line's `in`):

```ts
    v.scene("verse-1", { duration: 6 }, (s) => {
      const LINES = [
        { text: "city lights blur into one", at: 0.0 },
        { text: "I drive until the map runs out", at: 2.0 },
        { text: "nothing left to run from", at: 4.0 },
      ]; // one line per 2.0s = 4 beats at 120 BPM
      for (const [i, line] of LINES.entries()) {
        s.beat(`line-${i + 1}`, { at: line.at, description: "Lyric line on a downbeat" });
        s.text(`line-${i + 1}`, line.text, { size: 76, weight: 700, color: "#ffffff", maxWidth: 820,
          in: line.at, out: line.at + 1.9, at: { x: "50%", y: "46%" },
          enter: { effect: "slide-up", duration: 0.4, easing: "easeOutCubic", params: { distance: 70 } },
          exit: { effect: "fade", duration: 0.3 } });
      }
    });
```

Chorus - word-by-word: stack words as a column (no x-offset math needed in 9:16), half-beat stagger, the hook word pops amber:

```ts
    v.scene("chorus", { duration: 4 }, (s) => {
      const WORDS = ["WE", "ARE", "THE", "NIGHT"];
      const stagger = 0.25; // half a beat at 120 BPM = lineWindow 2s / 8 half-beats... here: 4 words over 1 beat-pair
      for (const [i, word] of WORDS.entries()) {
        s.text(`word-${i + 1}`, word, { size: 128, weight: 800,
          color: word === "NIGHT" ? "#f59e0b" : "#ffffff",
          at: { x: "50%", y: `${34 + i * 10}%` },
          enter: { effect: "scale-pop", duration: 0.35, delay: 0.2 + i * stagger, easing: "easeOutBack" } });
      }
      s.camera("push-in", { from: 1.0, to: 1.06 });
    });
    v.transition("cut", { duration: 0.1, between: ["hook", "verse-1"] });
    v.transition("cut", { duration: 0.1, between: ["verse-1", "chorus"] });
  },
);
```

## QA gates

- `expect(frame(3)).toContainText("NIGHTDRIVE")` - hook settles at 0.15 + 0.5 = 0.65s; frame 3 is mid-artist-fade, title is done.
- Line windows: assert each line at `frame(round((sceneStart + line.at + 0.45) * 30))` and `not.toContainText` at `frame(round((sceneStart + line.at + 1.95) * 30))` - the line is gone before the next owns the screen (cuts do not overlap, so sceneStart = sum of previous durations).
- `expect(scene("chorus")).toHaveLayers("word-1", "word-2", "word-3", "word-4")`.
- `expect(scene("verse-1")).noTextOverflow()` - 76px lines at 1080 wide; split any line over ~18 chars into two layers.
- `durationBetween` per section: hook 1.5-2.5, verse sections 4-8, chorus 2-5.
- Sync is a human gate: play the `render.range` MP4 against the track before `render.final`; QA cannot catch a 0.2s drift.

## Anti-patterns

- Stagger chosen by feel - every delay derives from 60/BPM (or timestamps); write the division as a comment next to each constant.
- Two lines on screen at once in a verse - one line owns the screen; choruses own the multi-word moment.
- Word stagger below 0.12s (flicker) or wider than one beat (feels off-grid no matter how pretty).
- Transcribing lyrics from memory - verbatim from the user, or ask; wrong lyrics ship instantly and publicly.
- Branding/CTA overlays on the hook - the hook belongs to the track title; a CTA belongs in the description.
- Vertical lyrics under y 80% - platform caption UI eats the bottom 20% (see short-video skill margins).
