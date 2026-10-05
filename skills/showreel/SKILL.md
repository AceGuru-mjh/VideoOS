---
name: showreel
version: 0.1.0
description: Fast-cut portfolio reel (12-18s, 15s sweet spot): 1s declaration hook, ~2s per work with progress dots, and a closer frame that echoes the hook.
trigger: The user wants a showreel, portfolio cut, demo reel, or works montage - several projects packed into one short video.
---

# Showreel

Goal: a 12-18s reel (15s is the golden length - the hottest duration category in the source research) that opens with a 1s declaration hook ("5 products. 15 seconds."), gives every work a ~2s slot (name + one result + progress dots), and closes on a 2s frame that echoes the hook. The counter is the tension: the viewer stays to see if all five fit.

## Workflow

1. Collect the works: name plus ONE result line each, with a unit ("3x faster CI", not "3x") - refuse to invent metrics. Order strongest first (attention decays), keep the arc for the closer.
2. Fix the total (15s default; 12-18 allowed) and compute the slots: works N = round((total - 3s) / 2.4s); slot = (total - 3) / N - so 15s -> 5 works at 2.4s, 12s -> 4 at 2.25s, 18s -> 6 at 2.5s.
3. Write `src/video.ts`: hook scene 1s (declaration `scale-pop`, readable by 0.8s - the hook-forge contract; the count in the copy must match the real slot count), work slots from the Recipes loop, closer 2s echoing the hook.
4. `compile.run` -> 0 errors; then `check.overflow` - 96px work names are the overflow-est elements in the genre.
5. `render.preview` every slot boundary - the cuts are the rhythm: alternate `scale-pop` and `slide-up` entrances slot to slot so the reel never feels like a slideshow.
6. `test.run` with the gates below; repair loop of at most 3 via `scene.modify`; then `render.final`.
7. Hand off: a 9:16 deliverable re-anchors via the aspect-reframe skill (progress dots move into the bottom safe band); a CTA tail loads the end-card skill; a longer, per-work deep dive is a product-demo per work, not a longer reel.

Slot anatomy (per work, 2.0-2.6s): index text "03 / 05" top (fade 0.25s), name at 96px+ `scale-pop` (the beat), result line 48px `slide-up` 0.3s behind it, and the full progress dot row with the current dot lit (bigger + accent fill). Background alternates between two dark hexes so hard cuts read as deliberate beats.

## Recipes

Declaration hook - count + duration promise, readable within 0.8s:

```ts
v.scene("hook", { duration: 1 }, (s) => {
  s.beat("declare", { at: 0, description: "5 products, 15 seconds - readable by 0.8s" });
  s.rect("ink", { width: 760, height: 300, fill: "#f59e0b", opacity: 0.18, blur: 120,
    at: { x: "50%", y: "44%" } });
  s.text("declare", "5 products.\n15 seconds.", { size: 100, weight: 800, color: "#f8fafc",
    lineHeight: 1.1, at: { x: "50%", y: "44%" },
    enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutBack" } });
});
```

Work slots + progress dots - the loop is the skill's core (join consecutive slots with `v.transition("cut", ...)` - cuts, never crossfades; the reel's rhythm is the cut):

```ts
const works = [
  ["Flowcast", "timeline in 8s, not 8h"],
  ["Gridplot", "3x faster chart QA"],
  ["Vapshot", "0 unasserted frames"],
  ["Subforge", "20 CPS-safe captions"],
  ["Reelbase", "1 master, 5 cuts"],
];
for (const [i, work] of works.entries()) {
  const [name, result] = work;
  v.scene(`work-${i + 1}`, { duration: 2.4, background: i % 2 ? "#05070d" : "#0a0a12" }, (s) => {
    s.beat("land", { at: 0.4, description: "Name + result readable" });
    s.text("idx", `0${i + 1} / 0${works.length}`, { size: 40, color: "#f59e0b", letterSpacing: 3,
      at: { x: "50%", y: "24%" }, enter: { effect: "fade", duration: 0.25, delay: 0.15 } });
    s.text("name", name, { size: 96, weight: 800, color: "#f8fafc",
      at: { x: "50%", y: "42%" },
      enter: { effect: "scale-pop", duration: 0.4, delay: 0.1, easing: "easeOutBack" } });
    s.text("result", result, { size: 48, color: "#7dd3fc",
      at: { x: "50%", y: "58%" }, enter: { effect: "slide-up", duration: 0.35, delay: 0.3, params: { distance: 60 } } });
    for (let d = 0; d < works.length; d++) {
      const lit = d === i;
      s.ellipse(`dot-${d + 1}`, { width: lit ? 22 : 12, height: lit ? 22 : 12,
        fill: lit ? "#f59e0b" : "#334155",
        at: { x: `${50 + (d - (works.length - 1) / 2) * 4}%`, y: "82%" } });
    }
  });
}
```

Closer - echoes the hook's promise, then holds still (end-card pattern):

```ts
v.scene("closer", { duration: 2 }, (s) => {
  s.beat("echo", { at: 0.4, description: "Receipt of the hook; still for the last 0.8s" });
  s.text("echo", "That was 15 seconds.", { size: 84, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "42%" }, enter: { effect: "blur-up", duration: 0.4 } });
  s.text("contact", "github.com/AceGuru-mjh/VideoOS", { size: 40, color: "#8b8ba7",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
});
```

## QA gates

- Hook: `expect(frame(24)).toContainText("5 products.")` - the declaration is readable by 0.8s, and its count matches the actual slot count (a false count fails review even if it renders).
- Every work: `toContainText` for name and result at frames at or past entrance completion; `toHaveLayers("name", "result", "idx", "dot-1", ..., "dot-5")` per slot.
- Rhythm: each work scene `durationBetween(1.8, 2.6)`; total 12-18s (1 + N x slot + 2).
- Progress integrity: dot names dot-1..dot-N present in every slot; the current index lit (bigger size, accent fill) - the sequence is the retention device.
- Closer receipt: `toContainText("That was 15 seconds.")` (or the true total) - the hook promised, the closer receipts; final 0.8s still, no exits anywhere.
- `expect(frame(0)).not.toBeBlack()`; `noTextOverflow()` plus `check.overflow` on every slot (96px names).

## Anti-patterns

- Opening with a logo or reel title - the declaration ("N products, T seconds") is a promise that buys the next 14s; brand identity arrives in the closer.
- Slots over 3s - that is a portfolio piece, not a reel; per-work rhythm (~2s) is the retention device the research found in the hottest cuts.
- Metrics without units ("3x", "50%") - unanchored numbers read as decoration; "3x faster CI" carries the claim.
- Dropping the progress indicator - viewers lose count and disengage; the running counter is the tension that holds attention to the end.
- Crossfades between works - dissolves bleed slots into mush; the reel's rhythm is the cut (short-video transition rule).
- Best work last with no closer - ends flat exactly when attention peaks; the echo close is the payoff, and it needs its 2s.
