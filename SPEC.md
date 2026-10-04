# VideoOS Specification

> **VideoOS — The Agent-Native Video IDE & Compiler**
> 面向 AI Agent 的视频编程操作系统
>
> Status: `v0.1 · Active Development` · Spec version: `1.0`
> 本文档是 VideoOS 的唯一权威规格（Single Source of Truth）。所有实现必须与本文档对齐。

---

## 0. 愿景与定位

### 0.1 一句话定位

> **A programmable video runtime for AI agents.**
> 给 AI Agent 使用的视频编程环境。

VideoOS **不是**「AI + 视频编辑器」，而是一个新的软件类别：

```text
Agent-native Video IDE / Video Compiler（面向 Agent 的视频编程操作系统）
```

### 0.2 核心公式

```text
Creative Intent
  → Story Graph → Shot Graph          (Storyboard IR)
  → Video Program (DSL)               (Agent 写代码)
  → Video AST → VIR                   (编译器)
  → Render Graph                      (执行计划)
  → Render Runtime                    (Canvas / SVG / Remotion / FFmpeg)
  → Frame Cache                       (内容寻址缓存)
  → Visual QA                         (帧测试 / golden diff / 语义断言)
  → PASS → Export / FAIL → Agent Fix ↺
```

**Agent 不直接"操纵视频"。Agent 编写/修改视频程序 → VideoOS 编译 → 渲染 → QA 判定 → Agent 根据结果继续修改。**

### 0.3 差异化（护城河）

| 竞品 | 他们做的 | VideoOS 做的 |
|---|---|---|
| Remotion | React 代码生成视频 + Agent Skills | 复用其作为**可选后端**；核心自研 VIR/编译器 |
| Agent Motion | 给 Agent 的视频组件库 | 复用生态位；VideoOS 提供更底层的 IR + QA Runtime |
| OpenChatCut | Agent 操作真实时间线 | VideoOS 用语义时间线 + 代码作为 source of truth |
| AI 视频生成器 | 文生视频 | **不是**竞品；VideoOS 是确定性编程式视频 |

五大绝对核心（工程价值排序）：
1. **VIR**（Video Intermediate Representation）
2. **Render Graph + 增量渲染缓存**
3. **VAP**（Video Agent Protocol / Agent Tool API）
4. **Visual Test / Visual Debugger**
5. **Agent Runtime**（多 Agent + Model Router + 事务）

### 0.4 MVP 闭环（第一版必须证明）

```text
Agent
 ↓ create project
 ↓ write video code (DSL)
 ↓ compile → VIR
 ↓ preview (frame cache)
 ↓ render → frames → ffmpeg → MP4
 ↓ inspect frames (语义 + 像素)
 ↓ visual test (PASS/FAIL)
 ↓ fix (事务，可回滚)
 ↓ final MP4
```

---

## 1. 总体架构

```text
                         ┌─────────────────────────────┐
                         │        Agent Layer           │
                         │ Codex / Claude / OpenCode    │
                         │ Built-in Agent / MCP / CLI   │
                         └──────────────┬──────────────┘
                                        │  VAP (Video Agent Protocol)
                                        │  MCP / REST / WS / CLI
                         ┌──────────────▼──────────────┐
                         │       Agent Runtime          │
                         │  Planner/Director/Engineer   │
                         │  Model Router · Memory       │
                         │  Transaction · World State   │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────▼──────────────┐
                         │       Video Compiler         │
                         │  DSL → AST → VIR → Graph     │
                         └──────────────┬──────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
      ┌───────▼───────┐         ┌──────▼───────┐         ┌──────▼──────┐
      │ Canvas Backend │         │ SVG Backend  │         │ FFmpeg      │
      │ (@napi-rs)     │         │ (vector)     │         │ (encode)    │
      │ Remotion (可选) │         │ Chromium(可选)│        │ WebCodecs   │
      └───────┬───────┘         └──────┬───────┘         └──────┬──────┘
              │                         │                         │
              └─────────────────────────┼─────────────────────────┘
                                        │
                              ┌─────────▼────────┐
                              │ Content-Addressed │
                              │ Cache (frame/scene)│
                              └─────────┬────────┘
                                        │
                              ┌─────────▼────────┐
                              │  Visual QA Engine │
                              │ 语义断言·像素diff │
                              └─────────┬────────┘
                                        │
                              ┌─────────▼────────┐
                              │ Final Render      │
                              │ MP4 / WebM / PNG  │
                              └──────────────────┘
```

