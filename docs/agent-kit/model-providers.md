# Model Hub 贡献指南 — 如何新增一家模型供应商

> 面向贡献者：把一家新的 LLM 供应商接入 `@videoos/model-hub`。全部代码在 `packages/model-hub/`，
> 契约以 `agent-kit/SPEC.md` §2 为准，本文是它的操作手册。

## 1. Model Hub 是什么（以及刻意不做什么）

`@videoos/model-hub` = **目录（catalog）+ 工厂（factory）+ 诊断器（testConnection）**，服务任何宿主（CLI / 桌面应用）的「选择模型供应商」界面：

```
catalog.json ──validateCatalog──▶ ProviderDescriptor[]
                                       │ createProviderFromDescriptor(desc, creds)
                                       ▼
                              ModelProvider（@videoos/agent 契约）
                                       │ testConnection(desc, creds)
                                       ▼
                          ConnectionReport（ok / latencyMs / models / error）
```

**刻意不做**：对话编排、路由策略、缓存、重试 —— 那些属于 `@videoos/agent`（主线，只许 import 不许改）。Hub 只负责「枚举谁可接 → 实例化 → 验通」三步。

三个主要入口（`packages/model-hub/src/index.ts` 还导出 `validateCatalog` 与两个原生适配器，见 §4.1）：

| API | 作用 |
| --- | --- |
| `loadCatalog()` / `getDescriptor(id)` | 装载并缓存 catalog.json（首次调用跑 zod 校验）；按 id 查条目 |
| `createProviderFromDescriptor(desc, creds)` | 目录条目 + 凭据 → `ModelProvider` 实例 |
| `testConnection(desc, creds, opts?)` | 连通性诊断：五分支错误分类 + `latencyMs` + 实测模型列表 |

当前目录 **25 条**：24 家真实供应商 + 1 条 `custom` 模板（用户自填 OpenAI 兼容端点）。

## 2. 目录条目字段（catalog.json）

新增一家 = 在 `packages/model-hub/src/catalog.json` 追加一个 `ProviderDescriptor` 对象。字段逐个说明：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | `string` | 稳定小写 kebab：`/^[a-z][a-z0-9-]*$/`（字母开头），全目录唯一；**同时是 env key 派生源**（§5） |
| `type` | enum | `openai-compatible` / `anthropic` / `google` / `azure-openai` / `custom`，决定工厂走哪条分支（下表） |
| `name` | `string` | 英文展示名，如 `"DeepSeek"`，非空 |
| `nameZh` | `string` | 中文展示名，如 `"深度求索"`，非空（设置界面中文标签） |
| `baseUrl` | `string` | 默认完整 base；除 `custom`（允许空串）外必须 `http://` 或 `https://` 开头。语义按 type 见下表 |
| `keyUrl` | `string?` | 获取 key 的控制台地址（合法 URL）。**非 local 家必填**（设置界面直接跳转）；`local: true` 与 `custom` 豁免 |
| `docsUrl` | `string?` | 文档地址，可选 |
| `local` | `boolean?` | 本地推理（ollama / lmstudio）标记：无需 key |
| `models` | `CatalogModel[]` | **至少 1 条**，条目内模型 id 唯一。注意：这是**快照提示，会过时** —— 运行时一律以 `testConnection().models` 实测为准 |
| `notes` | `string?` | 接入注意事项（quirk），设置界面提示用 —— 有坑必写（§7） |

`CatalogModel`：`id`（供应商侧模型名，如 `"glm-4.5"`）/ `label`（展示名）/ `contextK?`（上下文窗口，千 token）/ `tools` / `vision`（capabilities 来源）/ `tags?`（`fast` / `reasoning` / `cheap`…）/ `pricingHint?`（仅展示用）。

### 2.1 `type` 怎么选（工厂分支对照）

