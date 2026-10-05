---
name: trailer-cut
version: 0.1.0
description: Trailer grammar for short cuts - 3s tease, 4-6s three-hit escalation on hard cuts, 2s title lock - with a cut rhythm table and SFX placeholder markers.
trigger: The user asks for a trailer, teaser, or "coming soon" cut - tension first, quick escalation, then the title - rather than a full narrative or explainer video.
---

# Trailer Cut

Goal: a 9-11s trailer: tease (3s, one unresolved image), escalate (4-6s, three quick-cut peaks), title lock (2s, the name lands and holds). Division of labor: cinematic-video owns the overall film feel (camera drift, crossfade rhythm, layered entrances); THIS skill owns the trailer's structure - the three-act pacing, the cut table, and the sound design markers.

## Workflow

1. Pick the tease: ONE unresolved phrase or number, no logo, no title, no payoff - the tease owes tension, not information (hook-forge patterns apply). Silence-friendly: it must read muted.
2. Pick the three escalate peaks: the strongest three fragments, ordered by increasing punch, each a 1-1.6s scene. No crossfades inside this act - the hard cut IS the escalation.
3. Pick the title lock: name plus a date/CTA line, 2s, with the end-card rules - no exits, still for the final 1.2s.
4. Write `src/video.ts` from the cut table below. Drop SFX markers into beat descriptions - [BOOM] on the tease's last frame, [RISE] climbing under the escalation, [CUT TO SILENCE] on the cut into the title - so sound design has a spec even before any audio file exists.
5. `compile.run` -> 0 errors; then `check.overflow` (the title lock carries the largest type in the cut).
6. `render.preview` every scene boundary: the tease must leave a question, cuts must accelerate, the lock must be still. Then `test.run` with the gates below; repair loop <= 3 via `scene.modify`.
7. Audio only when the user supplied files: map each marker to a real `v.audio` clip (grid rules from audio-react); otherwise the markers stay in the beats as the spec. `render.final`, deliver with the marker list.

Cut rhythm table (the contract):

| Boundary | Transition | Duration | Why |
| --- | --- | --- | --- |
| tease -> hit-1 | crossfade | 0.5s | the dissolve itself says "something is coming" |
| hit-1 -> hit-2 -> hit-3 | cut | 0s | staccato hits; any dissolve here defuses the act |
| hit-3 -> title | cut | 0s | the crash into silence before the name |
| title (internal) | none | - | the lock is still: no camera, no exits |

SFX markers are part of the deliverable, not decoration: [BOOM] downbeats the tease's end, [RISE] climbs each hit, and [CUT TO SILENCE] is the loudest beat in a trailer - silence before the title.

## Recipes

The tease (crossfade out) plus the escalation loop (hard cuts):

```ts
v.scene("tease", { duration: 3, background: "#05070d" }, (s) => {
  s.beat("tease-in", { at: 0.3, description: "One unresolved line; [BOOM] on the last frame" });
  s.ellipse("halo", { width: 640, height: 640, fill: "#6d28d9", opacity: 0.2, blur: 140,
    at: { x: "50%", y: "44%" } });
  s.text("tease", "it renders itself", { size: 88, weight: 800, color: "#e2e8f0",
    letterSpacing: 2, at: { x: "50%", y: "44%" },
    enter: { effect: "blur-in", duration: 0.9, delay: 0.3, easing: "easeOutCubic" } });
  s.camera("push-in", { from: 1.0, to: 1.06 });
});
v.transition("crossfade", { duration: 0.5, between: ["tease", "hit-1"] });
const HITS = [
  { name: "hit-1", text: "SCENES AS CODE", size: 54 },
  { name: "hit-2", text: "EVERY FRAME TESTED", size: 60 },
  { name: "hit-3", text: "ZERO RED RENDERS", size: 66 },
];
for (const hit of HITS) {
  v.scene(hit.name, { duration: 1.4, background: "#0a0a12" }, (s) => {
    s.beat("hit", { at: 0, description: "[RISE] climbing; hard cut out" });
    s.rect("bar", { width: 1920, height: 120, fill: "#f59e0b", opacity: 0.14,
      at: { x: "50%", y: "50%" } });                    // enter-less frame-0 ink
    s.text("line", hit.text, { size: hit.size, weight: 800, color: "#f8fafc",
      letterSpacing: 3, at: { x: "50%", y: "50%" },
      enter: { effect: "scale-pop", duration: 0.3, easing: "easeOutCubic" } });
  });
}
```

The title lock - crash in on a cut, then still:

```ts
v.transition("cut", { between: ["hit-3", "title"] });   // [CUT TO SILENCE]
v.scene("title", { duration: 2, background: "#05070d" }, (s) => {
  s.beat("lock", { at: 0.4, description: "Name lands, then still for 1.2s" });
  s.text("name", "VIDEOOS", { size: 150, weight: 800, letterSpacing: 10, color: "#ffffff",
    at: { x: "50%", y: "44%" }, enter: { effect: "blur-up", duration: 0.4, easing: "easeOutCubic" } });
  s.text("date", "spring 2025", { size: 40, color: "#94a3b8", letterSpacing: 4,
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
});
```

## QA gates

- Act structure: tease `durationBetween(2.5, 3.5)`; each hit `durationBetween(1.0, 1.6)`; title `durationBetween(1.8, 2.5)`; total 9-11s.
- Cut table is the contract: exactly ONE crossfade (tease -> hit-1, 0.4-0.6s); every other boundary is a cut - review the transition list via `scene.list` / `scene.inspect` before `render.final`.
- Tease tension: `expect(frame(36)).toContainText("it renders itself")` (readable by 1.2s); no name or logo text in the tease scene.
- Hit order: each hit's line assertable at its landing frame (`expect(frame(N)).toContainText("EVERY FRAME TESTED")`, N past scene start + 0.3s enter).
- Title lock stillness: name and date readable with 1.2s of stillness left; no `exit` anywhere in the cut; `expect(frame(0)).not.toBeBlack()`.
- Markers present: every beat description carries its [BOOM] / [RISE] / [CUT TO SILENCE] marker - they are the audio spec.

## Anti-patterns

- Logo in the tease - the viewer owes you nothing at 0:00; the brand arrives in the lock (hook-forge rule).
- Crossfades inside the escalation - dissolves bleed the hits together; the act IS the hard cut.
- Title lock under 1.5s - the name needs stillness to imprint; a flashing lock is a fourth hit, not a lock.
- Four or more escalate hits - escalation needs room to accelerate; more hits means shorter hits, which reads as noise.
- Spoiling the payoff - a trailer teases; if the full explanation fits, it is a product-demo, not a trailer.
- Dropping the SFX markers when audio never arrives - the markers are the spec for the next pass; a marker-less trailer cut is unfinished.