### 1.1 Windows 桌面形态（M9）

```text
Windows App (Electron, NSIS 安装包)
  ├── UI Layer:  React + WebView(Chromium) + Monaco + Canvas Preview
  ├── Native Sidecar: Node 进程（Agent Runtime + Compiler + Server）
  ├── IPC:  local HTTP + WebSocket (127.0.0.1)
  └── 系统能力: ffmpeg 检测/捆绑、GPU 检测、文件系统
```

> 原方案建议 Rust Core + WebView2。MVP 采用 **Node Sidecar + Electron**（生态成熟、可立即交付），
> 架构上通过 `packages/server` 的 REST/WS API 隔离 UI 与核心，未来可将核心替换为 Rust 实现而不动 UI。

### 1.2 代码仓库结构（monorepo，bun workspaces）

```text
VideoOS/
├── packages/
│   ├── core/          # 共享基础：seeded RNG、easing、color、geometry、时间工具
│   ├── vir/           # VIR schema (zod) + 校验 + 图（spatial/temporal/dependency）
│   ├── dsl/           # 视频 DSL 构建器（scene().text().enter().camera()）
│   ├── compiler/      # DSL → AST → VIR → RenderGraph + 诊断
│   ├── render-canvas/ # 参考渲染后端（@napi-rs/canvas，Skia）
│   ├── render-svg/    # SVG 矢量渲染后端
│   ├── cache/         # 内容寻址缓存（SHA-256）
│   ├── encode/        # ffmpeg 编码器 + PNG 序列回退
│   ├── qa/            # 视觉测试框架（语义断言 + golden diff）
│   ├── workspace/     # 项目文件系统 + 事务（snapshot/commit/rollback）
│   ├── agent/         # Agent Runtime + Model Providers + VAP 工具
│   ├── mcp/           # MCP Server（stdio JSON-RPC）
│   └── server/        # 本地 API 服务器（REST + WS，Studio 后端）
├── apps/
│   ├── cli/           # videoos 命令行
│   ├── studio/        # VideoOS Studio（React IDE）
│   └── desktop/       # Electron Windows 壳
├── examples/          # 示例项目（产品宣传视频、字幕卡、数据动画）
├── skills/            # Agent Skills 库（SKILL.md + 模板 + 脚本）
├── docs/              # 架构文档
└── SPEC.md            # 本文档
```

---

## 2. VIR — Video Intermediate Representation

### 2.1 设计原则

1. **机器可读可 diff**：纯 JSON，schema 版本化（`virVersion`）
2. **语义优先**：场景/节拍命名，而非帧号；帧号由编译器推导
3. **确定性**：相同 DSL 输入 → 相同 VIR（字节级）
4. **多后端中立**：不绑定任何渲染引擎概念

### 2.2 顶层 Schema

```jsonc
{
  "virVersion": "1.0",
  "meta": {
    "title": "string",
    "width": 1920, "height": 1080,
    "fps": 30,
    "duration": 12.5,          // 秒，由 scenes 推导
    "background": "#0a0a12",
    "seed": 42                  // 全局种子（可复现）
  },
  "scenes": [ /* Scene */ ],
  "transitions": [ /* Transition */ ],
  "audio": [ /* AudioClip */ ],
  "assets": [ /* AssetRef */ ],
  "graphs": {
    "temporal":    { "nodes": [], "edges": [] },   // 场景时序
    "spatial":     { "roots": [] },                // 每场景的图层树
    "dependency":  { "nodes": [], "edges": [] }    // 资产/图层依赖 → 增量失效
  },
  "diagnostics": { "warnings": [], "errors": [] }
}
```

### 2.3 Scene

