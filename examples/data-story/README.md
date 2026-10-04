# data-story

An animated bar chart (9.0s · 1280×720 · 30fps · 270 frames) built from pure `rect`/`text` layers — zero assets, deterministic, and a textbook case for the slide-up "bar growth" pattern.

## What it shows

| Scene | Duration | Techniques |
| --- | --- | --- |
| `chart` | 6.5s | 4 bars growing with different easings (`linear` / `easeOutCubic` / `easeOutExpo` / `bounce`), staggered value labels fading in, x-axis + weekday labels |
| `takeaway` | 3.0s | `typewriter` takeaway line + `fade` subline |

**Bar growth trick** (no `grow-height` effect needed): each bar's final center sits on the baseline and its `slide-up` enter uses `params.distance = bar height`, so at `t=0` the bar is entirely below the baseline. A background-colored `mask` rect declared *after* the bars paints over everything below the baseline (painter's order), so the visible portion above the axis grows `0 → h` exactly like a real chart animation.

## Commands

```bash
videoos compile               # DSL → VIR (scene table + diagnostics in .video/)
videoos test                  # run the visual QA suite (tests/video.test.ts)
videoos render                # 270-frame MP4 → .video/renders/render-<hash>.mp4
videoos render --crf 20       # smaller file, slightly lower quality
videoos preview               # open VideoOS Studio on this project
```

## QA suite highlights (`tests/video.test.ts`)

- `expect(scene("chart")).toHaveLayers("bar-1", "bar-2", "bar-3", "bar-4")` — the bars exist as rect layers (semantic, zero render).
- `expect(frame(105)).toContainText("7.6")` — value labels are only asserted at chart-local 3.5s, after the last label fade (2.6 + 0.5s) completes.
- `expect(frame(105)).not.toBeBlack()` — settled chart has plenty of ink.
- `expect(frame(240)).toContainText("Determinism turns data into story.")` — asserted after the typewriter finishes (takeaway-local 1.4s < 2.0s).
