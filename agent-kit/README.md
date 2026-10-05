# VideoOS Agent Kit（独立子项目）

> **并行开发领地**：本项目与主线（`apps/*` 对话式应用）在同一仓库并行推进、互不干扰。
> **开始任何工作前，先完整阅读 [SPEC.md](./SPEC.md) —— 它是唯一事实源。**

## 快速上手（执行智能体必读）

1. 读 `agent-kit/SPEC.md` 全文（尤其 §0.2 隔离规则与附录 A 冻结契约）；
2. 打开 GitHub Project 看板「VideoOS Agent Kit」，从 Backlog 认领一个 Issue；
3. 小步实现 → 本地 `bun run typecheck` 必须绿 → commit（前缀 `AK-M#:`）→ push `main`；
4. `Agent Kit CI` 工作流全绿 + Issue 验收项全勾 → 看板拖 In Review。

## 三大支柱

| 支柱 | 领地 | 交付 |
| --- | --- | --- |
| P1 Model Hub | `packages/model-hub/` | 24+ 家模型供应商目录 + 工厂 + 连通性诊断 |
| P2 Local MCP | `packages/mcp-lite/` `packages/mcp-host/` `packages/mcp-{fs,shell,web,media,os,assets}/` | 本地能力 MCP 服务器套件 + 客户端宿主 |
| P3 Skill Library | `skills/` | 创作技能库 5 → 25 |

## 里程碑状态

| 里程碑 | 范围 | 状态 |
| --- | --- | --- |
| AK-M1 | Model Hub 骨架 + 契约 + catalog 8 家 + CI | ✅ Delivered |
| AK-M2 | catalog 24 家 + google/azure 适配器 + 诊断 | ✅ Delivered |
| AK-M3 | mcp-lite / mcp-host / fs / shell / os | ✅ Delivered |
| AK-M4 | mcp-web / mcp-media / mcp-assets + 集成 | ✅ Delivered |
| AK-M5 | 20 新技能 + 校验 harness + 文档 | ✅ Delivered |

（状态以 GitHub Project 看板为准，本表由各里程碑收尾时更新。）
