# Getting Started

> From zero to a deterministic, QA-tested MP4 in five minutes — `videoos init` → compile → test → render, with Studio as the visual alternative to the CLI.

If you have never seen the VideoOS model (DSL → VIR → Render → Visual QA), skim [the DSL reference](./dsl-reference.md) first; every concept used below (`scene` / `beat` / `enter` / `transition`) is defined there.

## 1. Install

### Windows installer

Download the latest NSIS installer from [GitHub Releases](https://github.com/AceGuru-mjh/VideoOS/releases) and run it. The installer ships the CLI (`videoos`), the Studio server, and the Electron desktop shell; it checks for `ffmpeg` at first launch (see [Troubleshooting](./troubleshooting.md#ffmpeg-not-found) if it is missing).

### From source (any OS)

VideoOS is a bun workspace monorepo. You need [bun](https://bun.sh) ≥ 1.3 and `git`:

```bash
git clone https://github.com/AceGuru-mjh/VideoOS.git
cd VideoOS
bun install

# build the CLI once, then put it on PATH (or call it via bun)
bun run --filter @videoos/cli build
```

Requirements and environment checks:

```bash
videoos doctor    # runtime, ffmpeg, canvas/zod, current project, model providers
ffmpeg -version   # encoding needs ffmpeg; see troubleshooting if absent
```

Everything except final MP4 encoding works without `ffmpeg` (compile, preview, QA).

## 2. Your first video (5 minutes)

### 2.1 Create a project

```bash
videoos init my-video
cd my-video
```

`init` writes the full project layout (see [Project anatomy](#3-project-anatomy)) including a working two-scene example (`intro` + `outro`, 6.0s · 1920×1080 · 30fps).

### 2.2 Compile

```bash
videoos compile
```

Output (abridged):

```
场景（2）：
  name     duration   frames   beats
  intro    3.50s     105      title-enter, subtitle-enter
  outro    3.00s     90       repo-show
  合计：6.00s / 180 帧 / 1920×1080 @ 30fps

✓ 诊断：无（0 error / 0 warning）
VIR → my-video/.video/vir.json
```

The DSL entry `src/video.ts` compiles to VIR (`.video/vir.json`), a render graph, and diagnostics. Any `error`-level diagnostic fails the command.

### 2.3 Test

```bash
videoos test
```

Runs the visual QA suite in `tests/video.test.ts` — assertions like `expect(frame(30)).toContainText("Hello VideoOS")`. Exit code 1 on any failure. See the [QA guide](./qa-guide.md).

### 2.4 Render

```bash
videoos render              # → .video/renders/render-<virhash>.mp4
videoos render --scene intro # single scene only
```

First render rasterizes every frame (~0.6 ms/frame rasterization at 1080p, PNG encoding on top, then ffmpeg); a second render of unchanged code is near-instant — every frame is a cache hit.

### 2.5 Studio instead of CLI

```bash
videoos preview             # start Studio (127.0.0.1:4747) and open the browser
videoos serve               # API server only (REST + WS), no browser
```

Studio gives you a live preview player, the semantic timeline, diagnostics, the QA panel, and the Agent panel — see the [Studio guide](./studio-guide.md). Studio and the CLI operate on the same project; external agents can connect over MCP while Studio runs.

## 3. Project anatomy

```
my-video/
├── video.project.json     # manifest: name / entry / engines / render / agent
├── src/
│   ├── video.ts           # DSL entry — export default defineVideo(...)
│   └── scenes/            # optional scene modules
├── assets/
│   ├── images/  ├── audio/  └── fonts/   # fonts register by filename (family = name minus extension)
├── tests/
│   ├── video.test.ts      # visual QA suite (@videoos/qa)
│   └── golden/            # golden baseline PNGs (generate with --update-golden)
└── .video/                # generated — safe to gitignore
    ├── vir.json           # compiled VIR (machine-readable, diffable)
    ├── graph.json
    ├── cache/             # content-addressed frame cache
    ├── renders/           # final MP4/WebM outputs
    ├── snapshots/         # transaction snapshots (agent rollback)
    ├── diagnostics/       # compile diagnostics + agent preview PNGs
    └── memory/            # agent project/failure memory
```

| Field in `video.project.json` | Meaning |
| --- | --- |
| `name` | project name (shown in Studio/CLI) |
| `entry` | DSL entry relative to project root, default `src/video.ts` |
| `engines.videoos` | engine constraint, currently `^0.1` |
| `render` | `{ defaultBackend: "canvas", encoder: "ffmpeg" }` |
| `agent` | `{ autonomous: true, maxRepairLoops: 3 }` |

## 4. Where renders live

| Artifact | Path | Notes |
| --- | --- | --- |
| Final video | `.video/renders/render-<virHash12>.mp4` | name is content-addressed; re-render of identical code overwrites idempotently |
| Single-scene render | `.video/renders/render-<virHash12>-f<from>-t<to>.mp4` | `videoos render --scene intro` or `render.final { scene }` |
| Frame cache | `.video/cache/frames/<aa>/<bb>/<key>.png` | key = SHA-256(virHash + backend + version + frame + size) |
| Agent frame previews | `.video/diagnostics/preview_<n>.png` | `render.preview` / VAP |

Copy a render elsewhere with `videoos render --output path/to/file.mp4`.

## 5. Learn from the examples

The repo ships four runnable example projects — each is a complete project (manifest + entry + QA suite) you can open, test, and render as-is:

| Example | Shows | Link |
| --- | --- | --- |
| `product-promo` | 3-scene launch promo: blur-up title card + push-in camera, staggered kinetic list, crossfaded CTA | [`examples/product-promo`](../examples/product-promo/README.md) |
| `kinetic-typography` | typewriter + every directional slide/scale move | [`examples/kinetic-typography`](../examples/kinetic-typography/README.md) |
| `data-story` | animated bar chart from pure rect layers (bar-growth trick) | [`examples/data-story`](../examples/data-story/README.md) |
| `code-walkthrough` | terminal window mock, self-typing CLI session, caption outro | [`examples/code-walkthrough`](../examples/code-walkthrough/README.md) |

## 6. Next steps

- [DSL reference](./dsl-reference.md) — every option, effect, easing, and rule.
- [QA guide](./qa-guide.md) — assertion cookbook and golden workflow.
- [MCP guide](./mcp-guide.md) — connect Claude Code / Claude Desktop / Cursor as the editing agent.
- [Studio guide](./studio-guide.md) — panels, shortcuts, render dialog.
- [Troubleshooting](./troubleshooting.md) — doctor, ffmpeg, fonts, cache, 409s.
