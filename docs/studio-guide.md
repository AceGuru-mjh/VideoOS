# Studio Guide

> VideoOS Studio is the visual IDE over the same project the CLI uses: Monaco editor with live compile-on-save, a frame-accurate preview player, the semantic timeline, diagnostics/QA/agent panels, and a render monitor — served locally at `127.0.0.1:4747`.

## 1. Start Studio

```bash
cd my-video
videoos preview             # start server + open the browser (recommended)
videoos preview --port 4748 # different port
videoos serve               # API server only (REST + WS), no auto-open
```

`preview`/`serve` boot the same server (`packages/server`): REST API under `/api/*`, WebSocket at `/ws`, frame PNGs at `/api/frame/:n`, renders under `/renders/`, project assets under `/assets/`. When a Studio UI build exists (`apps/studio/dist`) it is served directly; in development run the Vite dev server on `5173`, which proxies `/api`, `/ws`, `/renders`, `/assets` to `127.0.0.1:4747`.

## 2. Layout tour

```
┌────────────────────────────────────────────────────────────────┐
│ TopBar: project · Compile · Render · Agent status              │
├──────────┬──────────────────────────────────┬──────────────────┤
│ Project  │  Editor (Monaco, src/video.ts)   │ Agent (chat +    │
│ Scenes   │                                  │  VAP event log)  │
│ Assets   ├──────────────────────────────────┤                  │
│ Tests    │  Preview (canvas player)         │                  │
│ MCP      ├──────────────────────────────────┤                  │
│          │  Timeline (scenes·beats·layers)  │                  │
├──────────┴──────────────────────────────────┴──────────────────┤
│ BottomDock: Diagnostics │ Tests │ Agent │ Events                │
├────────────────────────────────────────────────────────────────┤
│ StatusBar: compile · tests · render% · canvas·fps · ws · ver   │
└────────────────────────────────────────────────────────────────┘
```

### Project panel (left)

- **Scenes** — from the last VIR: names, durations, layer/beat counts; click to jump.
- **Assets** — `assets/{images,audio,fonts}` grid with thumbnails (served from `/assets/`).
- **Tests** — test files; click to open one in the editor.
- **Agent / MCP** — the exact `videoos mcp` command (copy button) and its `cwd`, so an external agent (Claude Code, Cursor…) can attach to the same project while Studio keeps running.

### Editor (Monaco)

- Full TypeScript with the real DSL/QA typings injected (`GET /api/typings`), so `defineVideo` / `s.text` / `expect(frame(n))` autocomplete.
- **Ctrl+S saves and recompiles** (PUT file → inline compile summary → diagnostics markers in the editor gutter). This is the loop: edit → Ctrl+S → watch preview/diagnostics update.
- Dirty-state tracking per tab; external edits (an MCP agent modifying files) are pulled in automatically unless your tab is dirty.

### Preview (center)

- Letterboxed canvas playing compiled frames from the server's frame cache (bitmap LRU + prefetch — seeking is near-instant on cached frames).
- Controls: play/pause, step ±1 frame, loop toggle, **element bounds overlay** (per-command bounding boxes + layer id labels; amber outlines, crosshair markers for text).
- Compilation changes invalidate the frame cache automatically and clamp the playhead.

### Timeline (below preview)

- Second-tick ruler + scene blocks positioned by `start`/`duration`; **transition overlaps render as striped regions**, beats as tick markers (hover for description, click to seek to that beat's frame).
- Drag or click the playhead to scrub; clicking a scene block seeks to its first frame.

### Agent panel (right, also a dock tab)

- Chat with the built-in agent (`videoos agent exec`'s executor) — requires a model provider, see the [MCP guide §5](./mcp-guide.md#5-model-provider-configuration-built-in-agent); an amber notice shows configuration help otherwise.
- Live VAP stream: every `tool-call` → `tool-result` pair with ok/error status, auto-scrolled.
- Direct tool invocation: pick any VAP tool from the dropdown, edit the JSON args, run it.

### BottomDock tabs

| Tab | Shows |
| --- | --- |
| **Diagnostics** | compile diagnostics with severity filter; click to reveal the offending line in the editor |
| **Tests** | run the QA suite (with/without update-golden), per-suite pass/fail cards, failure messages, golden vs actual vs diff image comparison (when available under `/renders/`), similarity/threshold chips |
| **Agent** | second instance of the agent chat, sharing state with the right panel |
| **Events** | the server event stream (compile / render progress / test-done / agent / VAP audit) with type filters |

### StatusBar (bottom)

One-glance health: compile errors/warnings (click → Diagnostics), tests passed/failed (click → Tests), last render + progress % (click → render result), canvas size · fps, WebSocket status, version.

## 3. The render dialog

TopBar → **Render** opens the dialog:

| Option | Values | Notes |
| --- | --- | --- |
| codec | `h264` (MP4) · `vp9` (WebM) | matches `videoos render --codec` |
| CRF | 0–51 slider, default 18 | ≤18 "high quality", ≥28 "small file" |
| preset | ffmpeg presets (`medium` default) | |
| scene | all scenes · one scene | single-scene renders like `--scene` |

Progress streams over the WS connection in three phases — Preparing → Rendering (frame N/M) → Encoding — and the finish page links the MP4 (served from `/renders/<basename>`) with cache hit/miss stats. Rendering runs as a **single background task**: starting another while one is active returns **409 busy** (see [troubleshooting](./troubleshooting.md#render-returns-409-busy-studio-api)).

## 4. Welcome screen

With no project open, Studio shows the welcome screen:

- **Open project** — absolute path to a `video.project.json` directory (Enter submits).
- **Init project** — creates a fresh project from the template in place.
- **Recents** — up to 8 recently opened projects, persisted in `localStorage` (`videoos.recents`).

## 5. Keyboard shortcuts & interactions

| Shortcut / interaction | Effect |
| --- | --- |
| `Ctrl+S` / `⌘S` (editor focus) | save + recompile + refresh diagnostics |
| Editor dirty dot | unsaved changes; the tab won't be clobbered by external edits |
| Timeline beat click | seek to the beat's exact frame |
| Timeline scene click | seek to scene start |
| Preview bounds toggle | overlay per-layer bounding boxes (visual debugger) |

## 6. Connecting external agents while Studio runs

Studio is just another client of the same project directory:

1. Copy the MCP command from the Project panel (`videoos mcp --project <root>` or plain `videoos mcp` in the project cwd).
2. Register it in your agent's config — see the [MCP guide](./mcp-guide.md#2-client-configuration).
3. Both processes coexist: the agent edits files transactionally; Studio detects external file changes, recompiles, refreshes the preview/timeline, and streams the agent's VAP events into the Events tab when the agent runs through the Studio server.

That's the intended day-2 workflow: Studio open on a second monitor for visual ground truth, the coding agent driving edits over MCP or `videoos agent exec`.
