# kinetic-typography

A text-motion showcase (7.6s · 1280×720 · 30fps · 228 frames) demonstrating `typewriter` reveals and every directional move — zero assets, deterministic.

## What it shows

| Scene | Duration | Techniques |
| --- | --- | --- |
| `typewriter` | 4.0s | Two `typewriter` lines (monospace) with a delayed second line; warm glow ellipse keeps frame 0 non-black |
| `moves` | 4.0s | `scale-pop` heading (`easeOutBack`) + `slide-up` / `slide-left` / `slide-right` labels with staggered delays and `distance` params |

The `typewriter` effect slices `content` to `ceil(len · easing(t))` per frame — that's why the QA suite asserts the *full* line only **after** `delay + duration` has elapsed (frame 60 for line 1, frame 105 for line 2), and asserts `not.toContainText` at frame 0 where zero characters are visible.

## Commands

```bash
videoos compile                 # DSL → VIR (scene table + diagnostics in .video/)
videoos test                    # run the visual QA suite (tests/video.test.ts)
videoos render                  # 228-frame MP4 → .video/renders/render-<hash>.mp4
videoos render --codec vp9      # WebM/VP9 instead of MP4/H.264
videoos preview                 # open VideoOS Studio on this project
```

## QA suite highlights (`tests/video.test.ts`)

- `expect(frame(0)).not.toContainText("TYPE IS MOTION.")` — typewriter has typed 0 of 15 characters at frame 0.
- `expect(frame(105)).toContainText("Every character lands on a beat.")` — second line finishes typing at local 3.2s; asserted at 3.5s.
- `expect(scene("moves")).toHaveLayers("pop", "up", "left", "right")` — layer presence, zero rendering cost.
