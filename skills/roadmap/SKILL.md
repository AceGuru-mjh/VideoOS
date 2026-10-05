---
name: roadmap
version: 0.1.0
description: Roadmap and milestones - a horizontal timeline wipes left to right while nodes light up: amber shipped, white next, gray planned.
trigger: The user provides product milestones, quarterly plans, or a feature timeline and asks for a roadmap, milestones, "what ships when", or roadmap-review video.
---

# Roadmap

Goal: a 10-15s 1920x1080 roadmap in ONE continuous scene: the axis wipes left-to-right (the video's clock), 3-6 milestone nodes light up as the line reaches them, and the final act halos the next milestone. State colors are a contract: amber = shipped, white = next, gray = planned.

## Workflow

1. Collect milestones in order: { period tag, name, state } where state is shipped / next / planned - from the user's real plan. Only ONE "next". Dates missing? Ask - a roadmap with invented quarters is fiction.
2. `storyboard.plan { intent: "<product> · roadmap", durationSeconds: 12 }` - one scene, three acts (spine / lights / focus). Single-scene is the genre's signature: a timeline must not cut.
3. Write `src/video.ts`: static glow (frame-0 ink), axis rect with `wipe` enter, then the node loop (Recipes). Labels alternate above/below the axis - with >= 4 nodes, same-side neighbors are too close for 40px labels.
4. `compile.run` -> 0 errors; `check.overflow` (milestone names on 350px spacing).
5. `render.preview` at the spine beat, one mid-light frame, and the focus beat - verify each node's light lands as the wipe front reaches its x (easeInOutCubic front position is non-linear; nudge delays by preview, not by formula).
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Job | Dominant element |
| --- | --- | --- | --- |
| Spine | 0-2.5s | axis wipes Q1 toward the future | the growing line |
| Lights | 1-9s | nodes light in order as the front passes | node + label pairs |
| Focus | 9-12s | next milestone halos, status line settles | the white node + halo |

## Recipes

Spine + nodes - light delay spreads evenly across the wipe window; planned nodes FADE (no overshoot - they have not happened yet), shipped and next POP:

```ts
v.scene("map", { duration: 12, background: "#0a0a12" }, (s) => {
  s.beat("spine", { at: 0.2, description: "Axis wipes from the first shipped quarter toward the future" });
  s.beat("focus", { at: 9.0, description: "Next milestone halo + status line" });
  const MILESTONES = [
    { tag: "Q1", name: "Deterministic core", state: "shipped" },
    { tag: "Q2", name: "Agent tools", state: "shipped" },
    { tag: "Q3", name: "Skill library", state: "shipped" },
    { tag: "Q4", name: "Realtime collab", state: "next" },
    { tag: "Q5", name: "Cloud renders", state: "planned" },
  ];
  const X0 = 260, X1 = 1660, Y = 560, WIPE = 2.2; // axis from 260 to 1660 on y 560
  s.rect("glow", { width: 1100, height: 500, fill: "#6d28d9", opacity: 0.16, blur: 140, at: { x: 960, y: Y } });
  s.rect("axis", { width: X1 - X0, height: 6, fill: "#8b8ba7", opacity: 0.6, radius: 3,
    at: { x: (X0 + X1) / 2, y: Y },
    enter: { effect: "wipe", duration: WIPE, delay: 0.2, easing: "easeInOutCubic" } });
  const NEXT = MILESTONES.findIndex((m) => m.state === "next");
  const nextX = X0 + ((X1 - X0) * NEXT) / (MILESTONES.length - 1);
  s.ellipse("halo", { width: 240, height: 240, fill: "#6d28d9", opacity: 0.3, blur: 80,
    at: { x: nextX, y: Y }, in: 8.5, enter: { effect: "fade", duration: 0.6 } });
  for (const [i, m] of MILESTONES.entries()) {
    const x = X0 + ((X1 - X0) * i) / (MILESTONES.length - 1);
    const light = 0.2 + (WIPE * i) / (MILESTONES.length - 1); // evenly spread across the wipe window
    const color = m.state === "shipped" ? "#f59e0b" : m.state === "next" ? "#ffffff" : "#8b8ba7";
    const above = i % 2 === 0; // alternate label sides - same-side neighbors are 700px apart, not 350
    s.ellipse(`node-${i}`, { width: m.state === "next" ? 44 : 36, height: m.state === "next" ? 44 : 36,
      fill: color, opacity: m.state === "planned" ? 0.55 : 1, at: { x, y: Y },
      enter: m.state === "planned"
        ? { effect: "fade", duration: 0.4, delay: light }
        : { effect: "scale-pop", duration: 0.4, delay: light, easing: "easeOutBack" } });
    s.text(`tag-${i}`, m.tag, { size: 34, weight: 700, color: "#8b8ba7",
      at: { x, y: above ? Y - 160 : Y + 120 }, enter: { effect: "fade", duration: 0.4, delay: light + 0.3 } });
    s.text(`name-${i}`, m.name, { size: 40, weight: 600, color,
      at: { x, y: above ? Y - 96 : Y + 184 },
      enter: { effect: "slide-up", duration: 0.45, delay: light + 0.4, easing: "easeOutCubic", params: { distance: 30 } } });
  }
```

Focus act - status line names the next milestone and holds still (roadmaps get screenshotted into decks):

```ts
  s.text("status", "NEXT UP - Realtime collab, Q4", { size: 44, weight: 700, color: "#ffffff",
    at: { x: "50%", y: "80%" }, in: 9.0,
    enter: { effect: "slide-up", duration: 0.5, easing: "easeOutCubic", params: { distance: 40 } } });
  s.camera("push-in", { from: 1.0, to: 1.03 }); // one slow drift over the whole scene
});
```

State contract:

| State | Node | Label | Light-up |
| --- | --- | --- | --- |
| shipped | #f59e0b, 36px | white | scale-pop, easeOutBack (confident) |
| next | #ffffff, 44px + violet halo | white | scale-pop, then halo at the focus act |
| planned | #8b8ba7 at 0.55 | gray | fade only - no overshoot for things that have not happened |

## QA gates

- `expect(frame(0)).not.toBeBlack()` - glow is static ink.
- `expect(frame(90)).toContainText("Skill library")` - node 2 lights at 1.3s, its name settles at 1.3 + 0.4 + 0.45 = 2.15s (frame >= 65).
- Spoiler gate: `expect(frame(240)).not.toContainText("NEXT UP")` (status enters at 9.0s = frame 270) then `expect(frame(330)).toContainText("NEXT UP")`.
- `expect(scene("map")).toHaveLayers("axis", "node-0", "node-4", "halo", "status")`.
- `expect(scene("map")).durationBetween(10, 15)`; `noTextOverflow()` - names are 40px on 350px spacing.
- One-next check by hand: count `state: "next"` occurrences in the source - more than one and the halo lies.

## Anti-patterns

- More than 6 milestones - spacing drops under 280px and labels collide; split into "this year / next year" scenes instead.
- All labels on one side - at 5 nodes, 40px names on 350px spacing overlap; alternating is the fix.
- Every node amber - states must differ; a wall of shipped is a victory lap, not a roadmap.
- Planned nodes popping with overshoot - motion implies achievement; planned fades.
- Curved or organic timelines - v1 draws straight rects; fake curves with segmented rects if the user insists, or push back.
- Invented quarters/dates - ask; a roadmap is a promise, and promises have sources.
