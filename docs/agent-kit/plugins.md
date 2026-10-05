# Agent Kit 插件系统指南（plugin-kit + 8 内置插件 + mcp-bridge）

> 本文实现 agent-kit/SPEC.md §3（支柱二）的插件扩展交付文档。插件领地（`packages/plugin-kit/**`、`plugins/**`）见 agent-kit/CONVENTIONS.md §0；API 以 `packages/plugin-kit/src/*.ts` 实现为准。

## 1. 架构

插件是**进程内**的扩展机制：PluginHost 动态 import 插件入口并注入上下文，工具/事件先进 staging、activate 成功才提交注册表（半路失败不泄漏）；mcp-bridge 再把整个注册表以 stdio MCP 服务器形式暴露给任意 MCP 客户端。

```
┌────────────────────────────────┐
│           PluginHost           │  @videoos/plugin-kit（进程内，无子进程/无 JSON-RPC）
│  discover() → start() → stop() │
└──┬─────────────────────────▲───┘
   │ discover()：扫 roots 子目录  │ activate(ctx)：动态 import entry
   │ + loadManifest 严格校验      │ ctx.registerTool / ctx.on / ctx.emit / ctx.fs / ctx.log
   ▼                            │
plugins/<id>/plugin.json      plugins/<id>/index.ts
（id=目录名、权限与全名校验）    （default activate + 可选 deactivate）
   │                            │
   └──── staging → 全局工具注册表 + 事件总线 ────┐
                                               │ listTools() / callTool() / emit()
                                               │（zod 校验 + 错误隔离：单插件失败只记 skipped）
┌──────────────────────────────────────────────▼─┐      stdio JSON-RPC（逐行）
│                  mcp-bridge                     │ ◄─────────────────────────┐
│  PluginHost 进程内加载 → 插件工具转 LiteTool[]    │                            │
└─────────────────────────────────────────────────┘   MCP 客户端（Claude Desktop /
                                                      Cursor / mcp-host / …）
```

与 mcp-host 的外部进程模型互补：mcp-host 管子进程服务器，plugin-kit 管进程内插件，mcp-bridge 负责把后者接进前者的世界。

## 2. plugin.json 全字段表

`plugins/<id>/plugin.json`，严格 schema（未知字段报错，错误带字段路径；两组交叉校验：`id` 必须等于目录名、`provides.tools` 必须是 `<id>.<name>` 全名）：

| 字段 | 类型 / 约束 | 说明 |
| --- | --- | --- |
| `id` | kebab-case，必须等于目录名 | 工具与事件的命名空间前缀 |
| `name` | 非空字符串 | 人类可读展示名 |
| `version` | `x.y.z` 语义化版本 | 插件自身版本 |
| `description` | 非空，≤200 字符 | 一句话说插件提供什么 |
| `apiVersion` | 字面量 `"0.1"` | 插件 API 契约版本，必须精确匹配 |
| `permissions` | 数组，值只能取 `fs:read` / `fs:write` / `events` / `tools` | 能力白名单，越权调用抛错 |
| `provides.tools` | 字符串数组 ≤20，每项 `<id>.<name>` 全名 | 意图声明（发现/文档用）；运行时仍强制 `<id>.` 前缀 |
| `provides.hooks` | 字符串数组 ≤10，合法事件名 | 本插件可订阅**或**发布的事件；`ctx.on/emit` 拒绝声明外事件 |
| `entry` | 字面量 `"index.ts"` | 入口固定 |
| `config` | 任意 JSON 对象（可选） | 默认配置，插件内经 `ctx.config` 拿到深拷贝 |

## 3. PluginContext API（activate 的唯一入参）

