// Provider 测试（全部离线）：
// - ManualProvider 脚本序列消费 / 耗尽返回 done
// - OpenAICompatibleProvider / AnthropicProvider 用 Bun.serve 本地 mock（127.0.0.1 随机端口）
//   断言请求体格式（messages/tools 转换、鉴权头）与响应解析（tool_calls / content / usage）
// - loadProviderConfig env 解析 + createProvider 工厂
import { afterAll, describe, expect, it } from "bun:test";
import { AnthropicProvider, toAnthropicMessages, toAnthropicTools } from "./providers/anthropic";
import { createProvider, createProvidersFromEnv, loadProviderConfig, providerKeyEnvName } from "./providers/config";
import { ManualProvider } from "./providers/manual";
import { OpenAICompatibleProvider, toOpenAiMessages, toOpenAiTools } from "./providers/openai-compatible";
import { ProviderError } from "./providers/types";
import type { ChatMessage, ToolDefinition } from "./providers/types";

// ---------------------------------------------------------------------------
// mock server 基建
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface MockServer {
  url: string;
  requests: CapturedRequest[];
  respondWith: (status: number, payload: string) => void;
  stop(): void;
}

function startMock(initialStatus: number, initialPayload: string): MockServer {
  const requests: CapturedRequest[] = [];
  let status = initialStatus;
  let payload = initialPayload;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      requests.push({
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
        body: JSON.parse(await req.text() as string),
      });
      return new Response(payload, { status, headers: { "content-type": "application/json" } });
    },
  });
  return {
    url: server.url.toString().replace(/\/$/, ""),
    requests,
    respondWith: (nextStatus: number, nextPayload: string): void => {
      status = nextStatus;
      payload = nextPayload;
    },
    stop: (): void => {
      void server.stop(true);
    },
  };
}

const servers: MockServer[] = [];
afterAll(() => {
  for (const s of servers) s.stop();
});

const TOOLS: ToolDefinition[] = [
  { name: "compile.run", description: "编译", parameters: { type: "object", properties: {}, required: [] } },
];

const CONVERSATION: ChatMessage[] = [
  { role: "system", content: "你是视频工程师" },
  { role: "user", content: "编译一下" },
  { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "compile.run", arguments: {} }] },
  { role: "tool", content: '{"ok":true}', toolCallId: "call_1", name: "compile.run" },
];

// ---------------------------------------------------------------------------
// ManualProvider
// ---------------------------------------------------------------------------

