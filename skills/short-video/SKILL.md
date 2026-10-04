---
name: short-video
version: 0.1.0
description: Vertical 9:16 short-form videos (1080×1920) with big type, platform-safe margins, and high beat density.
trigger: The user asks for a vertical / 9:16 / short-form / TikTok / Reels / Shorts / "竖屏" video, or says "short video" for social platforms.
---

# Short Video

Goal: a 15–30s vertical cut that survives platform chrome (captions, buttons, UI overlays) and reads at arm's length. Vertical is a different medium: one idea per beat, type does the acting.

## Workflow

1. Fix the format in `defineVideo`: `width: 1080, height: 1920, fps: 30` (9:16). Confirm target length 15–30s (sub-15s loops: 6–10s).
2. `storyboard.plan { intent, durationSeconds }` → shots; compress to 5–7 beats total (hook is sacred, see Recipes).
3. Write `src/video.ts` with the vertical layout rules: center column, safe margins, size ≥ 96 for anything that must be read.
4. `compile.run` → 0 errors → `check.overflow` (vertical means half the horizontal room — overflow risk doubles).
5. `render.preview` every beat — check the frame against the safe-margin diagram below (mentally add platform UI).
6. QA gates (below) → `test.run` → repair → `render.final`.

## Recipes

Format + vertical grid:

```ts
export default defineVideo(
  { title: "Short — Ship Video", width: 1080, height: 1920, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => { /* scenes */ },
);
```

| Rule | Value (1080×1920) | Notes |
| --- | --- | --- |
| Big type | `size ≥ 96` headlines, 56–72 body | phone-screen reading distance |
| Safe margins | 12% left/right (≥ 130px), top 14%, bottom 20% | platform UI eats edges — see diagram |
| Text column | x ∈ ["20%", "80%"], y ∈ ["14%", "80%"] | keep `at` centers inside this band |
| Line length | ≤ 18 characters per line at size 96 | split lines into separate layers, stacked 10–14% apart |
| Beat density | one beat per 1.0–1.8s (10–20 beats total) | faster cuts than 16:9; every 2–3s is already slow |
| Scene length | 1.5–4s | hooks ≤ 2s |

Safe-margin diagram (where platform UI lives — stay out):

```
┌───────────────┐ 1080
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒ │ ← top 14%: username, follow button, audio link
│ ┌───────────┐ │
│ │           │ │ ← SAFE: y 14%–80%, x 12%–88%
│ │   TEXT    │ │    big type, one idea per beat
│ │           │ │
│ └───────────┘ │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒ │ ← bottom 20%: captions, title/desc, like/comment/share rail
└───────────────┘ 1920
```

Hook (first 2s — the whole video):

```ts
v.scene("hook", { duration: 2 }, (s) => {
  s.beat("hook", { at: 0.15, description: "Pattern interrupt claim" });
  s.rect("glow", { width: 500, height: 500, fill: "#6d28d9", opacity: 0.25, blur: 110, at: { x: "50%", y: "35%" } });
  s.text("claim", "Shipping video", { size: 118, weight: 800, color: "#ffffff",
    at: { x: "50%", y: "35%" }, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.text("claim-2", "is now code", { size: 118, weight: 800, color: "#f59e0b",
    at: { x: "50%", y: "47%" }, enter: { effect: "slide-up", duration: 0.5, delay: 0.4, params: { distance: 80 } } });
});
```

Vertical stacking pattern (the 16:9 "list beside heading" dies in 9:16 — stack instead, 10–14% of height between rows):

```ts
const rows = ["write it", "compile it", "test it", "ship it"];
for (const [i, line] of rows.entries()) {
  s.text(`line-${i + 1}`, line, { size: 96, weight: 800, color: "#ffffff",
    at: { x: "50%", y: `${30 + i * 12}%` },
    enter: { effect: "slide-up", duration: 0.45, delay: i * 0.35, easing: "easeOutCubic", params: { distance: 90 } } });
}
```

Transitions: `crossfade` 0.3–0.4s (faster than 16:9 — momentum matters); `fade-black` between acts. Pacing: alternate a `scale-pop` beat with `slide-up` beats — pure slides in a row feel like a slideshow.

## QA gates

```ts
// vertical format contract
expect(scene("hook")).durationBetween(1.5, 2.5);            // hooks are short
// readability: hook text present after entrance (frame math vs. scene start!)
expect(frame(HOOK_SETTLED)).toContainText("Shipping video");
// structure + pacing
expect(scene("stack")).toHaveLayers("line-1", "line-2", "line-3", "line-4");
expect(scene("stack")).toHaveBeat("line-2-enter");
// ink + safety
expect(frame(0)).not.toBeBlack();
expect(scene("hook")).noTextOverflow();                      // catches safe-margin violations of the text block
expect(scene("stack")).noTextOverflow();
```

Extra manual gate QA can't do (v1 has no safe-area assertion): `render.preview` one settled frame per scene and check centers stay inside x ∈ [12%, 88%], y ∈ [14%, 80%] — `noTextOverflow` uses the full canvas width minus 32px, which is *looser* than platform-safe, so the margins are on you.

## Anti-patterns

- Reusing 16:9 layouts ("just rotate it") — vertical stacks; side-by-side dies at 1080 wide.
- Type under 96px for content that must be read — body at 56–72 minimum; captions-size text is decorative only.
- Text in the bottom 20% — platform caption/description UI renders over it.
- Long single-line strings — they overflow horizontally (half the width of 16:9): split into stacked layers.
- 16:9 pacing (4–6s scenes) — vertical audiences churn; keep beats every 1.0–1.8s.
- Slow entrances (blur-up 1.2s) — at 2s scenes the entrance IS the scene; cap entrances at 0.6s.
- Forgetting `not.toBeBlack()` ink at frame 0 — glow/decoration without `enter`, as always.
- Mixing aspect ratios in one project — the whole video is one `defineVideo` meta; pick 1080×1920 and commit.
