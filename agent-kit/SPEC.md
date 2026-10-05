# SPEC — VideoOS Agent Kit（智能体能力扩展套件）

> **独立子项目** · 与主线（apps/* 对话式应用 v0.2）**完全并行、互不干扰**。
> 本文档是本项目的**唯一事实源**（Single Source of Truth）。执行本项目的智能体/开发者
> 在动手前必须完整阅读本文，且只需阅读本文 + 附录所列既有契约，**不需要**阅读主线代码。
>
> - 项目看板：GitHub Project 「VideoOS Agent Kit」（Backlog → In Progress → In Review → Done）
> - 任务队列：带 `agent-kit` 标签的 Issues（每个 Issue = 一个可独立交付的工作包）
> - 主线（禁止触碰）：`apps/**`、`packages/agent`、`packages/mcp`、既有 CI/Release 工作流

---

## 0. 项目宪章（必读）

### 0.1 一句话定位

为 VideoOS Agent（对话式视频创作智能体）提供三大能力支柱：

| 支柱 | 交付物 | 解决什么 |
| --- | --- | --- |
| **P1 Model Hub** | `@videoos/model-hub` | 「模型用谁家的都可以」——24+ 家模型供应商的目录、接入与诊断 |
| **P2 Local MCP** | `@videoos/mcp-lite` / `@videoos/mcp-host` + 6 个 `mcp-*` 服务器 | 「MCP 本地能力」——文件/终端/网络/媒体/系统/素材的本地工具服务器 |
| **P3 Skill Library** | `skills/` 从 5 → 25 | 「内置多一些 skill」——覆盖主流视频品类的创作技能库 |

### 0.2 隔离规则（最重要的三行）

```
允许创建/修改：packages/model-hub/**  packages/mcp-lite/**  packages/mcp-host/**
              packages/mcp-fs/**  packages/mcp-shell/**  packages/mcp-web/**
              packages/mcp-media/**  packages/mcp-os/**  packages/mcp-assets/**
              skills/**  docs/agent-kit/**  agent-kit/**
              .github/workflows/agent-kit-ci.yml
禁止触碰：    上面清单之外的一切 —— 尤其是 apps/**、packages/agent/**、packages/mcp/**
              （@videoos/agent 与 @videoos/mcp 只能 import，不能改）、
              packages/{core,vir,dsl,compiler,render-canvas,render-svg,cache,encode,qa,workspace,server}/**
              .github/workflows/{ci,release}.yml、根 package.json / tsconfig.json / SPEC.md / README.md
```

理由：主线智能体正在 `apps/**` 开发 v0.2 对话式应用，双方在同一仓库并行推送。
越界修改 = 破坏并行约定。若确有跨领域诉求（例如需要主线改一处 glue），**开 Issue 说明，不要自己改**。

### 0.3 工作流约定

- **认领**：从看板 Backlog 取一个 Issue → 移到 In Progress → 评论 `claim`。
- **提交**：Conventional Commits，前缀用里程碑号，如 `AK-M1: model-hub catalog + factory (#2)`。
- **验收**：`agent-kit-ci.yml` 绿 + Issue 内全部验收项打勾 → 移 In Review → 由仓库维护者合并/关闭。
- **推送**：直接 push `main`（与仓库现行惯例一致），但一次推送只做一件事，禁止夹带越界文件。
- **冲突**：push 前先 `git pull --rebase`；若仍冲突，在 Issue 里 @ 维护者。

---

## 1. 总体架构

```
┌────────────────────────── VideoOS 仓库 ──────────────────────────┐
│                                                                   │
│  主线（勿动）                        Agent Kit（本项目领地）        │
│  apps/desktop  apps/studio          packages/model-hub     P1     │
│  apps/cli      packages/agent   ←── packages/mcp-lite      P2     │
│                packages/mcp     ←── packages/mcp-host      P2     │
│                packages/*(引擎)      packages/mcp-{fs,shell,web,  │
│                                     media,os,assets}      P2     │
│                                    skills/ (5 → 25)       P3     │
│                                    agent-kit/ (本文档+工具)        │
└───────────────────────────────────────────────────────────────────┘
依赖方向：model-hub / mcp-* ──import──▶ @videoos/agent 的「类型与既有适配器」（冻结，只读）
             mcp-{fs,shell,...} ──import──▶ @videoos/mcp-lite（本项目内部共享协议原语）
```

**关键设计原则**

1. **契约冻结**：本项目消费的既有接口（`ModelProvider` 等）在附录 A 逐字给出，**按此实现，不要改既有包**。
2. **零新增原生依赖**：所有新包只用纯 TS + Bun 内置（`node:*`）+ 既有轻依赖（zod）。
   `@napi-rs/canvas` 仅 `mcp-assets` 可引用（根依赖已装）。
3. **本地零下载**：沙盒内只写代码不装包（`bun install` 在 CI 执行）；任何新依赖必须是纯 JS 包。
4. **无网络测试**：全部单测走 `node:http` 本地 mock（附录 F 陷阱说明）。

---

## 2. 支柱一：Model Hub（`packages/model-hub`）

### 2.1 目标

提供一个**供应商目录（catalog）+ 工厂 + 诊断器**，让任何宿主（CLI/桌面应用）都能：

1. 渲染「选择模型供应商」界面（目录数据）；
2. 用统一配置实例化 `ModelProvider`（复用 `@videoos/agent` 既有适配器 + 本包原生适配器）；
3. 一键测试连通性（错误分类 + 延迟 + 可用模型列表）。

**不做**：对话编排、路由策略、缓存 —— 那些属于 `@videoos/agent`（主线，勿动）。

### 2.2 冻结契约 B：`ProviderDescriptor` 与 catalog

`packages/model-hub/src/types.ts`：

```ts
import type { ModelProvider } from "@videoos/agent";

/** 目录条目的接入类型 */
export type DescriptorType =
  | "openai-compatible" // 复用 @videoos/agent OpenAICompatibleProvider
  | "anthropic"         // 复用 @videoos/agent AnthropicProvider
  | "google"            // 本包原生 GoogleProvider（Gemini generateContent）
  | "azure-openai"      // 本包原生 AzureOpenAIProvider
  | "custom";           // 用户自定义（openai-compatible 行为，必填 baseUrl）

