---
name: lower-thirds
version: 0.1.0
description: Lower-thirds - name/title bars that slide in from the title-safe left, dwell 3-5s, and slide out the way they came.
trigger: The user asks for name tags, speaker titles, interview overlays, chyron, "lower thirds", or name bars over footage or as standalone cards.
---

# Lower Thirds

Goal: 1920x1080 overlay scenes - one lower third = accent bar + name + role (optional: company), entering from the left inside the 5% title-safe margin, dwelling 3-5s, exiting the way it came. In VideoOS v1 these are self-contained scenes you composite over footage in an NLE (no alpha export yet), or inline scenes in a full VideoOS edit.

## Workflow

1. Collect per speaker: name, role, optional org, accent color. Confirm whether thirds replace each other (handoff) or coexist (stack with >= 60% screen separation - rarely fits, prefer handoff).
2. `storyboard.plan { intent: "<event> · speaker lower thirds" }` - one scene per speaker (or one scene with windows for a handoff, see Recipes).
3. Write `src/video.ts` with the canonical geometry (table below). Every layer of one third shares the same slide distance and easing - the plate, accent, and text travel as one rigid object.
4. `compile.run` -> 0 errors; `check.overflow` (names + roles on one plate).
5. `render.preview` at the settled beat (mid-dwell) - check the plate's left edge against the 96px safe margin and text legibility at 50% zoom (overlay readability test).
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

Geometry contract (1920x1080):

| Item | Value | Why |
| --- | --- | --- |
| Safe margins | 5% = 96px all sides | broadcast title-safe; nothing readable outside |
| Plate | 640-820 wide x 130-160 tall, bottom-left (x center ~460, y center ~810) | the classic third position |
| Name | 56-64px, weight 700, white | must read over any footage |
| Role | 34-40px, #8b8ba7 | 60-70% of name size - hierarchy |
| Accent bar | 10px wide, plate-height, #f59e0b | the color signature |
| Dwell | 3-5s per third (< 2 unreadable, > 6 stale) | read twice, then leave |
| Motion | slide-right in 0.45s / slide-right out 0.35s, distance 720 | in from the left edge, out the same way |

## Recipes

The canonical third - `slide-right` starts the layer 720px LEFT of its final center (off-screen) and settles it rightward; the SAME effect as `exit` drives it back left. Rigid group = identical distance/easing on every layer, text delayed 0.08s for a whisper of stagger:

```ts
v.scene("lt-speaker", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("in", { at: 0.2, description: "Name bar slides in from the left edge" });
  s.beat("out", { at: 4.6, description: "Bar retreats left; nothing else moves" });
  const SLIDE = 720; // off-screen start: plate center 460 - 720 = -260
  s.rect("plate", { width: 760, height: 150, fill: "#0a0a12", opacity: 0.55, radius: 8,
    at: { x: 460, y: 810 },
    enter: { effect: "slide-right", duration: 0.45, easing: "easeOutCubic", params: { distance: SLIDE } },
    exit: { effect: "slide-right", duration: 0.35, easing: "easeInCubic", params: { distance: SLIDE } } });
  s.rect("accent", { width: 10, height: 150, fill: "#f59e0b", at: { x: 92, y: 810 },
    enter: { effect: "slide-right", duration: 0.45, easing: "easeOutCubic", params: { distance: SLIDE } },
    exit: { effect: "slide-right", duration: 0.35, easing: "easeInCubic", params: { distance: SLIDE } } });
  // at is the layer CENTER - center text on the plate (x 470) and let the accent carry the left anchor
  s.text("name", "Mia Chen", { size: 60, weight: 700, color: "#ffffff", at: { x: 470, y: 782 },
    enter: { effect: "slide-right", duration: 0.45, delay: 0.08, easing: "easeOutCubic", params: { distance: SLIDE } },
    exit: { effect: "slide-right", duration: 0.35, easing: "easeInCubic", params: { distance: SLIDE } } });
  s.text("role", "Principal Engineer - Platform", { size: 36, color: "#8b8ba7", at: { x: 470, y: 845 },
    enter: { effect: "slide-right", duration: 0.45, delay: 0.14, easing: "easeOutCubic", params: { distance: SLIDE } },
    exit: { effect: "slide-right", duration: 0.35, easing: "easeInCubic", params: { distance: SLIDE } } });
});
```

Two-speaker handoff - one scene, windows instead of beats-per-third: A owns [0.2, 4.8], B enters [5.2, 9.6]; the 0.4s gap means no two thirds ever move at once:

```ts
v.scene("lt-handoff", { duration: 10 }, (s) => {
  const SPEAKERS = [
    { tag: "a", name: "Mia Chen", role: "Principal Engineer", in: 0.2, out: 4.8 },
    { tag: "b", name: "Ravi Patel", role: "Head of Platform", in: 5.2, out: 9.6 },
  ];
  for (const p of SPEAKERS) {
    s.beat(`third-${p.tag}`, { at: p.in, description: `${p.name} lower third` });
    s.rect(`plate-${p.tag}`, { width: 760, height: 150, fill: "#0a0a12", opacity: 0.55, radius: 8,
      in: p.in, out: p.out, at: { x: 460, y: 810 },
      enter: { effect: "slide-right", duration: 0.45, easing: "easeOutCubic", params: { distance: 720 } },
      exit: { effect: "slide-right", duration: 0.35, easing: "easeInCubic", params: { distance: 720 } } });
    s.text(`name-${p.tag}`, p.name, { size: 60, weight: 700, color: "#ffffff", in: p.in, out: p.out,
      at: { x: 470, y: 782 },
      enter: { effect: "slide-right", duration: 0.45, delay: 0.08, easing: "easeOutCubic", params: { distance: 720 } } });
    s.text(`role-${p.tag}`, p.role, { size: 36, color: "#8b8ba7", in: p.in, out: p.out,
      at: { x: 470, y: 845 },
      enter: { effect: "slide-right", duration: 0.45, delay: 0.14, easing: "easeOutCubic", params: { distance: 720 } } });
  }
});
```

## QA gates

- `expect(frame(30)).toContainText("Mia Chen")` - settles at 0.2 + 0.08 + 0.45 = 0.73s; assert at >= frame 24.
- Exit window: `expect(frame(144)).not.toContainText("Mia Chen")` - the exit completes by 5.0s (frame 150); assert one window-clear frame.
- Handoff ordering: `expect(frame(140)).not.toContainText("Ravi Patel")` (B enters at 5.2s = frame 156).
- `expect(scene("lt-speaker")).toHaveLayers("plate", "accent", "name", "role")`.
- `expect(scene("lt-speaker")).durationBetween(3, 5.5)` per third; `noTextOverflow()` (long roles truncate -> shorten the copy, never the size).
- Hand-frame check in `render.preview`: plate left edge >= 96px, bottom edge <= 984px (1080 - 96).

## Anti-patterns

- Entering from the right - lower thirds live bottom-LEFT; a right-entering third reads as an exit and disorients.
- Centered thirds - anchoring left is the convention; center belongs to titles.
- Different slide distances per layer - the third must travel as ONE object; mismatched distances shear it apart.
- Two thirds animating simultaneously (handoff gap < 0.3s) - motion overlap reads as a mistake; sequence A-out then B-in.
- Role text at name size - hierarchy collapses; role is always 60-70% and gray.
- Dwell < 2s or > 6s - unreadable vs. stale; 3-5s is the contract.
- Safe-margin violations - the 5% band is not decorative; platform and broadcast chrome eat it.
