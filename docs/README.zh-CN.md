# 🎬 VideoOS（中文文档）

> **面向 AI Agent 的视频编程操作系统** — The Agent-Native Video IDE & Compiler
>
> 完整规格请阅读 [SPEC.md](../SPEC.md) · 返回 [English README](../README.md)

## 这是什么？

VideoOS 不是「AI + 视频编辑器」，而是一个新的软件类别：**给 AI Agent 用的视频编程环境**。

```text
Agent 写视频代码（DSL）
  → 编译成 VIR（视频中间表示）
  → Render Graph 执行
  → 帧缓存（内容寻址，改一处只重渲受影响帧）
  → 视觉单元测试（像测软件一样测视频）
  → FAIL 自动修复（事务可回滚）/ PASS 导出 MP4
```

## 为什么不是 Remotion 壳？

Remotion 很优秀，VideoOS 把它（以及 Blender、Chromium 等）定位为**可插拔后端**；
真正的核心资产是自研的 **VIR / 编译器 / Render Graph / Visual QA / Agent Runtime**。
模型可随便换（BYO-LLM：OpenAI/GLM/Claude/DeepSeek/Qwen），但这些核心永远是 VideoOS 自己的。

## 核心概念

| 概念 | 说明 |
|---|---|
| **VIR** | Video Intermediate Representation：机器可读、可 diff 的视频中间表示 |
| **语义时间线** | 用 `scene("intro")` / `beat("title-enter")` 命名实体，而不是 frame 183 |
| **FramePlan** | 单帧渲染执行计划（Render Graph 节点） |
| **Visual Test** | `expect(frame(30)).toContainText("...")` 语义断言 + golden diff |
| **VAP** | Video Agent Protocol：30+ 结构化 Agent 工具 |
| **Transaction** | 工作区原子修改：begin → 修改 → 测试 → commit / rollback |

## 快速开始

```bash
bun install
bun apps/cli/src/index.ts init my-video && cd my-video
videoos compile     # DSL → VIR
videoos render      # → MP4（二次渲染命中缓存，接近瞬时）
videoos test        # 视觉单元测试
videoos preview     # 打开 Studio IDE
```

## 目录

- [SPEC.md](../SPEC.md) — 权威规格
- [examples/](../examples/) — 示例项目
- [skills/](../skills/) — Agent Skills 库
- [apps/studio](../apps/studio/) — Studio IDE

## 许可

MIT © 2025 AceGuru-mjh
