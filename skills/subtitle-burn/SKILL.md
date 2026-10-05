---
name: subtitle-burn
version: 0.1.0
description: Subtitle burn-in pipeline - convert SRT/VTT cues into aligned s.text layers with frame-snapped in/out windows and legibility styling.
trigger: The user supplies subtitles (SRT/VTT text or a cue list) plus a target video spec and asks to burn, hardcode, or bake captions into the timeline.
---

# Subtitle Burn

Goal: a conversion pipeline, not a genre: parse the caption file, then emit one text layer per cue with EXACT in/out windows (frame-snapped, drifting never) on the source video's dimensions and fps, bottom-center inside safe margins, optional backing band. Output must match every cue's timing within one frame - the subtitle track is a contract from the source, never re-timed or re-worded.

## Workflow

1. Ingest: read the caption file; confirm target width/height/fps/duration from the user or the source project. A mismatched fps silently drifts cues - verify BEFORE generating. Reject/flag cues with end <= start, overlaps (clip the earlier cue's out), or gaps < 2 frames; report what you changed.
2. Map cues to the DSL (table below): scene boundaries at gaps >= 1.0s, else every <= 12s. Frame-snap every value: `round(seconds x fps) / fps`. Cues longer than 84 chars split into TWO timed cues (never two un-timed wrapped lines).
3. Write `src/video.ts`: one `s.text` layer per cue (`cue-<n>`, in/out = scene-local windows), fades 0.12s in/out, one static backing band per scene. `storyboard.plan` is unnecessary scaffolding here - the cue list IS the storyboard.
4. `compile.run` -> 0 errors; `check.overflow` (long cues -> maxWidth 1728 and a split, not a smaller size).
5. `render.preview` the first, a middle, and the last cue of each scene; if editing an approved project, `diff.frames` against the pre-edit render.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`); never delete a cue to go green. `render.final` -> hand off the MP4 for compositing over footage (v1 has no alpha export: ffmpeg overlay or any NLE).

SRT concept -> DSL concept:

| Caption file | VideoOS |
| --- | --- |
| cue (start, end, text) | one `s.text` layer, name `cue-<n>` |
| start / end | `in` / `out` (scene-local, frame-snapped, sceneStart = sum of durations - transition overlaps) |
| gap >= 1.0s | scene boundary |
| > 42 chars per line | split into two cues, each with its own timing |
| reading speed | chars / duration <= 21/s - flag violations, do not silently stretch |

## Recipes

Parse + validate (pure TS, before any scene is written):

```ts
interface Cue { start: number; end: number; text: string }

function parseSrt(raw: string): Cue[] {
  const toSeconds = (t: string): number => {
    const [hms, ms] = t.trim().replace(",", ".").split(".");
    const [h, m, sec] = hms.split(":").map(Number);
    return h * 3600 + m * 60 + sec + Number(`0.${(ms ?? "0").padEnd(3, "0")}`);
  };
  return raw.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split("\n").filter((l) => l.trim() !== "" && !/^\d+$/.test(l.trim()));
    const tc = lines.find((l) => l.includes("-->"));
    if (tc === undefined) return [];
    const [a, b] = tc.split("-->");
    const text = lines.filter((l) => l !== tc).join(" ").trim();
    const cue = { start: toSeconds(a), end: toSeconds(b), text };
    return cue.end > cue.start && text.length > 0 ? [cue] : []; // invalid cues die here, reported upstream
  });
}
```

Cue -> layers - the signature conversion: scene-local windows, 0.12s fades, bottom-center at 88% (owned media; lift to <= 86% for platform delivery):

```ts
const CUES = [ // already scene-local and frame-snapped (scene "cap-0" covers [0, 12) of the source)
  { start: 0.4, end: 3.2, text: "Welcome to VideoOS." },
  { start: 3.6, end: 7.1, text: "Today we burn captions into the timeline." },
  { start: 7.5, end: 11.4, text: "Every cue becomes one layer with in/out windows." },
];
v.scene("cap-0", { duration: 12, background: "#000000" }, (s) => {
  s.beat("cap-1", { at: 0.4, description: "Cue 1 window opens" });
  s.rect("band", { width: 1920, height: 150, fill: "#0a0a12", opacity: 0.55, at: { x: 960, y: 950 } }); // one static band per scene
  for (const [i, c] of CUES.entries()) {
    s.text(`cue-${i + 1}`, c.text, { size: 58, weight: 600, color: "#e2e8f0", maxWidth: 1728,
      in: c.start, out: c.end, at: { x: "50%", y: "88%" },
      enter: { effect: "fade", duration: 0.12 }, exit: { effect: "fade", duration: 0.12 } });
  }
});
v.transition("cut", { duration: 0.1, between: ["cap-0", "cap-1"] }); // scene cuts never shift cue math
```

Style rules (16:9 1080p baseline - scale with canvas):

| Rule | Value | Why |
| --- | --- | --- |
| Size / weight | 54-60, weight 600 | legible at phone distance; never below 54 |
| Max line | 42 chars, max 2 lines per cue | the Netflix norm; longer means split cues |
| Position | bottom-center, y 88% (86% for platform) | above platform UI, below the action |
| Band | full-width, 150px, #0a0a12 at 0.55 | steadier and cheaper than per-cue plates |
| Gap | >= 2 frames between cues | a hard cut reads cleaner than a crossfade |
| Min dwell | >= 5 frames (0.17s at 30fps) | anything shorter flashes |

## QA gates

- Every cue, at its safest frame (window midpoint): `expect(frame(round((sceneStart + (c.start + c.end) / 2) * fps))).toContainText(c.text)` - midpoint clears both 0.12s fades.
- Gap gate: for adjacent cues with gap >= 0.2s, `expect(frame(gapMidpoint)).not.toContainText(...)` for both texts - never two cues on screen.
- Reading speed (pure assertion, no render): `expect(c.text.length).toBeLessThanOrEqual(21 * (c.end - c.start))` - flag failures to the user instead of stretching timing.
- Structure: `expect(scene("cap-0")).toHaveLayers("band", "cue-1", "cue-2", "cue-3")`.
- Window fidelity: `test.run` green AND a hand diff of the first/last cue frame against the source timecodes (one-frame tolerance) before `render.final`.

## Anti-patterns

- Re-wording or "fixing" cue text - verbatim, always; captions are accessibility artifacts.
- Stretching or shifting cue timing to "look better" - timing is a contract; flag source problems, do not patch them silently.
- Two lines jammed into one layer - a 2-line cue is two layers with the SAME window (or a split with two windows), so line 1 can assert independently.
- Captions in the bottom 20% for platform delivery - like/comment rails cover them; lift to y <= 86%.
- Crossfades between caption scenes - `cut` keeps scene math exact; crossfades shift sceneStart by the overlap and break frame math.
- Un-snapped decimals in in/out - frame-snap every value (`round(s x fps) / fps`); sub-frame windows render nondeterministically at the boundary.
