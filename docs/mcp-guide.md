# MCP & VAP Guide

> Connect Claude Code, Claude Desktop, Cursor (or any MCP client) to a VideoOS project over stdio, and drive the full edit → compile → test → render loop through the 31 VAP tools — with transactional rollback when the agent gets it wrong.

VAP (Video Agent Protocol) is the tool layer every agent surface shares: the built-in agent (`videoos agent exec`), Studio's Agent panel, the REST/WS server, and MCP. MCP is just one transport over the same registry — [`packages/agent/src/vap/`](../packages/agent/src/vap/) defines the tools; [`packages/mcp`](../packages/mcp/src/index.ts) exposes them as an MCP stdio server (JSON-RPC 2.0, protocol versions `2025-03-26` / `2024-11-05`, server name `videoos`).

## 1. Starting the server

```bash
cd my-video
videoos mcp                          # stdio server bound to the current project
videoos mcp --project D:/videos/demo # explicit project root
```

`videoos mcp` **requires a project context** (a directory with `video.project.json`); v1 has no standalone mode. The server prints a one-line banner to stderr and then speaks JSON-RPC on stdin/stdout.

## 2. Client configuration

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "videoos": {
      "command": "videoos",
      "args": ["mcp", "--project", "D:\\videos\\demo"]
    }
  }
}
```

(Windows paths need doubled backslashes in JSON. On macOS/Linux use `/Users/you/videos/demo`.)

### Claude Code — `.mcp.json` in the project root (or repo root)

```json
{
  "mcpServers": {
    "videoos": {
      "command": "videoos",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/my-video"
    }
  }
}
```

`args: ["mcp"]` + `cwd` = project root is the recommended shape; `--project <path>` works everywhere and is the fallback for clients that don't support `cwd`. Register it non-interactively with:

```bash
claude mcp add videoos -- videoos mcp --project /absolute/path/to/my-video
```

### Cursor — `~/.cursor/mcp.json` (or `.cursor/mcp.json` per project)

```json
{
  "mcpServers": {
    "videoos": {
      "command": "videoos",
      "args": ["mcp", "--project", "/absolute/path/to/my-video"]
    }
  }
}
```

While VideoOS Studio (`videoos preview`) is running, you can keep an MCP client connected at the same time — Studio owns the HTTP/WS server on `127.0.0.1:4747`, the MCP server is a separate process; both operate on the same files and Studio live-reloads on external changes. Studio's Project panel shows the exact MCP command to copy.

## 3. VAP tool reference (31 tools; Studio chat Agent 另注册模板/知识工具族共 38 —— 见 docs/v0.2-agent-app.md §10)

Every tool validates input against a JSON schema, returns `{ ok, data }` or `{ ok: false, error }` (error strings are prefixed with a code like `SCENE_NOT_FOUND:`), and emits an audit event (`tool-call` / `tool-result`).

### Compile (3)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `compile.run` | Reload `src/video.ts`, compile → VIR/FramePlan/diagnostics; writes `.video/vir.json` | — |
| `compile.diagnostics` | Last compile's diagnostics (auto-compiles once if needed) | — |
| `compile.vir` | Full VIR JSON + per-scene summary (`name`, `duration`, `start`, `beats`, `layers`) — the agent's world model | — |

### Scene / Layer editing (5)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `scene.list` | Scene summaries (name/duration/start/layer names/beat names) + totalFrames | — |
| `scene.inspect` | One scene's full VIR + semantic frame range + beat→frame map | `scene` (name or id) |
| `scene.modify` | Source-anchored edit, writes entry + recompiles | `scene`, `operation`: `replace_text` \| `set_color` \| `set_duration` \| `set_animation`, `layer?`, `value` |
| `layer.inspect` | Layer VIR + its resolved FramePlan command at the scene's midpoint | `scene`, `layer` |
| `layer.modify` | Source-anchored property edit + recompile | `scene`, `layer`, `property`: `text` \| `color` \| `size` \| `opacity`, `value` |

`scene.modify` / `layer.modify` locate the `v.scene(...)` / `s.<layer>(...)` call in source and do a minimal replacement. If the anchor can't be found they return `PATTERN_NOT_FOUND` — the correct move is then to rewrite `src/video.ts` wholesale (as Engineer) rather than retry the edit.

### Assets & audio (4)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `asset.list` | Scan `assets/{images,audio,fonts}` + the VIR asset registry | — |
| `asset.add` | Write a file into `assets/<kind-dir>/<path>` (or verify it exists) | `path` (relative to `assets/`, no `..`), `contentBase64?`, `kind`: `image` \| `audio` \| `font` |
| `audio.list` | VIR audio clips + `assets/audio` file list | — |
| `audio.set` | Edit `v.audio("<clip>", …)` volume/fadeIn in source + recompile | `clip`, `volume?`, `fadeIn?` |

### Render & cache (7)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `render.preview` | Single-frame PNG (cache-first, hits < 5 ms) → `.video/diagnostics/preview_<n>.png` + base64 | `frame?` or `scene?` (+ `beat?` for the beat frame); default frame 0 |
| `render.range` | Closed frame range `[from, to]` → PNGs in `.video/diagnostics/frames/` (max 1000) | `from`, `to` |
| `render.final` | Full render → ffmpeg → MP4 in `.video/renders` (needs ffmpeg) | `scene?` (single-scene render) |
| `render.status` | Last `render.final` summary (path/frames/cache hits/duration) | — |
| `render.cancel` | v1 renders synchronously — reports `cancelled: false` | — |
| `cache.stats` | `.video/cache` entries/bytes per namespace | — |
| `cache.clear` | Delete the whole content-addressed cache | — |

### Test (2)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `test.run` | Run `tests/*.test.ts` collectors → full `QaReport` (+ `allPassed`, files) | — |
| `test.results` | Last report (error if never run) | — |

### Transactions (4)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `transaction.begin` | Snapshot `src/`, `assets/`, `tests/`, `video.project.json` → `.video/snapshots/<id>/` | `description?` |
| `transaction.commit` | Keep the changes (snapshot retained for diffing) | — |
| `transaction.rollback` | Atomically restore every snapshotted file (new files since `begin` are removed), then recompile | — |
| `transaction.list` | Transaction history (id/description/status) | — |

### Diagnostics (4)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `inspect.frame` | FramePlan for a frame: scene, background, camera, and every draw command with resolved absolute geometry | `frame` (clamped) |
| `diff.frames` | Render two frames → PNGs + per-pixel similarity (tolerance ±6/255) | `a`, `b` |
| `check.overflow` | Real-font `measureText` width vs `maxWidth ?? width−32` for all text layers → violations | — |
| `check.missingAssets` | VIR asset registry vs filesystem → missing files | — |

### Storyboard (2)

| Tool | Purpose | Key args |
| --- | --- | --- |
| `storyboard.plan` | Intent → shots (`id`/`name`/`start`/`duration`/`purpose`/`keyElement`). Deterministic template: <8 s → 4 shots, <20 s → 5, else 6; LLM generator can be injected server-side | `intent`, `durationSeconds`, `style?` |
| `storyboard.toScenes` | Shots → DSL code string (scene per shot, text layers, enter beats, adjacent crossfades). Returns code only — the agent decides to write it | `shots` (from `storyboard.plan`) |

## 4. The agent repair loop

The workflow every agent should follow (mirrors the built-in agent's system prompt and the transaction design — bad edits never need `git checkout`):

```text
1. compile.run                 → world model (scenes / beats / layers / diagnostics)
2. transaction.begin           → snapshot ("retitle CTA scene + fix overflow")
3. edit:  scene.modify / layer.modify / audio.set / rewrite src/video.ts
4. compile.run                 → must be error-free (diagnostics.errors == 0)
5. test.run                    → QaReport
   ├─ allPassed == true  → transaction.commit → (optional) render.final → done
   └─ failures           → read details (visibleTexts / overflows / similarity),
                           fix, back to 4 — up to manifest agent.maxRepairLoops (default 3)
                           then transaction.rollback and report the failure
```

Repair heuristics that work well:

- `toContainText` failure → check `visibleTexts`: wrong content (typo), wrong frame (assert before `in + delay + duration`), or layer invisible (`opacity ≤ 0.05`).
- `noTextOverflow` failure → `details.overflows[].measuredWidth` vs `limit` → shrink `size`, shorten copy, or add `maxWidth`.
- golden `similarity` slightly under threshold → verify the change is intended, then regenerate with `--update-golden` (or `updateGolden` QA option).
- `PATTERN_NOT_FOUND` from a modify tool → rewrite the file instead of hammering the same edit.

## 5. Model provider configuration (built-in agent)

`videoos agent exec` and Studio's Agent panel need a BYO-LLM provider. Configure via environment variables (see [`packages/agent/src/providers/config.ts`](../packages/agent/src/providers/config.ts)):

```bash
# VIDEOOS_PROVIDERS is a JSON array of provider configs
export VIDEOOS_PROVIDER_GLM_KEY=your-key
export VIDEOOS_PROVIDERS='[{"id":"glm","type":"openai-compatible","baseUrl":"https://open.bigmodel.cn/api/paas/v4","model":"glm-4.6"}]'

# OpenAI
export VIDEOOS_PROVIDER_OPENAI_KEY=sk-...
export VIDEOOS_PROVIDERS='[{"id":"openai","type":"openai-compatible","baseUrl":"https://api.openai.com/v1","model":"gpt-4o"}]'

# Anthropic (baseUrl WITHOUT /v1 — the provider appends /v1/messages)
export VIDEOOS_PROVIDER_ANTHROPIC_KEY=sk-ant-...
export VIDEOOS_PROVIDERS='[{"id":"anthropic","type":"anthropic","baseUrl":"https://api.anthropic.com","model":"claude-sonnet-4-5"}]'
```

| Provider entry field | Values / notes |
| --- | --- |
| `id` | used in `VIDEOOS_PROVIDER_<ID>_KEY` (uppercase, non-alphanumerics → `_`) |
| `type` | `openai-compatible` (GLM/OpenAI/DeepSeek/Qwen/any `/v1`-style endpoint) · `anthropic` · `manual` (scripted, for tests/demos) |
| `baseUrl` | full base incl. version segment for openai-compatible; **without** `/v1` for anthropic |
| `apiKey` | optional inline; env var is preferred |
| `model` | model id |
| `vision` / `tools` | capability flags for the Model Router |

Multiple providers in one array are fine — the Model Router picks per task (code / vision / fast) with fallback to any configured provider. `videoos doctor` reports what it sees.

Other environment variables:

| Variable | Effect |
| --- | --- |
| `FFMPEG_PATH` | explicit ffmpeg binary path; if set but invalid, detection **fails loudly** (no silent PATH fallback) |
| `NO_COLOR` | disable ANSI colors in CLI output |

## 6. Beyond MCP: REST/WS and CLI

The same tools are reachable without an MCP client:

```bash
videoos agent exec "把 CTA 场景标题改成 Ship it 并重新渲染"   # built-in agent, one instruction
curl -X POST http://127.0.0.1:4747/api/agent/tool -d '{"name":"compile.run","args":{}}'
```

`videoos serve` (default port `4747`) exposes the REST/WS API that Studio uses — see the [Studio guide](./studio-guide.md) and [getting started](./getting-started.md).
