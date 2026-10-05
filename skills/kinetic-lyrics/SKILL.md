---
name: kinetic-lyrics
version: 0.1.0
description: Animated lyric video (MV): three-state karaoke lines, char-level typewriter reveal, and word cascades on a BPM half-beat grid.
trigger: The user asks for a lyrics video, lyric MV, karaoke captions, or kinetic typography for a song, with or without an audio track.
---

# Kinetic Lyrics

Goal: a 16–32s lyric cut (16:9 default; vertical via the short-video skill's safe zones) where every lyric event lands on a half-beat grid — current line bright, sung lines dim, upcoming lines faint. It must read with the sound off.

## Workflow

1. Collect: exact lyrics from the user (never invent or recall lyrics), BPM (default 120), sections to cover, optional track file and album art. Compute the grid: halfBeat = 60 / BPM / 2 → 0.25s at 120 BPM.
2. Quantize every line to the grid: start = the half-beat of its first syllable, window 4–8 beats (2–4s at 120). Keep one event per half-beat — char landings, line flips, word cascades — and never leave 3+ consecutive half-beats empty. For track-driven accents (waveform, detected BPM) see the audio-react skill; v1 has no auto-sync, so the grid is the timeline of record.
3. `storyboard.plan { intent: "kinetic lyrics · <song>", durationSeconds }` → skeleton; the lyrics ARE the storyboard — collapse to one scene per section (verse, chorus).
4. Write `src/video.ts`: verse = the karaoke state machine (Recipe 1), chorus = word cascade + optional cover (Recipe 2). Attach the track with `v.audio` only if the user provided the file (`asset.add` first, then `asset.list` to confirm it registered).
5. `compile.run` → 0 errors; then `check.overflow` — 52px lines of 20+ chars are the overflow case; set `maxWidth` on long lines.
6. `render.preview { scene, beat }` inside each line's live window → `test.run` → repair ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` around risky edits) → `render.final`.

Grid and states (120 BPM):

| Unit | Value | Use |
| --- | --- | --- |
| 1 beat | 0.5s | one chorus word lands |
| half-beat | 0.25s | event grid: line flips, chars land, accents pop |
| line window | 2–4s (4–8 beats) | the live state of one line |

Opacity states — three stacked copies per line, hard-swapped by `in`/`out` windows on the grid: upcoming 0.15, live 1.0, sung 0.4.

## Recipes

Verse — the karaoke state machine (three layers per line, butt-cut on the grid):

```ts
// all times sit on the 0.25s grid; scene 9s so the last sung state gets a 0.5s tail
const LINES = [
  { n: 1, text: "We wrote it in the dark", start: 0.5, end: 2.5 },
  { n: 2, text: "Rendered every spark",    start: 2.5, end: 4.5 },
  { n: 3, text: "Nothing here is chance",  start: 4.5, end: 6.5 },
  { n: 4, text: "Every frame's a dance",   start: 6.5, end: 8.5 },
];
v.scene("verse", { duration: 9, background: "#0a0a12" }, (s) => {
  s.beat("grid-start", { at: 0, description: "Faint upcoming rows visible" });
  s.ellipse("halo", { width: 760, height: 540, fill: "#6d28d9", opacity: 0.18, blur: 120,
    at: { x: "50%", y: "46%" } });                          // frame-0 ink
  for (const line of LINES) {
    const y = `${30 + (line.n - 1) * 12}%`;                 // 4 rows, 12% apart
    // state 1 — upcoming: faint, visible until the line goes live
    s.text(`l${line.n}-upcoming`, line.text, { size: 52, color: "#e2e8f0", opacity: 0.15,
      in: 0, out: line.start, at: { x: "50%", y } });
    // state 2 — live: full brightness, char-by-char reveal (linear = singing pace)
    s.text(`l${line.n}-live`, line.text, { size: 52, weight: 700, color: "#ffffff",
      in: line.start, out: line.end, at: { x: "50%", y },
      enter: { effect: "typewriter", duration: (line.end - line.start) * 0.7, easing: "linear" } });
    // state 3 — sung: dimmed for the rest of the verse
    s.text(`l${line.n}-sung`, line.text, { size: 52, color: "#e2e8f0", opacity: 0.4,
      in: line.end, at: { x: "50%", y } });
  }
});
```

Chorus — one word per beat, optional album cover, optional track:

```ts
v.scene("chorus", { duration: 6, background: "#05070d" }, (s) => {
  s.beat("chorus-hit", { at: 0, description: "Downbeat — first word lands" });
  s.ellipse("halo", { width: 640, height: 640, fill: "#f59e0b", opacity: 0.15, blur: 110,
    at: { x: "50%", y: "42%" } });
  // cover art only when the user supplied a file — declare size explicitly
  s.image("cover", "assets/cover.jpg", { width: 400, height: 400, radius: 18,
    at: { x: "28%", y: "44%" },
    enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutCubic" } });
  const WORDS = ["LIGHT", "IT", "UP"];                      // one word per beat (0.5s)
  for (const [i, w] of WORDS.entries()) {
    s.text(`word-${i + 1}`, w, { size: 120, weight: 800, letterSpacing: 4, color: "#ffffff",
      at: { x: "64%", y: `${34 + i * 12}%` },
      enter: { effect: "slide-up", duration: 0.45, delay: 0.5 + i * 0.5,
        easing: "easeOutCubic", params: { distance: 80 } } });
  }
  s.camera("push-in", { from: 1.0, to: 1.05 });
});
// the track, only when the user provided audio — the cut must still read muted:
v.audio("track", "assets/track.mp3", { volume: 0.85, fadeIn: 0.4, fadeOut: 1.0 });
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — halo plus the faint upcoming rows.
- `expect(frame(63)).toContainText("We wrote it in the dark")` — 2.1s: typing done (0.5 + 1.4), line 1 still live.
- `expect(frame(243)).toContainText("Every frame's a dance")` — 8.1s: line 4 typed out, inside its window.
- `expect(scene("verse")).toHaveLayers("l1-upcoming", "l1-live", "l1-sung", "l4-live")` — the state machine survives edits.
- `expect(scene("chorus")).toHaveLayers("word-1", "word-2", "word-3")`; `toHaveBeat("grid-start")` and `toHaveBeat("chorus-hit")`.
- `durationBetween`: verse 8–10, chorus 4–8; `noTextOverflow()` on both (20+ char lines at 52px).
- Grid gate (review, not assertable in v1): every authored time is a multiple of 0.25 — verify with `scene.inspect` before `render.final`.

## Anti-patterns

- Inventing or "recalling" lyrics — copyright and accuracy; the user's exact text (plus translation) is the only source.
- Off-grid times (a line starting at 1.37s) — drift against the track compounds; quantize every event to the half-beat.
- One layer per line at constant opacity — no current-line hierarchy; viewers lose their place. The three-state machine IS the skill.
- Asserting full line text mid-typewriter — only the typed prefix exists; assert after `in + delay + duration` (visual-qa skill).
- Visible strobes on every half-beat — the grid disciplines timing, it is not a flash cue; motion lives in word landings and line flips.
- Lyrics inside the bottom 20% of a vertical cut — platform captions paint over them (short-video skill).
