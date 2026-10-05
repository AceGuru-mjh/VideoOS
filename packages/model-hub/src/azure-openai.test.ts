// AzureOpenAIProvider 原生适配器测试（Issue #27）：mock 全分支 ≥ 6 用例。
import { afterAll, describe, expect, it } from "bun:test";
import { ProviderError, toOpenAiMessages } from "@videoos/agent";
import { AZURE_API_VERSION, AzureOpenAIProvider } from "./providers/azure-openai";
import { closedPortUrl, startRouteMock } from "./test-utils";
import type { RouteMock } from "./test-utils";
import type { ToolDefinition } from "@videoos/agent";

const mocks: RouteMock[] = [];
afterAll(() => {
  for (const m of mocks) m.stop();
});

const chatPayload = (content: string): string =>
  JSON.stringify({
    choices: [{ message: { content, role: "assistant" } }],
    usage: { prompt_tokens: 8, completion_tokens: 3 },
  });

const TOOLS: ToolDefinition[] = [
  { name: "compile.run", description: "编译", parameters: { type: "object", properties: {}, required: [] } },
];

describe("AzureOpenAIProvider", () => {
  it("chat：deployment URL + api-key 头 + OpenAI wire body + 响应解析", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: chatPayload("hello azure") }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({
      id: "azure-openai",
      baseUrl: mock.url,
      apiKey: "az-key",
      model: "my-gpt4o-deployment",
    });
    const res = await provider.chat([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("hello azure");
    expect(res.model).toBe("my-gpt4o-deployment");
    expect(res.usage).toEqual({ promptTokens: 8, completionTokens: 3 });

    const req = mock.requests[0];
    expect(req.url).toBe(`${mock.url}/openai/deployments/my-gpt4o-deployment/chat/completions?api-version=${AZURE_API_VERSION}`);
    expect(req.headers["api-key"]).toBe("az-key");
    expect(req.headers.authorization).toBeUndefined();
    expect((req.body as { messages: unknown[] }).messages).toEqual(toOpenAiMessages([{ role: "user", content: "hi" }]));
  });

  it("api-version 常量为 2024-10-21", () => {
    expect(AZURE_API_VERSION).toBe("2024-10-21");
  });

  it("工具调用：请求 tools + 响应 tool_calls 解析", async () => {
    const mock = await startRouteMock(() => ({
      status: 200,
      payload: JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              role: "assistant",
              tool_calls: [{ id: "call_2", type: "function", function: { name: "compile.run", arguments: "{}" } }],
            },
          },
        ],
      }),
    }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "k", model: "dep" });
    const res = await provider.chat([{ role: "user", content: "go" }], { tools: TOOLS, temperature: 0.5 });
    expect(res.toolCalls).toEqual([{ id: "call_2", name: "compile.run", arguments: {} }]);
    const body = mock.requests[0].body as { tools?: Array<{ function: { name: string } }>; temperature?: number };
    expect(body.tools?.[0].function.name).toBe("compile.run");
    expect(body.temperature).toBe(0.5);
  });

  it("401 → PROVIDER_AUTH", async () => {
    const mock = await startRouteMock(() => ({ status: 401, payload: "{}" }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "bad", model: "dep" });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_AUTH");
    expect((err as ProviderError).status).toBe(401);
  });

  it("403 → PROVIDER_AUTH", async () => {
    const mock = await startRouteMock(() => ({ status: 403, payload: "{}" }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "k", model: "dep" });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("PROVIDER_AUTH");
  });

  it("429 → PROVIDER_RATE_LIMIT", async () => {
    const mock = await startRouteMock(() => ({ status: 429, payload: "{}" }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "k", model: "dep" });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_RATE_LIMIT");
  });

  it("404 → PROVIDER_HTTP_ERROR 且 message 提示部署名", async () => {
    const mock = await startRouteMock(() => ({ status: 404, payload: JSON.stringify({ error: { message: "Deployment not found" } }) }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "k", model: "wrong-dep" });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_HTTP_ERROR");
    expect((err as ProviderError).status).toBe(404);
    expect((err as Error).message).toContain("deployment");
  });

  it("网络失败 → PROVIDER_NETWORK", async () => {
    const url = await closedPortUrl();
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: url, apiKey: "k", model: "dep", timeoutMs: 3_000 });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_NETWORK");
  });

  it("非 JSON → PROVIDER_BAD_RESPONSE；空消息 → PROVIDER_INVALID_INPUT", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: "oops" }));
    mocks.push(mock);
    const provider = new AzureOpenAIProvider({ id: "azure-openai", baseUrl: mock.url, apiKey: "k", model: "dep" });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("PROVIDER_BAD_RESPONSE");
    await expect(provider.chat([])).rejects.toThrow("PROVIDER_INVALID_INPUT");
  });
});