export interface CatalogModel {
  id: string;            // "glm-4.5"（供应商侧模型名）
  label: string;         // "GLM-4.5"（展示名）
  contextK?: number;     // 上下文窗口（千 token）
  tools: boolean;        // 是否支持工具调用
  vision: boolean;       // 是否支持视觉输入
  tags?: string[];       // ["fast"] / ["reasoning"] / ["cheap"] ...
  pricingHint?: string;  // "≈¥1.4/M in" —— 仅展示用
}

export interface ProviderDescriptor {
  id: string;            // 稳定小写 kebab，如 "deepseek"；与 env key 派生规则一致
  type: DescriptorType;
  name: string;          // "DeepSeek"
  nameZh: string;        // "深度求索"
  baseUrl: string;       // 默认完整 base（openai-compatible 含版本段；anthropic 不含 /v1；google 填 https://generativelanguage.googleapis.com；azure 填 https://<resource>.openai.azure.com）
  keyUrl?: string;       // 获取 key 的控制台地址
  docsUrl?: string;      // 文档地址
  local?: boolean;       // 本地推理（ollama / lmstudio）—— 无需 key
  models: CatalogModel[];// 快照提示，运行时优先用 listModels 实测
  notes?: string;        // 接入注意事项（quirk）
}
```

`packages/model-hub/src/catalog.json`：`ProviderDescriptor[]`，首批 **24 条**（§2.6 清单）。

### 2.3 工厂：`createProviderFromDescriptor`

```ts
export interface ProviderCreds {
  apiKey?: string;   // 缺省时按 @videoos/agent 规则读 env：VIDEOOS_PROVIDER_<ID>_KEY
  baseUrl?: string;  // 覆盖目录默认（custom 必填）
  model?: string;    // 覆盖用户选择的模型（缺省取 models[0].id）
  timeoutMs?: number;
}

export function createProviderFromDescriptor(
  desc: ProviderDescriptor,
  creds: ProviderCreds = {},
): ModelProvider;
```

实现规则：

- `openai-compatible` / `custom` → `new OpenAICompatibleProvider({ id: desc.id, baseUrl, apiKey, model, vision, tools, timeoutMs })`（`OpenAICompatibleOptions` 见既有契约，env 回退用 `providerKeyEnvName(desc.id)` 语义）；
- `anthropic` → `new AnthropicProvider({ id, baseUrl, apiKey, model, vision, tools, timeoutMs })`；
- `google` → 本包 `GoogleProvider`（§2.4）；
- `azure-openai` → 本包 `AzureOpenAIProvider`（§2.4）；
- 目录未知 `type` → 抛 `ProviderError("HUB_UNKNOWN_TYPE", ...)`。
- `local: true`（ollama/lmstudio）不要求 key；缺 key 的云端家在 `chat()` 时自然报 `PROVIDER_AUTH`（既有语义），工厂不拦截。

### 2.4 原生适配器（仅两个）

**GoogleProvider** —— `POST {baseUrl}/v1beta/models/{model}:generateContent`，header `x-goog-api-key`。
映射：`ChatMessage[] → contents[]`（role: user/model，system 拼到 `systemInstruction`）；
工具调用 → `functionDeclarations` / `functionCall` / `functionResponse`；
`usageMetadata` → `ChatUsage`。错误 → `ProviderError`（401→`PROVIDER_AUTH`、429→`PROVIDER_RATE_LIMIT`、网络→`PROVIDER_NETWORK`…沿用既有错误码语义，见附录 A）。

**AzureOpenAIProvider** —— `{baseUrl}/openai/deployments/{model}/chat/completions?api-version=2024-10-21`，header `api-key`。
body/响应与 OpenAI 相同（内部复用 wire 转换逻辑，可直接 import `toOpenAiMessages` / `toOpenAiTools`）。

两者都实现 `ModelProvider`（capabilities 按 catalog model 条目），都接受 `fetchImpl` 注入（测试用）。

### 2.5 诊断：`testConnection`

```ts
export interface ConnectionReport {
  ok: boolean;
  latencyMs: number;              // 首个请求往返
  models?: string[];              // 实测 /models（或 Gemini listModels）结果
  error?: {
    kind: "auth" | "network" | "model" | "rate-limit" | "unknown";
    message: string;              // 人类可读（面向设置界面）
    hint?: string;                // "请检查 API Key 是否正确 / 是否有余额"
  };
}

