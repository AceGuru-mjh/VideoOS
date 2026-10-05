---
name: lower-thirds
version: 0.1.0
description: Broadcast lower-thirds: name + title bars that slide up in, hold clear of the bottom safe area, and lift out between speakers.
trigger: The user asks for a name tag, speaker bar, title strap, chyron, or lower third for an interview, panel, webinar, stream, or briefing video.
---

# Lower Thirds

Goal: an 8–12s demo scene (1920×1080, 30fps) — or the same layer group embedded in an existing video — where each speaker's bar slides up in 0.4s, holds ≥ 2.5s, and lifts out in 0.3s, always clear of the bottom 10% of the frame. Two-line lockup: name big, title small.

## Workflow

1. Collect per speaker: name (exact spelling), title/role (≤ 4 words), accent color, rotation order and dwell. Ask which side the faces sit on — the bar anchors the opposite side (default: left bar, faces right).
2. Layout math before code (1080p): bar block 760×150 anchored at x 220–980, block bottom edge ≤ 939px — the bottom 10% (y > 972) belongs to platform captions and stream UI.
3. `storyboard.plan { intent: "lower thirds · <event>", durationSeconds }` → discard template shots: thirds are layers inside ONE host scene, not scenes of their own.
4. Write `src/video.ts`: per speaker a four-layer group (bar, edge, name, title) sharing one `in`/`out` window per the timing table. Embed mode = same layers inside the target scene; wrap host edits in `transaction.begin` / `transaction.rollback`.
5. `compile.run` → 0 errors → `check.overflow` (60px names against a 760px bar).
6. `render.preview` the in moment, the hold, and one swap → `test.run` → repair ≤ 3 → `render.final` (or hand the scene back to the host video's owner).

Timing contract (per third, 3.5s dwell):

| Phase | Local window | Effect | Params |
| --- | --- | --- | --- |
| in | 0.0–0.4 | bar/edge/name/title `slide-up` | duration 0.4, easeOutCubic, distance 60; name delay 0.08, title delay 0.16 |
| hold | 0.4–3.2 | nothing moves | ≥ 2.5s |
| out | 3.2–3.5 | `slide-down` exit — departs upward | duration 0.3, easeInQuad |

Direction truth (engine): exits retrace the entrance path — a `slide-down` exit lifts the bar UP and away, a `slide-up` exit sinks it back below. Default here is the lift: the next speaker's bar is rising from below at the same moment, and opposite directions never tangle. Use `slide-up` exits only when the frame must go clean (no successor).

Multi-speaker rotation (10s host, three speakers):

| Speaker | In | Out | Exit | Note |
| --- | --- | --- | --- | --- |
| A | 0.0 | 3.5 | 3.2–3.5 | lifts as B rises |
| B | 3.3 | 6.9 | 6.6–6.9 | lifts as C rises |
| C | 6.7 | 10.0 | holds | the last speaker never exits into nothing |

## Recipes

One third, every option visible (speaker A + stand-in content):

```ts
v.scene("stage", { duration: 10, background: "#0f172a" }, (s) => {
  s.beat("topic", { at: 0.2, description: "Host topic card" });
  s.ellipse("stage-glow", { width: 1500, height: 640, fill: "#334155", opacity: 0.3, blur: 100,
    at: { x: 960, y: 320 } });                             // static frame-0 ink
  s.text("topic", "Inside the render loop", { size: 72, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "30%" }, enter: { effect: "blur-up", duration: 0.6 } });
  const A = { id: "a", name: "Maya Chen", title: "Render lead", accent: "#22d3ee", in: 0, out: 3.5 };
  s.beat("speaker-a-in", { at: A.in, description: "Speaker A third rises" });
  // bar + accent edge share the window; name/title ride 0.08s / 0.16s behind the bar
  s.rect("bar-a", { width: 760, height: 150, fill: "#111827", radius: 10,
    at: { x: 600, y: 864 }, in: A.in, out: A.out,
    enter: { effect: "slide-up", duration: 0.4, easing: "easeOutCubic", params: { distance: 60 } },
    exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
  s.rect("edge-a", { width: 10, height: 150, fill: A.accent, radius: 5,
    at: { x: 225, y: 864 }, in: A.in, out: A.out,
    enter: { effect: "slide-up", duration: 0.4, easing: "easeOutCubic", params: { distance: 60 } },
    exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
  s.text("name-a", A.name, { size: 60, weight: 800, color: "#f8fafc", align: "left",
    at: { x: 260, y: 825 }, in: A.in, out: A.out,
    enter: { effect: "slide-up", duration: 0.4, delay: 0.08, easing: "easeOutCubic", params: { distance: 60 } },
    exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
  s.text("title-a", A.title, { size: 34, color: "#94a3b8", align: "left",
    at: { x: 260, y: 895 }, in: A.in, out: A.out,
    enter: { effect: "slide-up", duration: 0.4, delay: 0.16, easing: "easeOutCubic", params: { distance: 60 } },
    exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
});
```

Rotation — the same layer group from a table (windows per the rotation table above):

```ts
const SPEAKERS = [
  { id: "b", name: "Iris Okafor", title: "QA architect", in: 3.3, out: 6.9, lift: true },
  { id: "c", name: "Tom Alvarez", title: "Agent runtime", in: 6.7, out: 10.0, lift: false },
];
for (const sp of SPEAKERS) {
  s.beat(`speaker-${sp.id}-in`, { at: sp.in, description: "Speaker third rises" });
  const rise = { effect: "slide-up", duration: 0.4, easing: "easeOutCubic", params: { distance: 60 } };
  const exit = sp.lift ? { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } : undefined;
  s.rect(`bar-${sp.id}`, { width: 760, height: 150, fill: "#111827", radius: 10,
    at: { x: 600, y: 864 }, in: sp.in, out: sp.out,
    enter: { ...rise }, ...(exit ? { exit } : {}) });
  s.text(`name-${sp.id}`, sp.name, { size: 60, weight: 800, color: "#f8fafc", align: "left",
    at: { x: 260, y: 825 }, in: sp.in, out: sp.out,
    enter: { ...rise, delay: 0.08 }, ...(exit ? { exit } : {}) });
  s.text(`title-${sp.id}`, sp.title, { size: 34, color: "#94a3b8", align: "left",
    at: { x: 260, y: 895 }, in: sp.in, out: sp.out,
    enter: { ...rise, delay: 0.16 }, ...(exit ? { exit } : {}) });
  // add the edge rect per speaker exactly like recipe 1
}
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — stage-glow ink.
- `expect(frame(30)).toContainText("Maya Chen")` — 1.0s: A fully in (0.4 + 0.16 + 0.4 < 1.0), mid-hold.
- `expect(frame(96)).not.toContainText("Iris Okafor")` — 3.2s: B's window opens at 3.3; windows are `[in, out)`, so assert strictly before the boundary.
- `expect(frame(120)).toContainText("Iris Okafor")` — 4.0s: B settled (3.3 + 0.08 + 0.4 = 3.78).
- `expect(frame(240)).toContainText("Tom Alvarez")` — 8.0s: C settled and holding to the end.
- `expect(scene("stage")).toHaveLayers("bar-a", "name-a", "title-a", "name-c", "title-c")`; `toHaveBeat("speaker-b-in")`.
- `durationBetween(8, 12)` on the host scene; `noTextOverflow()` — 60px names against the 760px bar.

## Anti-patterns

- The block crossing the bottom 10% — platform captions and stream controls paint there; the bar's bottom edge stays above y 939 on 1080p.
- Sinking exits (`slide-up`) while the successor rises — both bars travel through the same low pixels and tangle; lift out (`slide-down`) or serialize with a gap.
- Name and title at the same size — hierarchy dies; keep name ≥ 1.6× title (60 / 34).
- Titles longer than four words — the bar is 760px and v1 has no auto-wrap; abbreviate the role, never the name.
- Centered bars over an off-center speaker — thirds anchor opposite the face; ask for framing or default left.
- Demo scenes with an empty stage — a third floating on a bare background reads as broken; add stand-in content or embed into real footage.