```jsonc
{
  "id": "scene_intro",
  "name": "intro",
  "start": 0,            // 秒（编译器分配）
  "duration": 4,
  "background": "#0a0a12",   // 可覆盖 meta
  "camera": {
    "type": "push-in",
    "params": { "from": 1.0, "to": 1.08, "easing": "easeOutCubic" }
  },
  "layers": [ /* Layer */ ],
  "beats": [
    { "id": "beat_title-enter", "name": "title-enter", "at": 0.2,
      "description": "主标题模糊上浮入场" }
  ]
}
```

### 2.4 Layer（图层模型，类 AE/PSD 语义）

所有视觉元素的统一基座：

```jsonc
{
  "id": "layer_title",
  "type": "text",                    // text | rect | ellipse | image | video | lottie(预留) | group
  "name": "title",
  // 时间（秒，场景内相对时间）
  "in": 0.2, "out": 4.0,
  // 变换（锚点/位置/缩放/旋转/透明度，位置支持 "50%" 百分比）
  "transform": {
    "anchor": { "x": 0.5, "y": 0.5 },        // 0-1 相对元素自身尺寸
    "position": { "x": "50%", "y": "42%" },
    "scale": { "x": 1, "y": 1 },
    "rotation": 0,
    "opacity": 1
  },
  // 类型特定属性
  "text": {
    "content": "VideoOS",
    "font": "Inter", "size": 120, "weight": 700,
    "color": "#ffffff", "align": "center",
    "letterSpacing": 0, "lineHeight": 1.2,
    "maxWidth": 1600                    // 超出即 warning（溢出检测）
  },
  // 动画（可叠加）
  "animations": [
    { "type": "enter", "effect": "blur-up", "duration": 0.8, "delay": 0,
      "easing": "easeOutCubic", "params": { "distance": 40, "blur": 12 } },
    { "type": "exit",  "effect": "fade",   "duration": 0.5 }
  ],
  // 数据依赖（进入 dependency graph）
  "uses": ["asset_font_inter"]
}
```

### 2.5 动画系统

- **命名效果库**（确定性，全部由 easing + 参数驱动）：
  `fade, slide-up, slide-down, slide-left, slide-right, blur-up, blur-in, scale-pop, typewriter, wipe, draw-on(预留)`
- **Easing 库**：`linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic, easeOutExpo, easeOutBack, spring(参数化), bounce`
- **相机**：`static, push-in, pull-out, pan, orbit(预留 3D)`
- 语义：`enter`（从 in 点开始）、`exit`（结束于 out 点）、`loop`（循环）、`camera`（作用于整个场景）

### 2.6 语义时间线（Semantic Timeline）

Agent 操作的是 **命名实体**：

```text
scene("intro") → beat("title-enter") → layer("title")
```

VIR 保留全部命名；`video.compile` 输出的 VIR 是 Agent 的"世界模型"数据源：
- `framesOf(scene, beat)` / `timeOf(scene, beat)` 由编译器提供映射表
- Agent 说"把第三个镜头的文字换掉" → 定位 scene[2] 的 text layer → 修改 DSL → 重编译

### 2.7 Storyboard IR（故事板中间表示）

```jsonc
{
  "story": {
    "intent": "60 秒科技感产品宣传",
    "style": "high-energy tech launch",
    "shots": [
      { "id": "shot_01", "name": "logo-reveal", "start": 0,  "duration": 5,
        "purpose": "品牌揭示", "keyElement": "logo + title" },
      { "id": "shot_02", "name": "problem",     "start": 5,  "duration": 7,
        "purpose": "痛点共鸣", "keyElement": "痛点文字三连" }
    ]
  }
}
```

`storyboard.plan`（VAP 工具 / Agent 生成）→ `shots → scenes` 映射 → DSL 代码生成。

---

## 3. Video DSL

### 3.1 设计目标

Agent 与人类都可写；强类型（TS）；**可组合、可声明、可静态分析**。

### 3.2 API（v1）

