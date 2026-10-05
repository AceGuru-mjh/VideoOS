---
name: audio-react
version: 0.1.0
description: Beat-driven motion on a 250ms grid (120 BPM default) - quantized delays, grid-aligned audio fades, a debug metronome. Timeline discipline, not audio analysis.
trigger: The user wants cuts, pops, or accents to land "on the beat" with a music track, mentions BPM or a metronome feel, or asks for audio-reactive motion in a v1 video.
---

# Audio React

Goal: motion that lands on a musical grid. Honest scope: v1 renders NO waveform, detects NO onsets, and guesses NO BPM - "beat-driven" here means timeline discipline. Every authored time is a multiple of the half-beat (0.25s at 120 BPM), audio fades are declared on the same grid, and a temporary visual metronome proves alignment before it is deleted. Kinetic-lyrics owns lyric-line events; this skill owns the grid, the track declaration, and the accent rhythm.

## Workflow

1. Fix the grid from the user's BPM (default 120): beat = 60 / BPM -> 0.5s; half-beat = beat / 2 -> 0.25s. Every authored time - delays, `in`/`out` windows, transition durations, audio start and fades - is a multiple of the half-beat. Round to the grid; never fudge.
2. Write the beat table first (the timeline of record): which beats are downbeats (every 4th), where accents land (bar starts), where the track starts and ends. The table is authored before any layer - the same discipline kinetic-lyrics applies to lines.
3. Attach the track ONLY if the user supplied audio: `asset.add` the file, confirm with `asset.list`, then `v.audio("track", "assets/track.mp3", { start, volume, fadeIn, fadeOut })` - start on a downbeat, fadeIn / fadeOut as whole beats (they are durations in seconds, 0-1 volume).
4. Author visual accents on the grid: one accent event per bar (Recipe 1), delay = bar index x 2s at 120 BPM. Keep roughly 4 quiet beats per accent - a hit on every beat is a strobe and an accessible-captions photosensitivity risk.
5. Add the debug metronome (Recipe 2): one low-opacity rect flash per beat via `in`/`out` windows. `compile.run` -> 0 errors, then `render.preview` - every accent must land exactly on a flash frame; off by a quarter-beat is audible even when it is only visible.
6. DELETE the metronome layers (via `scene.modify` or by removing the loop) before `render.final`; `test.run` with the gates below; repair loop <= 3.
7. Report the grid in the delivery line - BPM, grid unit, track start beat - so the next editor inherits the timeline instead of reverse-engineering it.

## Recipes

Accents on the grid - every delay below is a multiple of HALF:

```ts
const BPM = 120;
const BEAT = 60 / BPM;    // 0.5s
const HALF = BEAT / 2;    // 0.25s - the grid unit
v.scene("drop", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("bar-1", { at: 0, description: "Downbeat - word lands with the kick" });
  s.beat("bar-2", { at: 2, description: "Next downbeat - second accent" });
  s.ellipse("halo", { width: 720, height: 480, fill: "#6d28d9", opacity: 0.16, blur: 130,
    at: { x: "50%", y: "44%" } });                      // frame-0 ink, no enter
  const HITS = [0, 2];                                  // downbeats in seconds = 4 x HALF
  const WORDS = ["ON", "BEAT"];
  for (const [i, t] of HITS.entries()) {
    s.text(`word-${i + 1}`, WORDS[i], { size: 130, weight: 800, color: "#f8fafc",
      at: { x: "50%", y: `${36 + i * 16}%` },
      enter: { effect: "scale-pop", duration: BEAT, delay: t, easing: "easeOutBack" } });
    s.rect(`pulse-${i + 1}`, { width: 180, height: 10, fill: "#f59e0b", radius: 5,
      at: { x: "50%", y: `${58 + i * 6}%` }, opacity: 0.85,
      enter: { effect: "fade", duration: BEAT, delay: t } });
  }
});
// the track, only when the user supplied one - fades are whole beats:
v.audio("track", "assets/track.mp3", { start: 0, volume: 0.85, fadeIn: BEAT, fadeOut: BEAT * 4 });
```

The debug metronome - paste inside the scene builder, verify, then DELETE:

```ts
// DEBUG ONLY - one 0.25s flash per beat; delete these layers before render.final
for (let b = 0; b < 8; b++) {                           // 8 beats = the 4s scene
  s.rect(`tick-${b + 1}`, { width: 26, height: 26, fill: "#f59e0b", opacity: 0.08,
    at: { x: "6%", y: "6%" }, in: b * BEAT, out: b * BEAT + HALF });
}
```

## QA gates

- Grid discipline: every authored time is a multiple of HALF - verify via `scene.inspect` (beats, in/out windows) before `render.final`. At 30fps a beat is 15 frames and a half-beat is 7.5, so assert on beats.
- Accent landing: `expect(frame(15)).toContainText("ON")` (0.5s = enter done) and `expect(frame(75)).toContainText("BEAT")` (2.5s); `toHaveBeat("bar-1")` / `toHaveBeat("bar-2")`.
- Metronome removal: final `toHaveLayers(...)` lists contain no `tick-*` names; a shipped metronome flash is a bug, not a style.
- Muted first: the cut must still work with the sound off (autoplay is muted) - accents are visible hits, never audio-only cues.
- Audio honesty: `v.audio` exists only when the user supplied a file; volume within [0,1]; fadeOut fits inside the remaining runtime.
- `expect(frame(0)).not.toBeBlack()` (halo supplies ink); `noTextOverflow()` on the accent words.

## Anti-patterns

- Claiming audio analysis - v1 has no waveform, onset detection, or BPM detection; "reacts to the music" without a grid is a lie the preview will expose.
- Off-grid times (a pop at 1.37s) - a 0.12s drift is inaudible in one scene and unmistakable by the third; quantize every event.
- A hit on every beat (or half-beat) - constant motion reads as a strobe; 4 quiet beats per accent is the rhythm, and fast flashing is a photosensitivity risk.
- Shipping the metronome - the debug layer is scaffolding; even opacity-0.08 flashes read as glitches in the final render.
- Music as the only carrier - muted autoplay means the visual grid (and captions, where relevant) must carry the beat alone.
- fadeOut longer than the audio's remaining runtime - the fade gets clipped and the ending reads as a mistake; budget fades in whole beats that fit.