| type | 工厂产物 | 什么时候用 | baseUrl 语义 |
| --- | --- | --- | --- |
| `openai-compatible` | `@videoos/agent` `OpenAICompatibleProvider` | 对方提供 OpenAI 形状的 `/chat/completions`（绝大多数家） | **含版本段**，如 `https://api.deepseek.com/v1`；请求时拼 `/chat/completions` 与 `/models` |
| `anthropic` | `@videoos/agent` `AnthropicProvider` | Anthropic 官方 | **不含 `/v1`**（适配器请求时拼 `/v1/messages`）；`max_tokens` 必填（缺省 4096） |
| `google` | 本包 `GoogleProvider` | Gemini 官方 API（generateContent 线形状，非 OpenAI 兼容） | 填 `https://generativelanguage.googleapis.com`（无路径） |
| `azure-openai` | 本包 `AzureOpenAIProvider` | Azure OpenAI | `https://<resource>.openai.azure.com`（占位符也过 baseUrl 前缀校验）；**model 填部署名** |
| `custom` | 同 `openai-compatible` 行为 | 用户自定义网关模板 | 允许空串；运行时必须由 `creds.baseUrl` 补全，否则工厂抛 `HUB_MISSING_BASE_URL` |

只有 `google` / `azure-openai` 有本包原生适配器（`src/providers/`）；**不要为其他家新增适配器** —— OpenAI 兼容是默认路径。

## 3. zod 校验规则（`catalog-schema.ts`）

`loadCatalog()` 首次调用即跑 `validateCatalog`，任何违规抛 `CatalogValidationError`（`violations: string[]` 逐条列出，含 `catalog[i].field` 路径）。新增条目必须全过：

1. 顶层是 JSON 数组；逐条 `descriptorSchema` 校验（`id` kebab 正则、`type` 枚举、`name`/`nameZh` 非空、`keyUrl`/`docsUrl` 是合法 URL、`models` 至少 1 条且模型 id 非空）；
2. `id` 全目录唯一（重复 → `duplicate id "..."`）；
3. `baseUrl` 规则：`custom` 豁免；其余必须 `^https?://`（azure 的 `<resource>` 占位符也满足前缀规则）；
4. `keyUrl` 规则：`custom` 或 `local: true` 豁免；其余缺 keyUrl → `non-local providers must set keyUrl (console URL for API keys)`；
5. 条目内模型 `id` 不得重复。

## 4. 工厂行为速查（`factory.ts`）

```ts
import { createProviderFromDescriptor, getDescriptor, loadCatalog } from "@videoos/model-hub";

const desc = getDescriptor("deepseek");            // 目录条目
const provider = createProviderFromDescriptor(desc, {
  apiKey: "sk-...",        // 缺省 → env 回退（§5）
  baseUrl: undefined,      // 覆盖目录默认（custom 必填）
  model: "deepseek-reasoner", // 缺省取 models[0].id
  timeoutMs: 30_000,
});
const res = await provider.chat([{ role: "user", content: "hi" }]);
// provider.capabilities.vision/tools 来自选中模型条目（vision 缺省 false / tools 缺省 true）
```

- 模型解析：`creds.model ?? desc.models[0].id`；目录无模型 → `ProviderError("HUB_NO_MODELS")`；条目找不到该模型 → 按保守值（vision=false / tools=true）。
- `openai-compatible` / `custom` 空 baseUrl → `ProviderError("HUB_MISSING_BASE_URL")`。
- 未知 `type` → `ProviderError("HUB_UNKNOWN_TYPE")`。
- `local: true` 家不要求 key：缺 key 不在工厂拦截，云端家会在 `chat()` 时自然报 `PROVIDER_AUTH`（既有语义）。

### 4.1 两个原生适配器的线形状

| | GoogleProvider | AzureOpenAIProvider |
| --- | --- | --- |
| 请求 | `POST {base}/v1beta/models/{model}:generateContent` | `POST {base}/openai/deployments/{model}/chat/completions?api-version=2024-10-21` |
| 鉴权头 | `x-goog-api-key` | `api-key` |
| 消息映射 | system → `systemInstruction`；user/assistant → `contents`（role `user`/`model`）；assistant toolCalls → `functionCall` part；role=tool → user 轮 `functionResponse` part | 复用 `@videoos/agent` 的 `toOpenAiMessages` / `toOpenAiTools`（与 OpenAI wire 相同） |
| 工具 | `tools.functionDeclarations` | `tools`（OpenAI 形状） |
| usage | `usageMetadata.promptTokenCount/candidatesTokenCount` | `usage.prompt_tokens/completion_tokens` |
| 错误 | 401/403→`PROVIDER_AUTH`；429→`PROVIDER_RATE_LIMIT`；fetch 抛错→`PROVIDER_NETWORK`；其余 HTTP→`PROVIDER_HTTP_ERROR`；非 JSON→`PROVIDER_BAD_RESPONSE` | 同左；404 单独提示 `deployment "<model>" not found — model must be the deployment name` |
| 缺省超时 | 120_000ms（可被 `creds.timeoutMs` 覆盖） | 同左 |