```ts
import { defineVideo, audio } from "@videoos/dsl";

export default defineVideo(
  {
    title: "VideoOS Launch",
    width: 1920, height: 1080, fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    v.scene("intro", { duration: 4, background: "#0a0a12" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "主标题入场" });
      s.beat("logo-reveal", { at: 1.5 });

      s.text("title", "VideoOS", {
        size: 140, weight: 800, color: "#ffffff",
        at: { x: "50%", y: "40%" },
        enter: { effect: "blur-up", duration: 0.8 },
      });

      s.text("subtitle", "Programmable Video Runtime", {
        size: 42, color: "#8b8ba7",
        at: { x: "50%", y: "52%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });

      s.rect("glow", { width: 600, height: 600, fill: "#6d28d9", opacity: 0.25,
                       blur: 120, at: { x: "50%", y: "40%" } });

      s.camera("push-in", { from: 1.0, to: 1.08 });
    });

    v.scene("features", { duration: 6 }, (s) => { /* ... */ });

    v.transition("crossfade", { duration: 0.5, between: ["intro", "features"] });

    v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.8, fadeIn: 1, fadeOut: 2 });
  }
);
```

### 3.3 编译产物

```text
my-video/src/video.ts
  → compile()
  → .video/vir.json          # 机器可读 VIR
  → .video/graph.json        # Render Graph（执行计划）
  → .video/diagnostics.json  # 警告/错误（含溢出预检）
```

---

## 4. Render Graph 与渲染运行时

### 4.1 Render Graph

每帧执行计划：`FramePlan = [LayerCommand]`，LayerCommand 含解析后的绝对变换/样式（动画已在时间轴上求值）。

```jsonc
{
  "frame": 120, "time": 4.0, "scene": "scene_intro",
  "commands": [
    { "op": "fill-background", "color": "#0a0a12" },
    { "op": "apply-camera", "scale": 1.032, "translate": [0, 0] },
    { "op": "draw-rect",  "layer": "layer_glow", "rect": [660, 140, 600, 600],
      "fill": "#6d28d9", "opacity": 0.25, "blur": 120, "zIndex": 0 },
    { "op": "draw-text",  "layer": "layer_title", "text": "VideoOS",
      "font": "Inter", "size": 140, "weight": 800, "color": "#ffffff",
      "position": [960, 432], "opacity": 1, "blur": 0, "zIndex": 1 }
  ]
}
```

### 4.2 后端矩阵

| 后端 | 用途 | 依赖 | 状态 |
|---|---|---|---|
| `render-canvas` | **参考实现**：帧栅格化（PNG）、预览、golden | @napi-rs/canvas | v1 |
| `render-svg` | 矢量帧（审查、文档、打印） | 无 | v1 |
| `encode-ffmpeg` | 帧序列 + 音频 → MP4/WebM | ffmpeg 二进制 | v1 |
| Remotion | React 组件生态互操作 | 可选安装 | Phase 2 |
| Chromium | 网页录制 | 可选 | Phase 2 |
| Blender/Manim | 3D/数学动画 | 可选 | Phase 2 |

### 4.3 确定性要求（Determinism Contract）

1. 渲染函数签名：`renderFrame(vir: Vir, frameIndex: number): Frame`
2. 禁用 `Date.now()/Math.random()`；随机必须走 `createRng(seed)`（xoshiro128** / splitmix32）
3. 布局规则固定：文本锚点/基线/换行算法在 SPEC 附录 A 固化
4. 相同 VIR + 相同后端版本 + 相同字体 → 字节级相同 PNG（哈希进缓存键）

### 4.4 增量渲染与缓存

```text
cacheKey = SHA256( virHash + backend + backendVersion + frameIndex + params )
```

- 帧缓存：`.video/cache/frames/<key>.png`
- 场景缓存：场景未变（VIR 子树哈希未变）→ 整段帧序列复用
- 失效：`graphs.dependency` 声明 `uses` → 修改资产/图层 → 仅失效受影响场景帧
- 命中即免渲染；`videoos render` 二次运行接近瞬完成

---

## 5. Visual QA Engine（视频单元测试）

### 5.1 测试 API