describe("ManualProvider", () => {
  it("按序消费脚本；耗尽后固定 done", async () => {
    const p = new ManualProvider({
      id: "manual",
      script: [
        { content: "第一步" },
        { toolCalls: [{ id: "c1", name: "compile.run", arguments: {} }] },
        { content: "完成", toolCalls: [{ id: "c2", name: "scene.list", arguments: {} }] },
      ],
    });
    expect(p.capabilities).toEqual({ vision: false, tools: true });
    const r1 = await p.chat([{ role: "user", content: "hi" }]);
    expect(r1).toEqual({ content: "第一步", model: "manual-script" });
    const r2 = await p.chat([{ role: "user", content: "hi" }]);
    expect(r2.content).toBe("");
    expect(r2.toolCalls).toEqual([{ id: "c1", name: "compile.run", arguments: {} }]);
    const r3 = await p.chat([{ role: "user", content: "hi" }]);
    expect(r3.content).toBe("完成");
    expect(r3.toolCalls).toHaveLength(1);
    const r4 = await p.chat([{ role: "user", content: "hi" }]);
    const r5 = await p.chat([{ role: "user", content: "hi" }]);
    expect(r4).toEqual({ content: "done", model: "manual-script" });
    expect(r5).toEqual({ content: "done", model: "manual-script" });
    expect(p.consumed).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider（mock server）
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProvider", () => {
  it("请求体 tools 格式 / 鉴权头 / 尾斜杠归一 / 响应解析 tool_calls + usage", async () => {
    const mock = startMock(200, JSON.stringify({
      choices: [{
        message: {
          content: "开始编译",
          tool_calls: [{ id: "call_9", type: "function", function: { name: "compile.run", arguments: "{\"scene\":\"intro\"}" } }],
        },
      }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }));
    servers.push(mock);
    const provider = new OpenAICompatibleProvider({
      id: "glm",
      baseUrl: `${mock.url}/api/paas/v4/`, // 尾斜杠 → 归一去除
      apiKey: "sk-test-key",
      model: "glm-4.6",
      fetchImpl: fetch,
    });
    const res = await provider.chat(CONVERSATION, { tools: TOOLS, temperature: 0.2, maxTokens: 512 });

    // 请求断言
    expect(mock.requests).toHaveLength(1);
    const req = mock.requests[0]!;
    expect(req.url).toBe(`${mock.url}/api/paas/v4/chat/completions`);
    expect(req.headers.authorization).toBe("Bearer sk-test-key");
    expect(req.headers["content-type"]).toBe("application/json");
    const body = req.body as Record<string, unknown>;
    expect(body.model).toBe("glm-4.6");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(512);
    // tools：[{type:"function",function:{name,description,parameters}}]
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe("function");
    expect(tools[0]!.function).toEqual({ name: "compile.run", description: "编译", parameters: TOOLS[0]!.parameters });
    // messages：assistant tool_calls 序列化、tool 消息带 tool_call_id
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]!.role).toBe("system");
    const assistant = messages[2]!;
    expect(assistant.role).toBe("assistant");
    const wireCalls = assistant.tool_calls as Array<Record<string, unknown>>;
    expect(wireCalls[0]!.id).toBe("call_1");
    expect((wireCalls[0]!.function as Record<string, unknown>).arguments).toBe("{}");
    const toolMsg = messages[3]!;
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_1");

    // 响应解析
    expect(res.content).toBe("开始编译");
    expect(res.model).toBe("glm-4.6");
    expect(res.toolCalls).toEqual([{ id: "call_9", name: "compile.run", arguments: { scene: "intro" } }]);
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
  });

  it("非 2xx → ProviderError（含状态码与响应体前 500 字符）", async () => {
    const longBody = "x".repeat(800);
    const mock = startMock(500, JSON.stringify({ error: { message: `boom ${longBody}` } }));
    servers.push(mock);
    const provider = new OpenAICompatibleProvider({ id: "x", baseUrl: mock.url, apiKey: "k", model: "m", fetchImpl: fetch });
    let caught: ProviderError | null = null;
    try {
      await provider.chat([{ role: "user", content: "hi" }]);
    } catch (err) {
      caught = err as ProviderError;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(ProviderError);
    expect(caught!.code).toBe("PROVIDER_HTTP_ERROR");
    expect(caught!.status).toBe(500);
    expect(caught!.body!.length).toBeLessThanOrEqual(500);
    expect(caught!.message).toMatch(/HTTP 500/);
  });

  it("非 JSON 响应 → PROVIDER_BAD_RESPONSE", async () => {
    const mock = startMock(200, "<html>not json</html>");
    servers.push(mock);
    const provider = new OpenAICompatibleProvider({ id: "x", baseUrl: mock.url, model: "m", fetchImpl: fetch });
    expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/PROVIDER_BAD_RESPONSE/);
  });

  it("toOpenAiMessages / toOpenAiTools 纯函数", () => {
    expect(toOpenAiMessages([{ role: "user", content: "q" }])).toEqual([{ role: "user", content: "q" }]);
    expect(toOpenAiTools(TOOLS)[0]).toEqual({ type: "function", function: { name: "compile.run", description: "编译", parameters: TOOLS[0]!.parameters } });
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider（mock server）
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {
  it("system 顶层提取 / tool_use+tool_result 转换 / headers / 响应解析", async () => {
    const mock = startMock(200, JSON.stringify({
      content: [
        { type: "text", text: "分析完成" },
        { type: "tool_use", id: "tu_1", name: "scene.list", input: { detailed: true } },
      ],
      usage: { input_tokens: 13, output_tokens: 5 },
    }));
    servers.push(mock);
    const provider = new AnthropicProvider({
      id: "claude",
      baseUrl: `${mock.url}/`, // 尾斜杠归一
      apiKey: "ak-test",
      model: "claude-sonnet-4",
      fetchImpl: fetch,
    });
    const res = await provider.chat(CONVERSATION, { tools: TOOLS });

    const req = mock.requests[0]!;
    expect(req.url).toBe(`${mock.url}/v1/messages`);
    expect(req.headers["x-api-key"]).toBe("ak-test");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    const body = req.body as Record<string, unknown>;
    expect(body.system).toBe("你是视频工程师");
    expect(body.model).toBe("claude-sonnet-4");
    expect(body.max_tokens).toBe(4096); // Anthropic 必填默认
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toBe("编译一下");
    // assistant：content blocks 数组（text 可选 + tool_use）
    const assistant = messages[1]!;
    expect(assistant.role).toBe("assistant");
    const blocks = assistant.content as Array<Record<string, unknown>>;
    expect(blocks.some((b) => b.type === "tool_use" && b.id === "call_1" && b.name === "compile.run")).toBe(true);
    // tool → user 的 tool_result
    const toolMsg = messages[2]!;
    expect(toolMsg.role).toBe("user");
    const toolBlocks = toolMsg.content as Array<Record<string, unknown>>;
    expect(toolBlocks[0]!.type).toBe("tool_result");
    expect(toolBlocks[0]!.tool_use_id).toBe("call_1");
    // tools：input_schema
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]!.name).toBe("compile.run");
    expect(tools[0]!.input_schema).toEqual(TOOLS[0]!.parameters);

    expect(res.content).toBe("分析完成");
    expect(res.toolCalls).toEqual([{ id: "tu_1", name: "scene.list", arguments: { detailed: true } }]);
    expect(res.usage).toEqual({ promptTokens: 13, completionTokens: 5 });
  });

  it("错误响应 → PROVIDER_HTTP_ERROR", async () => {
    const mock = startMock(401, JSON.stringify({ error: { message: "invalid api key" } }));
    servers.push(mock);
    const provider = new AnthropicProvider({ id: "c", baseUrl: mock.url, apiKey: "bad", model: "m", fetchImpl: fetch });
    expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/PROVIDER_HTTP_ERROR/);
  });

  it("toAnthropicMessages：多条 system 合并、空 content assistant", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "n", arguments: {} }] },
    ]);
    expect(system).toBe("a\n\nb");
    const blocks = messages[0]!.content as Array<Record<string, unknown>>;
    expect(blocks[0]!.type).toBe("tool_use"); // content 为空时不产生 text block
    expect(toAnthropicTools(TOOLS)[0]!.input_schema).toEqual(TOOLS[0]!.parameters);
  });
});