| 成员 | 权限门禁 | 说明 |
| --- | --- | --- |
| `ctx.manifest` | — | 深校验过的本插件 plugin.json |
| `ctx.config` | — | `manifest.config` 的深拷贝（改写不影响他人） |
| `ctx.z` | — | 宿主注入的 zod 实例，声明工具入参 schema 的唯一途径（插件禁止自行 import zod，见 §7） |
| `ctx.log(message)` | — | 记一条插件日志，宿主 `on("log")` 可观测 |
| `ctx.registerTool({ name, description, schema, run })` | 需 `tools`；`name` 必须是 `<id>.<name>` 全名，否则 `E_NAME` | `schema` 用 `ctx.z.object(...)`；`run(args)` 返回 `{ ok: true, data? }` 或 `{ ok: false, error }`，抛错由宿主转 `PLUGIN_ERROR` |
| `ctx.on(event, handler)` | 需 `events`；事件必须已在 `provides.hooks` 声明，否则 `E_EVENT` | handler 抛错被宿主捕获记 log，不中断其他订阅者 |
| `ctx.emit(event, payload?)` | 同 `on` | 广播到宿主事件总线，按订阅顺序逐个 await |
| `ctx.fs.readFile / writeFile / exists` | 分别需 `fs:read` / `fs:write` / 任一 | node:fs 的朴素包装，**无沙箱**（见 §7） |

权限与错误语义：越权或命名不合法**立即抛错** → activate 失败 → 该插件记入 skipped，staging 中已注册的工具/订阅全部丢弃（错误隔离不炸宿主）。宿主侧错误串：`E_PERMISSION` / `E_EVENT` / `E_NAME` / `E_ARGS`（入参不过 zod）/ `PLUGIN_ERROR`（runner 崩溃）/ `TOOL_NOT_FOUND: <name> (available: …)`。宿主自动发出的事件：`plugin.loaded {id}` 与 `host.started {}`。

## 4. 写第一个插件（抄 starter，约 30 行）

`plugins/starter/` 是参考插件（hello/ping 双工具 + 事件订阅示范）。逐步：

1. 复制目录：`cp -r plugins/starter plugins/my-plugin`（目录名即插件 id）；
2. 改 `plugins/my-plugin/plugin.json`：`id` 改为 `"my-plugin"`（必须等于目录名），改 `name` / `description`，`provides.tools` 改为 `["my-plugin.my-tool"]`；
3. 写入口 `plugins/my-plugin/index.ts`（import 约束：只允许 `import type { … } from "@videoos/plugin-kit"` 与 `node:*` 两类；zod 一律 `ctx.z`）：

```ts
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "my-plugin.my-tool",                    // 必须以 "<id>." 开头
    description: "what it does + when to use it",
    schema: ctx.z.object({                        // zod 从 ctx.z 取，禁止自行 import
      who: ctx.z.string().describe("who to greet").default("world"),
    }),
    run: ({ who }) => ({ ok: true, data: { hello: who } }),
  });
}

export function deactivate(): void {}             // 可选：host.stop() 逆序调用
```

4. 需要读项目文件就在 `permissions` 加 `"fs:read"` 并用 `ctx.fs.readFile`；需要事件就加 `"events"` 并把事件名写进 `provides.hooks` 再 `ctx.on` / `ctx.emit`；
5. 验证（会真实加载 `plugins/` 全家桶）：

```bash
bun test packages/plugin-kit            # 内置全家桶 + 你的插件被真实动态 import
bunx tsc -p plugins/tsconfig.json --noEmit   # 插件类型检查（plugins/ 不在根 tsconfig 内）
bun -e 'import { spawnLiteServer } from "./packages/mcp-lite/src/testing";
const s = await spawnLiteServer("packages/mcp-bridge/src/index.ts", {});
console.log(s.tools.map((t) => t.name).join("\n"));   // 应包含 my-plugin.my-tool
await s.close();'
```

## 5. 8 个内置插件（20 个工具）

