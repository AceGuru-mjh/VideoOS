# Agent Kit 使用指南

> 本文实现 agent-kit/SPEC.md §6 AK-M5 的交付物文档（docs/agent-kit 指南）导航页，术语与 SPEC 一致。

Agent Kit 为 VideoOS Agent 提供三大能力：本地 MCP 工具服务器（P2）、创作技能库（P3）与插件系统（SPEC 三支柱之外的第 4 块领地，见 CONVENTIONS §0）。全部交付物在 `packages/mcp-*`、`packages/plugin-kit`、`plugins/`、`skills/`、`agent-kit/` 领地内与主线并行开发。

## 数字总览（如实：已实现 / 规划中）

| 能力 | 规模 | 状态 |
| --- | --- | --- |
| MCP 服务器 | 28 个，139 个内置工具（另有 mcp-bridge 转发 20 个插件工具） | 已实现，全量 E2E 通过 |
| 插件系统 | plugin-kit 运行时 + 8 个内置插件 / 20 个工具 | 已实现，27 测试全绿 |
| 技能库 | 42 个技能（存量 5 + 新增 37），check-skills 全过 | 已实现 |
| P1 Model Hub | 24 家模型供应商目录与诊断（SPEC §2 冻结契约） | 规划中，尚未实现 |

## 导览

| 支柱 | 是什么 | 指南 |
| --- | --- | --- |
| P2 本地 MCP | 28 个 stdio 服务器 + `@videoos/mcp-lite` 协议原语 + `@videoos/mcp-host` 客户端宿主 | [mcp-servers.md](./mcp-servers.md) |
| 插件系统 | `@videoos/plugin-kit` 进程内插件宿主 + `plugins/` 8 内置插件 + `mcp-bridge` MCP 桥 | [plugins.md](./plugins.md) |
| P3 技能库 | `skills/` 42 个视频创作技能（SKILL.md 契约 + 校验器） | [skills.md](./skills.md) |
| P1 Model Hub | 24 家模型供应商目录、工厂与连通性诊断 | 见 SPEC §2（未实现） |

## 5 分钟上手：一条命令拉起 MCP 全家桶

[`agent-kit/mcp.json`](../../agent-kit/mcp.json) 收录全部 28 个服务器，默认开启 `fs` / `shell` / `time` / `bridge` 四个示范（其余 `enabled: false`，按需打开）：

```bash
cd <仓库根目录>
bun -e 'import { loadHostConfig, McpHost } from "./packages/mcp-host/src/index";
const host = new McpHost(await loadHostConfig("agent-kit/mcp.json"));
await host.start();
console.log(host.listTools().map((t) => `${t.server}.${t.name}`).join("\n"));
await host.stop();'
```

输出 35 个聚合工具（fs 7 + shell 2 + time 6 + bridge 转发 20 个插件工具）。把任意服务器改成 `"enabled": true` 即可拉起全家桶（28 个全开共 159 个工具）。接入 Claude Desktop / Cursor 见 [mcp-servers.md §10](./mcp-servers.md)。

## 校验命令

| 命令 | 用途 |
| --- | --- |
| `bun run agent-kit/scripts/check-skills.ts` | 技能库校验（42 技能，退出码 0 = PASS） |
| `bun test packages/mcp-host` | 宿主聚合 / 超时 / 崩溃重启 E2E |
| `bun test packages/plugin-kit packages/mcp-bridge` | 插件运行时与桥 E2E |
| `bunx tsc -p tsconfig.json --noEmit` | 根 typecheck（新包自动纳入） |

## 相关文档

- [agent-kit/SPEC.md](../../agent-kit/SPEC.md) — 唯一事实源（冻结契约 A-H）
- [agent-kit/CONVENTIONS.md](../../agent-kit/CONVENTIONS.md) — 工程契约（工具规范 / 测试姿势 / zod 陷阱）
- [docs/mcp-guide.md](../mcp-guide.md) — 主线 VAP 31 工具的 MCP 服务器（`videoos mcp`，与本文的本地能力服务器互补）
- [docs/getting-started.md](../getting-started.md) — 主线快速上手（init → compile → test → render）
