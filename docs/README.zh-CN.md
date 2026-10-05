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

## 中英双语

Studio 全界面支持中文/English 即时切换：顶栏 `中 / EN` 分段钮一键切换，零刷新生效；语言偏好本地持久化并同步服务端设置。

- 全部 UI 词典化（zh/en 键位奇偶校验进 CI，漏译即红）；错误信息按服务端错误码双语映射
- 向导、对话主界面、Skills/MCP/权限面板、IDE 高级模式全覆盖；浏览器语言自动探测
- LLM 回复语言随界面语言对齐；技能自动触发支持中文消息（CJK 二元组匹配）
- 开发者指南见 [i18n.md](./i18n.md)（新增字符串流程 · 词典段所有权 · i18n:report 工具）

## 目录

- [SPEC.md](../SPEC.md) — 权威规格
- [examples/](../examples/) — 示例项目
- [skills/](../skills/) — Agent Skills 库
- [apps/studio](../apps/studio/) — Studio IDE

## 许可

MIT © 2025 AceGuru-mjh
