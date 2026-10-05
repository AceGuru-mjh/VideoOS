---
name: news-brief
version: 0.1.0
description: Produce a vertical 9:16 news brief — amber kicker, typewriter headline, stacked story bullets, and a persistent timestamp.
trigger: The user asks for a news update, daily digest, announcement rundown, or "top stories" style short video for social feeds.
---

# News Brief

Goal: a 20–30s vertical brief (1080×1920, 30fps) that leads with one headline and pays off with 3–4 bullet stories — inverted-pyramid pacing in video form, safe-margin compliant per the short-video skill's chrome map (centers inside x ∈ [12%, 88%], y ∈ [14%, 80%]).

## Workflow

1. Fix the format in `defineVideo`: `width: 1080, height: 1920`. Collect: kicker (section + date, ≤ 24 chars), ONE headline (hard cap 70 chars — sweet spot ≤ 48, since typewriter duration ≈ 0.065s × chars and past 3s the reveal drags), 3–4 bullets (≤ 26 chars each), source line.
2. `storyboard.plan { intent: "news brief · <topic>", durationSeconds }` → remap onto headline → bullets → out; beats every 1.2–1.8s.
3. Write `src/video.ts` on the vertical grid: headline as ONE wrapped layer (`maxWidth: 840`, `lineHeight: 1.15`) — the typewriter then reveals it in reading order; bullets stacked 210px apart.
4. `compile.run` → 0 errors → `check.overflow` — at 1080 wide the wrapped headline is the most overflow-prone layer in the library; long headlines become stacked manual lines, never a smaller size.
5. `render.preview { scene, beat }` with the platform chrome in mind (top 14% and bottom 20% are UI territory).
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback`; `render.final` + the copy deck in the report.

## Recipes

Format + headline scene — kicker in amber caps, headline typed at reading speed:

```ts
export default defineVideo(
  { title: "Tech Brief — Mar 14", width: 1080, height: 1920, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    v.scene("headline", { duration: 7 }, (s) => {
      s.beat("kicker", { at: 0.15, description: "Section + date stamp" });
      s.beat("headline", { at: 0.8, description: "Typewriter headline reveal" });
      s.text("kicker", "TECH BRIEF · MAR 14", { size: 40, weight: 700, letterSpacing: 3, color: "#f59e0b",
        at: { x: 540, y: 384 }, enter: { effect: "fade", duration: 0.4 } });
      s.text("headline", "VideoOS ships agent-safe renders", { size: 88, weight: 800, color: "#ffffff",
        maxWidth: 840, lineHeight: 1.15, align: "center", at: { x: 540, y: 691 },
        enter: { effect: "typewriter", duration: 2.2, delay: 0.8, easing: "linear" } }); // 32 chars × 0.065s
      s.rect("rule", { width: 160, height: 6, fill: "#6d28d9", radius: 3, at: { x: 540, y: 960 },
        enter: { effect: "wipe", duration: 0.5, delay: 3.2 } });
    });
  },
);
```

Bullet stack — amber ticks pop, lines slide up behind them, 0.7s apart:

```ts
const bullets = ["Deterministic by default", "Frame-level QA in CI", "One-command rollback", "Docs rewritten for agents"];
for (const [i, b] of bullets.entries()) {
  s.rect(`tick-${i}`, { width: 16, height: 16, fill: "#f59e0b", radius: 4, at: { x: 150, y: 420 + i * 210 },
    enter: { effect: "scale-pop", duration: 0.4, delay: 0.3 + i * 0.7, easing: "easeOutBack" } });
  s.text(`bullet-${i}`, b, { size: 54, weight: 600, color: "#e2e8f0", maxWidth: 740, at: { x: 540, y: 420 + i * 210 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.3 + i * 0.7, params: { distance: 70 } } });
}
```

Timestamp — travels with the content, never pinned to the physical corner (platform chrome owns the top 14% / bottom 20%):

```ts
s.text("stamp", "MAR 14 · 09:41 UTC", { size: 34, weight: 600, letterSpacing: 2, color: "#8b8ba7",
  at: { x: 540, y: 1460 }, enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
```

Out scene (prose): source line at 44, "Follow for tomorrow's brief" in amber ≥ 64, `crossfade` 0.35 between all scenes.

## QA gates

- `toContainText` for kicker, the full headline (frame ≥ (0.8 + 2.2) × 30 after scene start), every bullet, and the stamp — typewriter text is invisible mid-reveal; assert after completion only.
- `expect(scene("bullets")).toHaveLayers("bullet-0", "bullet-1", "bullet-2", "bullet-3", "tick-0")`.
- `durationBetween`: headline 5–8, bullets 10–14; `noTextOverflow()` on every scene; `not.toBeBlack()` frame 0 (declare the glow without an `enter`).
- Manual gate: headline ≤ 70 chars in the source — an automated length gate does not exist in v1, so count before compiling.

## Anti-patterns

- Two headlines — one story leads; everything else is a bullet. Two leads = two videos.
- Headline past 70 chars — the typewriter becomes the whole video; trim to the verb and the noun.
- More than 4 bullets or bullets needing wraps — ≤ 26 chars each at size 54; a wrapped bullet is a paragraph.
- Timestamp in the physical corner — chrome eats it; travel with content at y ≤ 76%.
- Reusing 16:9 margins — 1080 wide is a different medium; stack, never side-by-side (see the short-video skill).
- Kinetic excess — briefs trade spectacle for trust; one typewriter, one stack, one stamp.