```ts
import { describe, it, expect, frame, scene } from "@videoos/qa";

describe("intro", () => {
  it("无黑帧", () => {
    expect(frame(0)).not.toBeBlack();
  });

  it("标题在第 1 秒可见", () => {
    expect(frame(30)).toContainText("VideoOS");   // 语义断言：VIR 几何 + 时间窗
  });

  it("场景时长符合节奏", () => {
    expect(scene("intro")).durationBetween(3, 5);
  });

  it("与 golden 基准一致", () => {
    expect(frame(60)).toMatchGolden("tests/golden/intro-60.png", { threshold: 0.98 });
  });

  it("无文本溢出", () => {
    expect(scene("intro")).noTextOverflow();       // 编译期诊断 + 渲染期实测
  });
});
```

### 5.2 断言分类

| 断言 | 机制 | 成本 |
|---|---|---|
| `toContainText` | VIR 语义（图层时间窗 + 文本内容）+ 栅格区域采样 | 极低 |
| `toBeBlack / toBeBlank` | 像素统计 | 低 |
| `noTextOverflow` | 布局计算（measureText） | 极低 |
| `durationBetween` | VIR 元数据 | 零 |
| `toMatchGolden` | 像素 diff（感知哈希 + 逐像素） | 中 |
| `audioSynced` | ffmpeg 分析音轨起点 | 中 |

### 5.3 输出

```jsonc
{
  "suite": "intro", "passed": 5, "failed": 1,
  "results": [
    { "name": "与 golden 基准一致", "status": "FAIL",
      "diff": ".video/diagnostics/qa/intro-60.diff.png",
      "similarity": 0.912, "expected": 0.98 }
  ]
}
```

Agent 消费该 JSON → 修复 → 重测（CI/CD 式回归闭环）。

---

## 6. Agent Runtime

### 6.1 分层

```text
Agent Runtime
├── Model Providers（可插拔）
│   ├── OpenAICompatibleProvider  → OpenAI / GLM / DeepSeek / Qwen / 任意 /v1 兼容端点
│   ├── AnthropicProvider
│   └── ManualProvider（无 LLM 模式：确定性工具演示/测试）
├── Model Router（运行时策略）
│   规则：任务类型(vision/code/fast) → 能力矩阵 → provider 选择 + fallback
├── Agent Graph（动态）
│   Intent → Director → Storyboard → Engineer → Render → QA → Repair
│   简单任务自动裁剪图（改文字 → 仅 Engineer+Compile+QA）
├── World State（共享结构化状态 = VIR + Diagnostics + QA Results + Memory）
├── Tool Runtime（VAP 工具注册表，JSON Schema 约束）
├── Transaction System（workspace 层）
└── Memory
    ├── Working（会话内）
    ├── Project（项目级事实：分辨率/风格/品牌色）
    └── Failure（失败记忆：某字体溢出过 → 下次预检警告）
```

### 6.2 Model Router 规则（v1）

```jsonc
{
  "rules": [
    { "task": "vision-analysis", "require": ["vision"], "prefer": ["glm-4.5v","gpt-4o"] },
    { "task": "code-generation", "prefer": ["deepseek-v3","gpt-4.1","claude"] },
    { "task": "cheap-batch",     "prefer": ["qwen-turbo","glm-4-flash"] }
  ],
  "fallback": "any-configured"
}
```

### 6.3 Agent 循环

```text
reason() ←→ VAP tools ←→ World State
  ↓ 每步工具调用产生 Event（UI 实时展示）
  ↓ transaction.begin → edits → compile → preview → test
  ↓ PASS → transaction.commit
  ↓ FAIL → retry (max N) → 仍 FAIL → rollback + 报告
```

---

## 7. VAP — Video Agent Protocol

### 7.1 传输

- **内置 Agent**：进程内调用
- **MCP**：stdio JSON-RPC（外部 Claude/Codex/Cursor 直连）
- **REST + WS**：本地 server（Studio 与外部工具）
- **CLI**：`videoos agent exec '...'`

### 7.2 工具清单（v1 · 30 个）

**Project**
`project.create` `project.open` `project.inspect` `project.stats`

**Storyboard**
`storyboard.plan`（intent → shots JSON）`storyboard.toScenes`

**Compile**
`compile.run` `compile.diagnostics` `compile.vir`（含语义索引：scenes/beats/layers）

**Scene / Edit**
`scene.list` `scene.inspect` `scene.modify`（结构化操作：replace_text / set_color / set_duration / set_animation / reorder）
`layer.inspect` `layer.modify`

