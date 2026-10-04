# product-promo

A 3-scene launch promo (11.0s · 1920×1080 · 30fps · 330 frames) built with the VideoOS DSL — zero external assets, fully deterministic.

## What it shows

| Scene | Duration | Techniques |
| --- | --- | --- |
| `title` | 4.0s | `blur-up` title + `fade` subtitle, blurred glow rect, `push-in` camera (1.0 → 1.08) |
| `features` | 5.0s | Kinetic feature list — one `slide-up` effect, staggered delays (0.3 / 0.9 / 1.5s), named beats per item |
| `cta` | 3.0s | `fade` headline + URL, crossfaded outro |

Scenes are joined with `crossfade` transitions (0.5s), so the timeline is
`title [0,4) · features [3.5,8.5) · cta [8,11)` — 11.0s total.

## Commands

```bash
videoos compile               # DSL → VIR (scene table + diagnostics in .video/)
videoos test                  # run the visual QA suite (tests/video.test.ts)
videoos render                # 330-frame MP4 → .video/renders/render-<hash>.mp4
videoos render --scene title  # render a single scene only
videoos preview               # open VideoOS Studio on this project
```

## QA suite highlights (`tests/video.test.ts`)

- `expect(frame(0)).not.toBeBlack()` — the glow rect is visible from frame 0.
- `expect(frame(180)).toContainText("01 · Deterministic pipeline")` — asserted only after the staggered `slide-up` completes (features-local 2.5s > last delay+duration 2.1s).
- `expect(scene("features")).toHaveBeat("item-two")` / `toHaveLayers(...)` — semantic timeline checks, zero rendering cost.
- `noTextOverflow()` on the densest scene.

The suite is intentionally golden-free (semantic + pixel-statistics only), so it passes on a fresh clone without `--update-golden`. Add `toMatchGolden` when you want pixel regression protection.