| id | 权限 | 工具 | 一句话 |
| --- | --- | --- | --- |
| `starter` | tools, events | starter.hello / starter.ping | 参考插件：问候工具 + 事件订阅示范，新插件从这里复制 |
| `brand-guard` | tools, fs:read | brand.tokens / brand.lint / brand.nearest | 暴露品牌调色板 token，lint .ts/.md 中的离板色值，外色映射到最近的 token |
| `palette-forge` | tools | palette.fromSeed / palette.contrast / palette.tints | 种子色锻造 5 色品牌调色板（HSL 旋转 + `const BRAND` DSL 片段），WCAG 对比检查，明度梯度 |
| `timing-audit` | tools, fs:read | timing.report / timing.estimate / timing.frames | 节奏审计：从入口源码抽取 v.scene 时长与 s.beat，口播字数估时，秒转帧 |
| `subtitle-sync` | tools | subtitle.fromBeats / subtitle.cps / subtitle.validate | beat 列表转 SRT cue，CPS 阅读预算告警，SRT 结构校验（倒置/空文本/重叠） |
| `asset-watcher` | tools, fs:read | asset.scan / asset.summary | 交叉核对源码中 s.image / v.audio 引用与实际文件，报 missing 与 unused |
| `render-guard` | tools, fs:read | guard.checklist | 渲染前检查单：entry 存在、tests/*.test.ts、title 与 fps 已声明 |
| `localization` | tools, fs:read | i18n.extract / i18n.report / i18n.layers | 抽取 s.text 层供翻译，译文超 40 字符预算预警，层使用汇总 |

## 6. mcp-bridge 接入（插件 → MCP 客户端）

`packages/mcp-bridge` 读 env `MCP_PLUGIN_ROOTS`（冒号或分号分隔多根；缺省 `<repo>/plugins`）→ 进程内 `PluginHost.start()` → 全部插件工具转成 MCP `tools/list` 条目（参数经 zodToJsonSchema）→ stdio 服务。stderr 打印 started/skipped 摘要；stdin 关闭时逆序反激活。单个插件损坏只进 skipped，不炸桥。

Claude Desktop（`claude_desktop_config.json`，Windows 路径正斜杠）：

```json
{
  "mcpServers": {
    "videoos-plugins": {
      "command": "bun",
      "args": ["run", "D:/videoos/packages/mcp-bridge/src/index.ts"],
      "env": { "MCP_PLUGIN_ROOTS": "D:/videoos/plugins" }
    }
  }
}
```

经 mcp-host 聚合则直接在 `agent-kit/mcp.json` 里开 `bridge` 条目（无需 env，缺省即 `<repo>/plugins`）。注意：bridge 层调用不存在的工具是 JSON-RPC `-32602`（服务器只暴露枚举过的工具）；宿主层 `TOOL_NOT_FOUND` 语义由 plugin-kit 的 `callTool` 提供，两层不同。

## 7. 已知限制（如实）

- **插件进程内运行**：与宿主同进程，无进程/内存隔离。错误隔离是软件层的——runner 抛错转 `PLUGIN_ERROR`、activate 失败整包 skipped 且 staging 不提交——但恶意/失控插件仍可死循环或耗尽内存拖垮宿主。加载不受信代码请自行放独立进程；
- **ctx.fs 未沙箱**：声明 `fs:read`/`fs:write` 后可读写任意路径（node:fs 朴素包装）。宿主若加载不受信插件，应自行包一层路径监狱（可复用 `@videoos/mcp-lite` 的 jail）；
- **zod 一律 ctx.z 注入**：bun 的隔离安装下 `plugins/` 不参与 workspace 依赖解析，插件源码里 import 不到 `node_modules`（zod 也不行）。因此插件只允许两类 import：对 `@videoos/plugin-kit` 的 type-only import（编译期擦除）与 `node:*` 运行时内置；
- 相关陷阱：`.describe()` 必须放在 `.default()` 之前（zodToJsonSchema 会丢 ZodDefault 外层 description，参数说明进不了 JSON Schema）；`plugins/` 不在根 tsconfig 的 include 里，类型检查必须单独跑 `bunx tsc -p plugins/tsconfig.json --noEmit`。

## 8. 测试与验证

```bash
bun test packages/plugin-kit packages/mcp-bridge   # 27 用例（manifest/discover/start/权限/事件/桥 E2E）
bunx tsc -p plugins/tsconfig.json --noEmit         # 插件类型检查
bunx tsc -p tsconfig.json --noEmit                 # 根 typecheck（plugin-kit/mcp-bridge 自动纳入）
```

全部测试离线自足：夹具用 mkdtemp 临时目录动态写 plugin.json + index.ts 真动态 import，零 mock。