export async function testConnection(
  desc: ProviderDescriptor,
  creds: ProviderCreds = {},
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ConnectionReport>;
```

策略：优先 `GET /models`（openai-compatible 家）或 Gemini `GET /v1beta/models`；不支持的家退化为最小 `chat` 请求（`maxTokens: 1`）。错误分类表：

| 观测 | kind | hint |
| --- | --- | --- |
| 401/403 | auth | 检查 Key 正确性/权限/余额 |
| 404 且来自 chat 退化请求 | model | 模型名或部署名不对 |
| 429 | rate-limit | 触发限流，稍后重试 |
| fetch 抛错（DNS/ECONN） | network | 检查网络/代理/baseUrl |
| 其他 | unknown | 附响应前 300 字符 |

### 2.6 目录清单（首批 24 条）

| id | type | baseUrl | 代表模型 | 备注 |
| --- | --- | --- | --- | --- |
| openai | openai-compatible | `https://api.openai.com/v1` | gpt-4o, gpt-4o-mini | key: platform.openai.com |
| anthropic | anthropic | `https://api.anthropic.com` | claude-sonnet-4-20250514 | 既有适配器 |
| deepseek | openai-compatible | `https://api.deepseek.com/v1` | deepseek-chat, deepseek-reasoner | 便宜/推理 |
| zhipu | openai-compatible | `https://open.bigmodel.cn/api/paas/v4` | glm-4.5, glm-4.5-air, glm-4-flash | |
| qwen | openai-compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max, qwen-plus, qwen-turbo | |
| moonshot | openai-compatible | `https://api.moonshot.cn/v1` | kimi-k2-0905-preview, moonshot-v1-128k | |
| doubao | openai-compatible | `https://ark.cn-beijing.volces.com/api/v3` | doubao-seed-1-6, doubao-1.5-pro-32k | 模型名或接入点 ID |
| minimax | openai-compatible | `https://api.minimaxi.com/v1` | MiniMax-Text-01, abab6.5s-chat | |
| siliconflow | openai-compatible | `https://api.siliconflow.cn/v1` | deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-72B-Instruct | 聚合站 |
| hunyuan | openai-compatible | `https://api.hunyuan.cloud.tencent.com/v1` | hunyuan-turbos-latest | |
| yi | openai-compatible | `https://api.lingyiwanwu.com/v1` | yi-lightning | |
| ernie | openai-compatible | `https://qianfan.baidubce.com/v2` | ernie-4.5-turbo-128k | |
| spark | openai-compatible | `https://spark-api-open.xf-yun.com/v1` | generalv3.5, 4.0Ultra | |
| xai | openai-compatible | `https://api.x.ai/v1` | grok-3, grok-4 | |
| mistral | openai-compatible | `https://api.mistral.ai/v1` | mistral-large-latest | |
| openrouter | openai-compatible | `https://openrouter.ai/api/v1` | openai/gpt-4o, anthropic/claude-sonnet-4 | 聚合站，模型名带命名空间 |
| groq | openai-compatible | `https://api.groq.com/openai/v1` | llama-3.3-70b-versatile | 极速 |
| together | openai-compatible | `https://api.together.xyz/v1` | meta-llama/Llama-3.3-70B-Instruct-Turbo | |
| cohere | openai-compatible | `https://api.cohere.ai/compatibility/v1` | command-r-plus | 用兼容端点 |
| perplexity | openai-compatible | `https://api.perplexity.ai` | sonar, sonar-pro | 搜索增强 |
| google | google | `https://generativelanguage.googleapis.com` | gemini-2.5-flash, gemini-2.5-pro | 原生适配器 |
| azure-openai | azure-openai | `https://<resource>.openai.azure.com`（占位） | 由 deployment 决定 | 原生适配器；model=deployment 名 |
| ollama | openai-compatible | `http://127.0.0.1:11434/v1` | llama3.1, qwen2.5 | `local: true` |
| lmstudio | openai-compatible | `http://127.0.0.1:1234/v1` | 本地模型列表 | `local: true` |
| custom | custom | `""`（用户必填） | 用户填 | 设置界面自由输入 |

> 模型 ID 是**快照提示**（会过时）：目录数据允许后续小步 PR 修正，运行时一律以 `testConnection().models` 实测为准。

### 2.7 测试规范（P1 全部适用）

- 每个适配器/工厂分支：`node:http` 起本地 mock 服务（127.0.0.1 随机端口），`fetchImpl` 直连它 —— **禁止**依赖外网（附录 F：bun fetch 快路径陷阱）。
- `testConnection`：auth / network / model / rate-limit / ok 五分支全覆盖。
- catalog.json：zod 校验（id 唯一、kebab、baseUrl 合法、`local` 家不强制 keyUrl）。
- 目标：P1 测试 ≥ 60 个用例，全部离线可跑。

---

## 3. 支柱二：本地 MCP 服务器（`packages/mcp-*`）

### 3.1 目标

实现「MCP 本地能力」：6 个独立 stdio 服务器 + 1 个客户端宿主。宿主（未来的主线应用）拉起服务器、聚合工具、统一调用。

### 3.2 冻结契约 C：线协议（与 `@videoos/mcp` 逐字节兼容）

- JSON-RPC 2.0，**逐行 JSON**（`\n` 分隔，无 Content-Length 头）；
- 方法：`initialize`（未初始化先调他法 → `-32002`）、`notifications/initialized`（无响应）、`tools/list`、`tools/call`；
- 错误码：`-32700/-32600/-32601/-32602/-32603/-32002`；
- `tools/list` → `{ tools: [{ name, description, parameters(JSON Schema) }] }`；
- `tools/call` → `{ ok, data?, error? }`（沿用 `McpToolDeps.call` 返回形状）。

### 3.3 `@videoos/mcp-lite`（协议原语包，P2 内部共享）

自包含实现（**不依赖** `@videoos/mcp`，避免拖入 workspace/agent）：

```ts
// 导出面（packages/mcp-lite/src/index.ts）
export { JsonRpcErrorCodes }        // 附录 C 常量
export function readMessages(chunk: string /* 或流式接口 */): JsonRpcMessage[]
export function writeMessage(w: WritableStreamLike, msg: JsonRpcMessage): void
export function errorResponse(id, code, message, data?): JsonRpcResponse
export function resultResponse(id, result): JsonRpcResponse

export interface LiteTool {
  name: string
  description: string
  parameters: Record<string, unknown>   // JSON Schema（zodToJsonSchema 产物）
  call(args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }>
}

/** 30 行组装一个 stdio 服务器：读 stdin 行 → 路由 → 写 stdout 行 */
export function runStdioServer(tools: LiteTool[], opts?: {
  serverName?: string            // 如 "mcp-fs"
  serverVersion?: string         // "0.1.0"
}): Promise<void>                // stdin 关闭时退出
```

行为细节：未 `initialize` 前其他请求回 `-32002`；未知方法回 `-32601`（通知除外，静默）；
`tools/call` 参数校验失败回 `-32602`（message 含字段路径）；服务器崩溃兜底 try/catch 回 `-32603`。

### 3.4 `@videoos/mcp-host`（客户端宿主）

```ts
export interface McpServerConfig {
  command: string;          // "bun" 或绝对路径 exe
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;        // 默认 true
  timeoutMs?: number;       // 单次 call 超时，默认 30_000
  allowedTools?: string[];  // 白名单（缺省=全部）
}

export interface McpHostConfig { servers: Record<string, McpServerConfig> }

export function loadHostConfig(path: string): Promise<McpHostConfig>  // mcp.json（附录 G 示例）
export class McpHost {
  constructor(config: McpHostConfig)
  start(): Promise<void>                     // 依次 spawn + initialize + tools/list
  stop(): Promise<void>                      // SIGTERM → 3s → SIGKILL
  listTools(): Array<{ server: string; name: string; description: string; parameters: Record<string, unknown> }>
  callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }>
    // 工具名冲突时以 "<server>.<name>" 全名暴露；callTool 接受两者
  on(event: "log", cb: (e: { server: string; tool: string; ok: boolean; ms: number; error?: string }) => void): void
}
```

健壮性要求：进程意外退出 → 自动重启（指数退避，上限 3 次/分钟，超过标记 server unhealthy 并在 `listTools` 排除）；
call 超时 → 杀本次不杀进程，返回 `{ ok: false, error: "timeout after Nms" }`。

### 3.5 六个服务器的工具清单

每个服务器一个包（`packages/mcp-<name>/`），入口 `src/index.ts` 调 `runStdioServer(tools)`。
安全基线：**所有入参 zod 校验**；路径工具一律做**路径监狱**（resolve 后必须仍在根内，拒绝 `..` 与符号链接逃逸）；
输出超限截断（附 `truncated: true`）；每个工具 ≤ 30s 默认超时。

#### mcp-fs（文件系统，根 = env `MCP_FS_ROOTS`，冒号/分号分隔多根，缺省 `process.cwd()`）

| 工具 | 入参 | 出参/规则 |
| --- | --- | --- |
| `fs.list` | path, depth? | 条目数组（name/type/size/mtime），depth ≤ 5 |
| `fs.read` | path, maxBytes=65536 | 文本内容（utf-8）或 base64（`encoding:"base64"`），超限截断 |
| `fs.write` | path, content, createDirs? | 写入字节数；拒绝覆盖根外；写后返回 sha256 前 12 位 |
| `fs.move` | from, to | 移动；跨根拒绝 |
| `fs.remove` | path, recursive? | 删除条目数；默认不递归 |
| `fs.search` | root, glob, contentRegex? | 匹配路径 ≤ 200 条；contentRegex 时逐文件 grep（≤1MB 文件） |
| `fs.tree` | path | 深度 ≤ 3 的树形文本 |

#### mcp-shell（终端，根 = env `MCP_SHELL_ROOTS`）

| 工具 | 入参 | 出参/规则 |
| --- | --- | --- |
| `shell.exec` | command, cwd?, timeoutMs?=20000, maxOutput=65536 | `{ exitCode, stdout, stderr, truncated, durationMs }`；Windows 用 `cmd /c`（或 powershell -Command，二选一并写死）；cwd 必须在根内；超时杀进程树 |
| `shell.which` | command | `{ found, path? }` |

#### mcp-web（网络读取）

| 工具 | 入参 | 出参/规则 |
| --- | --- | --- |
| `web.fetch` | url, maxBytes=262144, timeoutMs?=15000 | `{ status, contentType, text }`；text/html → 剥标签抽正文（去 script/style，保留块级换行）；只允许 http(s)；重定向 ≤ 5 |
| `web.dns` | hostname | `{ addresses }`（node:dns promise） |

不做搜索（不引入任何搜索 API key）。

#### mcp-media（ffmpeg 工具箱，系统 ffmpeg/ffprobe，CI 已装）

| 工具 | 入参 | 出参/规则 |
| --- | --- | --- |
| `media.probe` | path | ffprobe -print_format json 的精简（容器/流/时长/分辨率/fps/比特率） |
| `media.convert` | input, output, args[]（白名单校验：禁覆盖根外、禁读设备） | 输出路径 + 耗时 |
| `media.thumbnail` | input, at=1.0, output | `-ss <at> -frames:v 1` PNG |
| `media.extractAudio` | input, output | `-vn -acodec copy` 或 `-ac 1 -ar 16000`（参数） |
| `media.gif` | input, output, start?, dur?, fps=12, width=480 | GIF |
| `media.concat` | inputs[], output | concat demuxer，统一编码参数校验 |

全部输出必须落在监狱根内（env `MCP_MEDIA_ROOTS`）；ffmpeg 不存在 → `{ ok:false, error: "ffmpeg not found" }`（不崩溃）。

#### mcp-os（系统信息）

| 工具 | 入参 | 出参 |
| --- | --- | --- |
| `os.info` | — | platform/release/arch/cpus/mem(总+可用)/hostname（脱敏：不含用户名路径） |
| `os.disk` | path? | `statfs`：total/free（B） |
| `os.env` | keys[]（白名单：仅返回请求且**非敏感**键，敏感模式 `*KEY*/*TOKEN*/*SECRET*/PASSWORD` 一律脱敏为 `***`） | 键值对象 |

#### mcp-assets（素材库）

| 工具 | 入参 | 出参/规则 |
| --- | --- | --- |
| `assets.index` | root, refresh? | 扫描图片/音频/视频/字体 → 索引（名称/类型/大小/尺寸/时长）；结果缓存于内存 + `<root>/.assets-index.json` |
| `assets.search` | query, type? | 模糊匹配（名称子串 + 类型过滤），≤ 50 条 |
| `assets.info` | path | 单文件详情：图片用 `@napi-rs/canvas` loadImage 取宽高；音视频用 ffprobe；字体读取名称表（解析 name table，失败则只报大小） |

### 3.6 测试规范（P2 全部适用）

- 每个服务器包：`Bun.spawn` 起真进程（`bun run src/index.ts`），stdin 写 JSON-RPC、读 stdout 断言 —— **协议级 E2E**；
- mcp-lite：单元级（readMessages 分块/粘包、错误码、门禁）；
- mcp-host：双服务器拉起、工具聚合、超时、崩溃重启、白名单；
- 路径监狱：`..` 穿越、绝对路径逃逸、符号链接逃逸（`fs.symlinkSync` 构造）三连测必须全过；
- mcp-shell：在 **windows CI** 上跑一遍 `echo hello`；
- mcp-media：CI ubuntu 已装 ffmpeg，用 ffmpeg lavfi testsrc 自产 1s 测试样本。

---

## 4. 支柱三：技能库（`skills/` 5 → 25）

### 4.1 冻结契约 D：SKILL.md 格式（与现有 5 技能逐字段一致）

```markdown
---
name: <kebab-case id>
version: 0.1.0
description: <一句话，英文，≤ 160 字符>
trigger: <什么时候用这个技能——面向 Agent 的判据，英文>
---

# <Title>

Goal: <目标视频：时长/比例/基调>

## Workflow
<编号步骤：引用真实 VAP 工具名（storyboard.plan / compile.run / render.preview / test.run / render.final …），
 写明 QA 门禁与修复循环上限>

## Recipes
<≥ 2 个真实可抄的 DSL 片段（s.scene/s.text/s.rect/s.beat/s.camera …，与现有技能同风格），
 每段标注所属 Act 与主导元素>
```

硬性要求：`trigger` 与 `description` 不雷同；Workflow 必须出现 `compile.run` 与 `test.run`；
Recipes 代码块 ≥ 2 个且必须使用真实 DSL API；**禁止发明不存在的 VAP 工具名**（以 `@videoos/agent` `createDefaultTools` 的 31 个为准，参考既有技能用过的名字）。

### 4.2 新增 20 个技能清单

| # | 目录名 | 场景 | 关键手法 |
| --- | --- | --- | --- |
| 1 | `tech-intro` | 科技感产品片头（5–8s） | 网格背景 + 大字 blur-up + 摄像机推拉 |
| 2 | `kinetic-lyrics` | 动态歌词 MV | 逐行逐字 stagger + beat 对齐 |
| 3 | `logo-reveal` | Logo 揭示 | 遮罩擦除 + 光斑 + 定版 |
| 4 | `lower-thirds` | 人名条/字幕条 | 入出安全区 + 滑入/滑出 |
| 5 | `quote-card` | 金句卡片 | 大引号 + 打字机 + 呼吸强调 |
| 6 | `countdown` | 倒计时/活动预告 | 数字翻牌 + 终帧 CTA |
| 7 | `api-explainer` | API/接口讲解 | 端点卡 + 请求/响应流动画 |
| 8 | `changelog` | 版本更新日志 | 版本横幅 + 条目列表逐一入场 |
| 9 | `roadmap` | 路线图/里程碑 | 水平时间轴 + 节点点亮 |
| 10 | `data-dashboard` | 数据看板故事 | KPI 大数字 + 趋势线生长 |
| 11 | `math-derivation` | 公式推导动画 | 步进公式 + 高亮当前项 |
| 12 | `subtitle-burn` | 字幕对齐烧制 | 时间轴对齐 + 样式规范 |
| 13 | `comparison` | 产品对比评测 | 分屏 + 逐项 PK |
| 14 | `tutorial` | 教程/操作演示 | 步骤编号 + 高亮焦点框 |
| 15 | `screenshot-tour` | 截图走查 | 图片资产序列 + 缩放平移 |
| 16 | `interview-clip` | 访谈切片 | 说话人条 + 关键句放大 |
| 17 | `news-brief` | 资讯简报 | 标题滚动 + 要点列表 |
| 18 | `recruitment` | 招聘视频 | 职位卡 + CTA 尾帧 |
| 19 | `course-intro` | 课程片头 | 章节预览 + 讲师署名 |
| 20 | `year-review` | 年度回顾盘点 | 数据大屏 + 高光时刻轮播 |

### 4.3 校验 harness：`agent-kit/scripts/check-skills.ts`

`bun run agent-kit/scripts/check-skills.ts` 扫描 `skills/*/SKILL.md`：

1. frontmatter 可解析且字段齐全（name=目录名、version、description ≤ 160、trigger 非空）；
2. 章节存在：`# Title`、`Goal:`、`## Workflow`、`## Recipes`；
3. Workflow 包含 `compile.run` 与 `test.run` 字样；
4. 代码块 ≥ 2，且只使用 DSL API 白名单（方法名集合：`v.scene|s.beat|s.text|s.rect|s.ellipse|s.image|s.camera|s.group|s.audio|v.output` 等静态正则校验，白名单常量内置脚本，可随主线 DSL 演进提 PR 增补）;
5. 不含 emoji、不含真实密钥样文（`sk-`、`ghp_` 前缀字符串直接 fail）。

存量 5 技能一并纳入校验（如存量不合格，**允许**对 `skills/` 内这 5 个文件做最小修复 —— 这是本支柱领地内）。

---

## 5. CI 策略

`.github/workflows/agent-kit-ci.yml`（附录 E 给出全文，Issue #1 直接复制）：

- 触发：push/PR 路径过滤（本领域 10 个目录 + 自身 workflow）+ `workflow_dispatch`；
- Job A（ubuntu）：install → 根 `bun run typecheck`（**新包自动纳入根 tsconfig 的 `packages/*/src`，必须保持绿**）→ `bun test packages/model-hub packages/mcp-lite ...`（存在的才跑）→ skills 校验脚本；
- Job B（windows）：mcp 系测试（shell/fs 跨平台断言）；
- ffmpeg：ubuntu `apt-get install -y ffmpeg`（同主 CI）；windows 不跑 media 测试（env 跳过）。

**红线**：本项目的任何提交都不得让**主 CI（ci.yml）变红** —— 主 CI 的 `bun test packages apps` 与根 typecheck 会把新包一并跑掉。这是并行开发的公共约束。

---

## 6. 里程碑与验收

| 里程碑 | 内容 | Definition of Done |
| --- | --- | --- |
| **AK-M1** | model-hub 骨架 + 契约 + catalog 8 家 + 工厂 + CI workflow 落地 | agent-kit-ci 绿；根 typecheck/test 绿；`createProviderFromDescriptor` 对 8 家 openai-compatible 走通 mock chat + `/models` |
| **AK-M2** | catalog 24 家全量 + google/azure 原生适配器 + testConnection | 诊断五分支全覆盖；P1 测试 ≥ 60 用例全绿（离线） |
| **AK-M3** | mcp-lite + mcp-host + mcp-fs + mcp-shell + mcp-os | 协议 E2E 全绿（ubuntu）；shell/fs 在 windows CI 绿；路径监狱三连测过 |
| **AK-M4** | mcp-web + mcp-media + mcp-assets + host 全家桶集成 | host 同时拉起全部服务器聚合工具清单 E2E；media 在 ubuntu ffmpeg 上全绿 |
| **AK-M5** | 20 个新技能 + 校验 harness + docs/agent-kit 三篇指南 + 收尾 | check-skills 25/25 过；每篇技能含 ≥ 2 Recipes；文档覆盖模型接入/MCP 配置/技能创作 |

每个里程碑对应 GitHub Milestone；Issue 完成即在看板拖列。**不设截止时间**（并行开发，质量优先）。

---

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| bun fetch 对 127.0.0.1 mock 的快路径分叉（仓库已踩坑 a4646f8） | 一律 `node:http` 起服务 + 显式 `fetchImpl` 注入；禁止 mock 全局 fetch |
| Windows 路径/分隔符 | 全部 `node:path` 的 `join/resolve`；测试断言用 `path.sep` 拼接 |
| 符号链接逃逸 | 监狱检查用 `fs.realpath` 后再判断前缀 |
| ffmpeg 缺失（本地/用户机） | media 工具返回结构化错误而非崩溃；`media.probe` 前先探测 ffmpeg |
| 目录模型 ID 过时 | 目录允许小步 PR 修正；运行时以 listModels 实测为准 |
| 与主线 push 竞争 | 小步提交 + `pull --rebase`；一次推送一件事 |
| 根 tsconfig strict 联动 | 新包代码写完先本地 `bun run typecheck`（CI 同款）再推 |

---

## 8. 附录

### 附录 A：既有冻结契约（`@videoos/agent`，只读）

```ts
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest { id: string; name: string; arguments: Record<string, unknown>; }

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;      // role=tool
  name?: string;            // role=tool
  toolCalls?: ToolCallRequest[]; // role=assistant
}

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }

export interface ChatUsage { promptTokens?: number; completionTokens?: number; }

export interface ChatResponse { content: string; toolCalls?: ToolCallRequest[]; model: string; usage?: ChatUsage; }

export interface ChatOptions { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number; }

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: { vision: boolean; tools: boolean };
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

// 工厂已有 env 规则：缺 apiKey 时读 `VIDEOOS_PROVIDER_<ID>_KEY`（id 大写、非字母数字→_）
// OpenAICompatibleOptions { id; baseUrl(含版本段); apiKey?; apiKeyEnv?; model; vision?; tools?; timeoutMs?; fetchImpl? }
// AnthropicOptions     { id; baseUrl(不含 /v1); apiKey?; apiKeyEnv?; model; maxTokens?; vision?; tools?; timeoutMs?; fetchImpl? }
// 均从 "@videoos/agent" 直接 import（tsconfig paths: @videoos/* → packages/*/src）
```

### 附录 B：catalog 单条示例（zhipu）

```json
{
  "id": "zhipu",
  "type": "openai-compatible",
  "name": "Zhipu GLM",
  "nameZh": "智谱 GLM",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "keyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
  "docsUrl": "https://docs.bigmodel.cn/cn/guide/start/model-overview",
  "models": [
    { "id": "glm-4.5", "label": "GLM-4.5", "contextK": 128, "tools": true, "vision": true, "tags": ["flagship"] },
    { "id": "glm-4.5-air", "label": "GLM-4.5 Air", "contextK": 128, "tools": true, "vision": false, "tags": ["cheap"] },
    { "id": "glm-4-flash", "label": "GLM-4 Flash", "tools": true, "vision": false, "tags": ["free"] }
  ],
  "notes": "兼容模式稳定；glm-4-flash 免费"
}
```

### 附录 C：MCP 线协议错误码

```ts
export const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603, SERVER_NOT_INITIALIZED: -32002,
} as const;
```

### 附录 D：技能参考（写新技能前精读这 5 个）

`skills/product-demo/SKILL.md`（五幕结构 + Recipes 范式）、`cinematic-video`、`data-motion`、`short-video`、`visual-qa`。

### 附录 E：`agent-kit-ci.yml` 全文

```yaml
name: Agent Kit CI

on:
  push:
    branches: [main]
    paths:
      - "packages/model-hub/**"
      - "packages/mcp-lite/**"
      - "packages/mcp-host/**"
      - "packages/mcp-fs/**"
      - "packages/mcp-shell/**"
      - "packages/mcp-web/**"
      - "packages/mcp-media/**"
      - "packages/mcp-os/**"
      - "packages/mcp-assets/**"
      - "skills/**"
      - "agent-kit/**"
      - ".github/workflows/agent-kit-ci.yml"
  pull_request:
    paths:
      - "packages/model-hub/**"
      - "packages/mcp-lite/**"
      - "packages/mcp-host/**"
      - "packages/mcp-fs/**"
      - "packages/mcp-shell/**"
      - "packages/mcp-web/**"
      - "packages/mcp-media/**"
      - "packages/mcp-os/**"
      - "packages/mcp-assets/**"
      - "skills/**"
      - "agent-kit/**"
      - ".github/workflows/agent-kit-ci.yml"
  workflow_dispatch:

jobs:
  agent-kit-ubuntu:
    name: Agent Kit (ubuntu)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - name: Install
        run: bun install
      - name: Install ffmpeg (media tools)
        run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - name: Root typecheck (new packages are auto-included)
        run: bun run typecheck
      - name: Test agent-kit packages (present ones only)
        run: |
          DIRS=""
          for p in model-hub mcp-lite mcp-host mcp-fs mcp-shell mcp-web mcp-media mcp-os mcp-assets; do
            if [ -d "packages/$p" ]; then DIRS="$DIRS packages/$p"; fi
          done
          if [ -n "$DIRS" ]; then bun test $DIRS; fi
      - name: Skills check
        run: bun run agent-kit/scripts/check-skills.ts

  agent-kit-windows:
    name: Agent Kit (windows)
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - name: Install
        run: bun install
      - name: Test mcp packages (cross-platform)
        run: |
          DIRS=""
          for p in mcp-lite mcp-host mcp-fs mcp-shell mcp-os; do
            if [ -d "packages/$p" ]; then DIRS="$DIRS packages/$p"; fi
          done
          if [ -n "$DIRS" ]; then bun test $DIRS; fi
```

（Windows job 只测当时已存在的目录 —— AK-M1 落地时先删掉不存在的，后续里程碑逐步加回，Issue 里会逐个提醒。）

### 附录 F：bun fetch mock 陷阱（必读）

本仓库在 a4646f8 踩过：bun 的同进程 fetch 有快路径，mock 全局 fetch 或依赖轻量 Response 会导致 ok/status 不可靠、CI 与本地分叉。**唯一放行姿势**：

```ts
import { createServer } from "node:http";
const server = createServer((req, res) => { /* 喂 wire JSON */ });
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
// 然后真实 fetch(base + "/v1/chat/completions")，或 fetchImpl: (u, i) => fetch(base + u, i)
```

### 附录 G：`mcp.json` 示例（宿主配置）

```json
{
  "servers": {
    "fs":     { "command": "bun", "args": ["run", "packages/mcp-fs/src/index.ts"], "env": { "MCP_FS_ROOTS": "D:/videos" }, "timeoutMs": 20000 },
    "shell":  { "command": "bun", "args": ["run", "packages/mcp-shell/src/index.ts"], "allowedTools": ["shell.which", "shell.exec"] },
    "media":  { "command": "bun", "args": ["run", "packages/mcp-media/src/index.ts"], "enabled": false }
  }
}
```

### 附录 H：新包 package.json 模板

```json
{
  "name": "@videoos/model-hub",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "bun test" }
}
```

（根 bun workspaces `packages/*` 自动纳入；无需改根 package.json —— **禁止**改根文件。）

---

*本 SPEC 由主线 orchestrator 于 v0.1.0 发布后创建（Task ID 12）。契约冻结即视为对外 API：如需变更，先开 Issue 讨论，双方同意后由主线修改附录并同步实现。*

---

## 9. 附录 I：v0.2 范围扩展（2025-09 所有者指令）

本节记录经仓库所有者指令批准的范围扩展，与 §0.2 隔离规则叠加生效（未列出的原规则不变）。

### 9.1 扩展后的交付规模（实测数）

| 支柱 | 原目标（§0.1） | 实际交付 | 备注 |
| --- | --- | --- | --- |
| **P2 Local MCP** | 6 个 mcp-* 服务器 | **25 个服务器 / 113 个内置工具** + mcp-lite + mcp-host + mcp-bridge | 新增：time/json/csv/text/diff/regex/markdown/code/math/image/font/sqlite/git/crypto/color/plot/subtitle/archive/bridge |
| **P3 Skill Library** | 5 → 25 | **42 个技能** | 超额来自真实需求调研（475 条用户 prompt）与 GitHub skills 生态（anthropic/skills、superpowers）的方法论转化 |
| **P4 Plugin System**（新增支柱） | — | **@videoos/plugin-kit + 8 个内置插件（20 工具）** + mcp-bridge 暴露通道 | 支撑主线 Phase 2「插件市场」的运行时地基 |

### 9.2 领地清单相应扩展

在 §0.2 允许清单基础上追加：`packages/mcp-*/**`（通配全部新服务器）、`packages/plugin-kit/**`、`packages/mcp-bridge/**`、`plugins/**`。
主线禁区（apps/**、packages/agent、packages/mcp、引擎包、根文件、主 CI/Release 工作流）**不变**。

### 9.3 工程契约

全部新包遵守 `agent-kit/CONVENTIONS.md`（defineTool + zod + 路径监狱 + 截断/超时 + 协议级 E2E 测试；SKILL.md 走 check-skills.ts 校验）。插件约束（进程内加载、ctx.z 注入 zod、type-only 导入）见 `docs/agent-kit/plugins.md`。

### 9.4 文档锚点

- MCP 目录与接入指南：`docs/agent-kit/mcp-servers.md`（全量 mcp.json 见 `agent-kit/mcp.json`）
- 技能库指南：`docs/agent-kit/skills.md`（索引见 `skills/README.md`）
- 插件系统指南：`docs/agent-kit/plugins.md`
- Model Hub（P1）**未在本轮实现**，仍按 §2 规格待认领。