// ---------------------------------------------------------------------------
// 配置装载 + 工厂
// ---------------------------------------------------------------------------

describe("loadProviderConfig / createProvider", () => {
  it("读 VIDEOOS_PROVIDERS JSON；apiKey 缺省回退 VIDEOOS_PROVIDER_<ID>_KEY", () => {
    const env = {
      VIDEOOS_PROVIDERS: JSON.stringify([
        { id: "glm", type: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
        { id: "claude", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "direct-key", model: "claude-sonnet-4" },
      ]),
      VIDEOOS_PROVIDER_GLM_KEY: "env-key",
    };
    const configs = loadProviderConfig({ env });
    expect(configs).toHaveLength(2);
    expect(configs[0]!.apiKey).toBe("env-key");
    expect(configs[1]!.apiKey).toBe("direct-key");
    expect(providerKeyEnvName("glm-4-plus")).toBe("VIDEOOS_PROVIDER_GLM_4_PLUS_KEY");
    // 工厂
    const glm = createProvider(configs[0]!);
    expect(glm).toBeInstanceOf(OpenAICompatibleProvider);
    expect(glm.id).toBe("glm");
    const claude = createProvider(configs[1]!);
    expect(claude).toBeInstanceOf(AnthropicProvider);
  });

  it("空/缺失 env → []；非法 JSON → PROVIDER_CONFIG_INVALID", () => {
    expect(loadProviderConfig({ env: {} })).toEqual([]);
    expect(loadProviderConfig({ env: { VIDEOOS_PROVIDERS: "  " } })).toEqual([]);
    expect(() => loadProviderConfig({ env: { VIDEOOS_PROVIDERS: "{oops" } })).toThrow(ProviderError);
    expect(() => loadProviderConfig({ env: { VIDEOOS_PROVIDERS: '{"a":1}' } })).toThrow(/must be a JSON array/);
    expect(() => loadProviderConfig({ env: { VIDEOOS_PROVIDERS: '[{"id":"x","type":"weird","model":"m"}]' } })).toThrow(/type.*must be/);
    expect(() => loadProviderConfig({ env: { VIDEOOS_PROVIDERS: '[{"id":"x","type":"anthropic","model":"m"}]' } })).toThrow(/baseUrl.*required/);
  });

  it("manual 类型工厂 + createProvidersFromEnv", () => {
    const env = {
      VIDEOOS_PROVIDERS: JSON.stringify([
        { id: "demo", type: "manual", model: "demo-model", script: [{ content: "hello" }] },
      ]),
    };
    const providers = loadProviderConfig({ env }).map((c) => createProvider(c));
    expect(providers[0]).toBeInstanceOf(ManualProvider);
    expect(createProvidersFromEnv({ env })).toHaveLength(1);
    expect(createProvidersFromEnv({ env: {} })).toEqual([]);
  });
});