两者都实现 `ModelProvider`，都接受 `fetchImpl` 注入（测试用）。

## 5. Env key 回退规则

`creds.apiKey` 缺省时，工厂用 `providerKeyEnvName(desc.id)`（`@videoos/agent` 既有规则）生成 env 名并传给适配器：

```
id "deepseek"            → VIDEOOS_PROVIDER_DEEPSEEK_KEY
id "azure-openai"        → VIDEOOS_PROVIDER_AZURE_OPENAI_KEY     （'-' → '_'，大写）
id "qwen"                → VIDEOOS_PROVIDER_QWEN_KEY
```

规则：`VIDEOOS_PROVIDER_` + `id.toUpperCase()`（非字母数字 → `_`）+ `_KEY`。`testConnection` 读取 env 用同一条规则 —— 文档与设置界面提示用户配这个名字。

## 6. 诊断 testConnection：五分支分类表

```ts
import { getDescriptor, testConnection } from "@videoos/model-hub";

const report = await testConnection(getDescriptor("zhipu")!, { apiKey: "..." }, { timeoutMs: 10_000 });
if (report.ok) console.log(report.latencyMs, report.models);   // models = 实测列表
else console.error(report.error!.kind, report.error!.hint);   // 设置界面直接展示
```

探测策略（按 type）：

- `openai-compatible` / `custom` → **快路径 `GET {base}/models`**（有 key 时带 `authorization: Bearer`）；200 → 解析 `data[].id` 返回模型列表；**404 → 退化为最小 chat**（`chat([{role:"user",content:"ping"}], { maxTokens: 1 })`）；`custom` 空 baseUrl → 直接 `unknown` 分支（hint 提示填完整 base，如 `https://your-gateway.com/v1`）。
- `google` → `GET {base}/v1beta/models`（`x-goog-api-key` 头），模型名剥 `models/` 前缀。
- `anthropic` / `azure-openai` → 无列表端点，直接最小 chat（maxTokens: 1）。
- 列表探测缺省超时 15_000ms（`opts.timeoutMs` 覆盖）；`opts.fetchImpl` 可注入。

错误分类（`classify`，diagnostics.ts）：

| 观测 | `error.kind` | hint（原文要点） |
| --- | --- | --- |
| HTTP 401/403 或 `PROVIDER_AUTH` | `auth` | 检查 API Key 正确性 / 余额 / 该模型调用权限 |
| HTTP 429 或 `PROVIDER_RATE_LIMIT` | `rate-limit` | 请求过于频繁或额度耗尽，稍后重试 |
| HTTP 404 **且来自 chat 退化请求**（或 `PROVIDER_MODEL_NOT_FOUND`） | `model` | 检查模型名 / Azure 部署名（以 `testConnection().models` 实测为准） |
| fetch 抛错（DNS/ECONN）或 `PROVIDER_NETWORK` / `PROVIDER_REQUEST_FAILED` | `network` | 检查网络连接 / 代理设置 / baseUrl |
| 其他 | `unknown` | message 附响应体（或错误消息）**前 300 字符** |

注意 `model` 分支只在 `fromChatFallback` 时成立：`GET /models` 404 走退化而不是报 model 错。

## 7. 已知 quirks（catalog `notes` 原文）

接入前先看同行踩过的坑；新增条目若有坑，写进 `notes`：

