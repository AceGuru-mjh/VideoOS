# code-walkthrough

A "CLI session that types itself" (9.0s · 1280×720 · 30fps · 270 frames) — a terminal window mock drawn entirely with `rect`/`ellipse`/`text` layers, plus a caption outro. Zero assets.

## What it shows

| Scene | Duration | Techniques |
| --- | --- | --- |
| `terminal` | 6.5s | Window body + title bar rects, three traffic-light ellipses, five monospace lines typed with staggered `typewriter` enters (prompt lines blue, `ok` lines green), static block cursor |
| `caption` | 3.0s | `blur-up` takeaway + `fade` subline |

Line typing windows are staggered so the session reads like a real shell: `line-1` finishes at 1.1s, `line-2` at 2.5s, `line-3` at 3.4s, `line-4` at 4.7s, `line-5` at 5.8s — all inside the 6.5s scene.

## Commands

```bash
videoos compile               # DSL → VIR (scene table + diagnostics in .video/)
videoos test                  # run the visual QA suite (tests/video.test.ts)
videoos render                # 270-frame MP4 → .video/renders/render-<hash>.mp4
videoos render --scene caption # render only the caption scene
videoos preview               # open VideoOS Studio on this project
```

## QA suite highlights (`tests/video.test.ts`)

- `expect(frame(0)).not.toBeBlack()` — the window chrome (rect + ellipses) has no enter animation, so it is visible from the first frame.
- `expect(frame(90)).toContainText("$ videoos compile")` — asserted after line-1 completes typing (0.4 + 0.7s = 1.1s < 3.0s).
- `expect(frame(90)).not.toContainText("$ videoos test")` — at terminal-local 3.0s, line-3 has only typed 10 of 14 characters; a mid-typing negative assertion that pins the typewriter semantics.