**Asset**
`asset.list` `asset.add`（本地路径/生成占位）`asset.search`（本地索引）

**Audio**
`audio.list` `audio.set`

**Render**
`render.preview`（单帧/帧范围 → PNG 路径/base64）`render.range` `render.final` `render.status` `render.cancel`

**Cache**
`cache.stats` `cache.invalidate` `cache.clear`

**Test**
`test.run`（全部/单场景）`test.results`

**Transaction**
`transaction.begin` `transaction.commit` `transaction.rollback` `transaction.list`

**Diagnose**
`inspect.frame`（返回 FramePlan + 元素包围盒）`diff.frames`（前后对比）`check.overflow` `check.missingAssets`

所有工具：JSON Schema 输入校验 + 结构化输出 + 每调用产生审计事件。

### 7.3 事务（Video Workspace Transaction）

```text
BEGIN → snapshot(文件级，.video/snapshots/<txid>/)
     → N 次 VAP 修改 + compile + test
COMMIT → 保留 snapshot（可 diff）
ROLLBACK → 原子恢复全部文件
```

Agent 改坏项目不再需要 `git checkout` —— VideoOS 原生拥有回滚。

---

## 8. MCP Server

- 传输：stdio（JSON-RPC 2.0）
- 协议版本：`2025-03-26` / `2024-11-05`
- 方法：`initialize` `tools/list` `tools/call` `ping`
- 全部 VAP 工具自动映射为 MCP tools
- 配置示例（Claude Desktop）：

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "videoos": { "command": "videoos", "args": ["mcp", "--project", "D:/videos/demo"] }
  }
}
```

---

## 9. Workspace（项目文件系统）

```text
my-video/
├── .video/                 # 生成区（可整体 gitignore）
│   ├── cache/frames/       # 内容寻址帧缓存
│   ├── graph.json
│   ├── vir.json
│   ├── diagnostics/
│   ├── renders/            # 输出 mp4/webm/序列帧
│   ├── snapshots/          # 事务快照
│   └── memory/             # agent memory（project.json / failure.json）
├── src/
│   ├── video.ts            # DSL 入口
│   ├── scenes/
│   └── theme.ts            # 品牌主题（颜色/字体/节奏）
├── assets/
│   ├── images/  ├── audio/  └── fonts/
├── tests/
│   ├── video.test.ts
│   └── golden/
├── skills/                 # 项目级 skills（可选）
└── video.project.json      # 项目清单
```

`video.project.json`：

```jsonc
{
  "name": "launch-video",
  "entry": "src/video.ts",
  "engines": { "videoos": "^0.1" },
  "render": { "defaultBackend": "canvas", "encoder": "ffmpeg" },
  "agent": { "autonomous": true, "maxRepairLoops": 3 }
}
```

---

## 10. VideoOS Studio（IDE）

### 10.1 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ VideoOS — launch-video            [Compile] [Render] ● Agent │
├──────────┬───────────────────────────────────┬───────────────┤
│ Project  │                                   │ Agent         │
│ ├ Scenes │         VIDEO PREVIEW             │ ┌───────────┐ │
│ ├ Assets │         (canvas · 实时)           │ │ Director  │ │
│ ├ Code   │                                   │ │ Engineer  │ │
│ ├ Tests  ├───────────────────────────────────┤ │ QA        │ │
│ └ Skills │   TIMELINE (场景/节拍/图层)        │ └───────────┘ │
│          │   ▓▓▓▓▓░░░░░░░░░░░░░░ 00:04.2/12  │  (chat/事件) │
├──────────┴───────────────────────────────────┴───────────────┤
│ Render 12% │ Tests 5/6 │ Cache 1.2k hits │ ffmpeg ✓ │ Logs   │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 核心面板

- **Monaco 代码编辑器**（DSL，带 TS 类型 + 片段）
- **预览**：播放头拖动 → server 渲染该帧（缓存命中 <5ms）→ 流式 PNG；播放 = 顺序帧预取
- **语义时间线**：场景块 + 节拍标记 + 图层轨道；点击节拍跳转帧
- **Agent 面板**：与内置 Agent 对话；实时显示工具调用事件流（VAP audit）
- **测试面板**：跑 QA 套件，红绿列表，golden diff 图像对比
- **渲染监视器**：进度、worker、缓存命中、ffmpeg 日志
- **视觉 Debugger**：帧上叠加元素包围盒 + 溢出红框 + 图层来源（scene/layer/源码行）

### 10.3 技术栈

React 18 + Vite + Monaco + Zustand + WebSocket；由 `packages/server`（Hono）提供 REST/WS。

---

## 11. CLI

```bash
videoos init my-video            # 从模板创建项目
videoos compile                  # DSL → VIR（含诊断）
videoos preview                  # 打开 Studio（本地 server）
videoos render [--scene intro] [--backend canvas] [--quality high]
videoos test [--update-golden]
videoos serve [--port 4747]      # 仅 API server
videoos agent exec "把标题改成 VideoOS v2 并重新渲染"
videoos mcp                      # MCP stdio server
videoos cache stats|clear
videoos doctor                   # 环境体检（ffmpeg/字体/GPU/模型连通）
```

---

## 12. Skills 库

每个 skill = `skills/<name>/SKILL.md`（说明+触发条件+工作流）+ 可选模板/脚本。

v1 内置：
`cinematic-video` · `product-demo` · `short-video`(竖屏) · `typography-title` · `subtitle-cards` · `data-motion` · `audio-sync` · `visual-qa`

Skill 生命周期：`发现 → 判定适用 → 加载 → 执行工作流(VAP) → 评价入库`。

---

## 13. 质量与工程

- **语言**：TypeScript 5 strict，全仓无 `any`（公共 API）
- **测试**：bun test；编译器/渲染器/QA 核心单测 + 端到端 golden 测试
- **CI**：GitHub Actions（typecheck + test + build + examples 渲染冒烟）
- **语义化版本**：VIR `virVersion` 独立于包版本
- **性能预算**（1080p30）：单帧 canvas 渲染 < 80ms（M1 参考）、缓存命中 < 5ms、增量编译 < 300ms

## 14. Phase 划分

**Phase 1（本仓库 v0.1 —— 全部实现）**
Canvas/SVG 后端、ffmpeg 编码、VIR/编译器、QA、缓存、事务、Agent Runtime+VAP、MCP、CLI、Studio、Electron Windows 打包、示例、Skills

**Phase 2（路线图，不在本次范围）**
Remotion/Chromium/Blender/Manim 后端 · 多 GPU 调度 · Agent Branch 并行 · 云渲染 · 插件市场 · WebMCP Studio 控制 · 协作

## 15. 非目标（Non-Goals）

- 不做通用 NLE 剪辑时间线（定位是编译器不是剪辑器）
- 不做文生视频/ diffusion 生成（确定性编程式视频）
- 不做云服务（本地优先，数据不出机器）

---

## 附录 A：文本布局规则（固化以保证确定性）

1. 锚点：`position` 为文本块**外接框中心**（含多行）；行内基线由 lineHeight*size 决定
2. 换行：仅当 `maxWidth` 存在时按词换行（CJK 按字符）；无 maxWidth 不换行并产生溢出诊断
3. 字体解析：项目 `assets/fonts` 注册（族名=文件名去扩展）→ 系统字体回退链 → 缺失字体产生 error 诊断
4. `letterSpacing` 单位 px，加于每字符后（末字符不加）

## 附录 B：缓存键算法

```text
virHash    = SHA256(canonicalJson(vir))
assetHash  = SHA256(file bytes)
frameKey   = SHA256(virHash + backendId + backendVersion + frame + width + height)
sceneKey   = SHA256(virHash + sceneId + backendId + backendVersion)
```

## 附录 C：术语表

| 术语 | 含义 |
|---|---|
| VIR | Video Intermediate Representation，视频中间表示 |
| VAP | Video Agent Protocol，Agent 工具协议 |
| Beat | 场景内命名节拍（语义时间锚点） |
| FramePlan | 单帧渲染执行计划（Render Graph 节点） |
| Golden | 视觉回归基准图 |
| Transaction | 工作区原子修改单元（begin/commit/rollback） |