| id | notes（catalog.json 原文） |
| --- | --- |
| anthropic | baseUrl 不含 /v1（请求时拼 /v1/messages）；max_tokens 必填，缺省 4096 |
| zhipu | 兼容模式稳定；glm-4-flash 免费 |
| doubao | 模型名或接入点 ID 皆可（ep- 开头的是接入点） |
| minimax | 海外域名 api.minimax.io 与国内 api.minimaxi.com 并存，注意区分 |
| ernie | v2 是新版鉴权（API Key 直接 Bearer）；v1 需 access_token 换取，勿混用 |
| spark | APIKey 格式为 key:secret 拼接（控制台直接复制整串） |
| mistral | function name 仅允许 [a-zA-Z0-9_]（工具名中的点要替换） |
| openrouter | 聚合站：模型名带命名空间；计费走 OpenRouter 余额 |
| groq | 极速推理；限流较严（429 常见） |
| perplexity | 搜索增强：baseUrl 无 /v1 段（请求时拼 /chat/completions）；响应含 citations |
| azure-openai | baseUrl 需替换 `<resource>` 为资源名；model 填部署名（deployment），不是模型名 |
| siliconflow | 聚合站：模型名带命名空间（厂商/模型）；/models 可枚举全部 |
| cohere | 用 /compatibility/v1 兼容端点（原生 v2 端点不兼容 OpenAI 形状） |

## 8. 测试要求（新条目必须补的用例）

**红线：禁止 mock 全局 fetch。** bun 的同进程 fetch 有快路径，mock 全局 fetch 或依赖轻量 Response 会导致 `ok`/`status` 不可靠、CI 与本地分叉（仓库已踩坑，commit `a4646f8`，SPEC 附录 F）。唯一放行姿势：`node:http` 起真服务（127.0.0.1 随机端口）+ 真实 fetch / 显式 `fetchImpl` 直连 —— 复用 `src/test-utils.ts` 的 `startRouteMock`（含请求捕获）与 `closedPortUrl`（网络错误分支）：

```ts
import { openAiChatPayload, startRouteMock } from "./test-utils";

const mock = await startRouteMock(() => ({ status: 200, payload: openAiChatPayload("ok", "mock") }));
const provider = createProviderFromDescriptor(desc, { baseUrl: mock.url, apiKey: "test-key" });
const res = await provider.chat([{ role: "user", content: "hi" }]);
expect(mock.requests[0].url).toBe(`${mock.url}/chat/completions`);
expect(mock.requests[0].headers.authorization).toBe("Bearer test-key");
```

新增一家（或一个新 family）时：

1. **catalog 合法性**：`catalog.test.ts` 覆盖 zod 规则（id 唯一/kebab、baseUrl http(s)、非 local 家 keyUrl、模型 ≥ 1）—— 新条目自动被 `loadCatalog()` 校验，坏了整个套件就红。
2. **把新 family 加进 openai-compatible 冒烟循环**：`factory.test.ts` 的 "全量 openai-compatible 家冒烟" describe —— `families = loadCatalog().filter(d => d.type === "openai-compatible" || d.type === "custom")`，断言家数 ≥ 20，每家跑一次 mock chat（`res.content === "ok"`、`res.model === models[0].id`）。新条目会自动进循环；若修了枚举断言，记得同步数字。
3. **每个新 family ≥ 1 个 mock chat 用例**：参照 `factory.test.ts` 首批 8 家（openai/deepseek/zhipu/qwen/moonshot/doubao/minimax/siliconflow）的写法 —— 断言 URL、鉴权头、默认模型名。
4. **diagnostics 五分支**：auth（401/403）、network（`closedPortUrl()` 或 fetch 抛错）、model（chat 退化 404）、rate-limit（429）、unknown + 前 300 字符 —— `diagnostics.test.ts` 已有骨架，新 native 适配器需各自跑一遍。
5. 全部离线可跑：`bun test packages/model-hub`（P1 目标 ≥ 60 用例）。

## 9. 收尾清单

- [ ] catalog.json 新条目过 `validateCatalog`（含 `notes` quirk）
- [ ] `factory.test.ts` 冒烟循环含新 family，≥ 1 mock chat
- [ ] 若新增 type：factory 分支 + `HUB_UNKNOWN_TYPE` 负例 + native 适配器测试（参照 google/azure）
- [ ] `bun run typecheck` 绿（新包文件自动纳入根 tsconfig）
- [ ] `Agent Kit CI`（ubuntu）绿 —— catalog 改动会触发（路径过滤含 `packages/model-hub/**`）
