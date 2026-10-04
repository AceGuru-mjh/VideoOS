# .tmp-demo/demo

A [VideoOS](https://github.com/AceGuru-mjh/VideoOS) project:
**DSL → VIR → Render → Visual QA** (deterministic, agent-native video).

## Directory layout

| Path | Purpose |
| --- | --- |
| `src/video.ts` | Video entry (`defineVideo` from `@videoos/dsl`) |
| `src/scenes/` | Optional scene modules |
| `assets/{images,audio,fonts}/` | Static assets |
| `tests/video.test.ts` | Visual QA suite (`@videoos/qa`) |
| `tests/golden/` | Golden baseline images |
| `.video/` | Generated: `vir.json`, `graph.json`, `cache/`, `snapshots/`, `renders/`, `memory/` — safe to gitignore |

## Commands

```bash
videoos compile               # DSL → VIR (.video/vir.json + diagnostics)
videoos preview               # open VideoOS Studio
videoos render                # render final MP4 into .video/renders/
videoos test                  # run the visual QA suite
videoos test --update-golden  # (re)generate golden baselines
```
