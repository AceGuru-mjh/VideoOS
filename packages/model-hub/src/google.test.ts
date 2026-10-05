// GoogleProvider 原生适配器测试（Issue #26）：mock 全分支 ≥ 8 用例，fetchImpl 注入可用。
import { afterAll, describe, expect, it } from "bun:test";
import { ProviderError } from "@videoos/agent";
import { GoogleProvider, toGeminiContents, toGeminiTools } from "./providers/google";
import { closedPortUrl, startRouteMock } from "./test-utils";
import type { RouteMock } from "./test-utils";
import type { ChatMessage, ToolDefinition } from "@videoos/agent";

const mocks: RouteMock[] = [];
afterAll(() => {
  for (const m of mocks) m.stop();
});

const geminiPayload = (parts: Array<Record<string, unknown>>): string =>
  JSON.stringify({
    candidates: [{ content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
  });

const TOOLS: ToolDefinition[] = [
  { name: "compile.run", description: "编译", parameters: { type: "object", properties: {}, required: [] } },
];

describe("GoogleProvider", () => {
  it("纯文本 chat：URL/header/systemInstruction/contents 映射 + 响应解析", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: geminiPayload([{ text: "hello gemini" }]) }));
    mocks.push(mock);
    const provider = new GoogleProvider({
      id: "google",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "g-key",
      model: "gemini-2.5-flash",
      fetchImpl: (u, i) => fetch(mock.url + new URL(String(u)).pathname + new URL(String(u)).search, i),
    });
    const res = await provider.chat([
      { role: "system", content: "你是导演" },
      { role: "user", content: "写个分镜" },
    ]);
    expect(res.content).toBe("hello gemini");
    expect(res.model).toBe("gemini-2.5-flash");
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7 });

    const req = mock.requests[0];
    expect(req.url).toBe(`${mock.url}/v1beta/models/gemini-2.5-flash:generateContent`);
    expect(req.headers["x-goog-api-key"]).toBe("g-key");
    const body = req.body as { systemInstruction?: { parts: Array<{ text: string }> }; contents: Array<{ role: string; parts: Array<{ text: string }> }> };
    expect(body.systemInstruction).toEqual({ parts: [{ text: "你是导演" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "写个分镜" }] }]);
  });

  it("assistant toolCalls → functionCall parts；tool 结果 → functionResponse part", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "调用工具", toolCalls: [{ id: "call_1", name: "compile.run", arguments: { dryRun: true } }] },
      { role: "tool", content: '{"ok":true}', toolCallId: "call_1", name: "compile.run" },
    ];
    const { contents } = toGeminiContents(messages);
    expect(contents[0]).toEqual({
      role: "model",
      parts: [{ text: "调用工具" }, { functionCall: { name: "compile.run", args: { dryRun: true } } }],
    });
    expect(contents[1]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "compile.run", response: { ok: true } } }],
    });
  });

  it("tool 结果非 JSON 时退化为 { result: content }", () => {
    const { contents } = toGeminiContents([{ role: "tool", content: "plain text result", toolCallId: "c1", name: "t" }]);
    expect(contents[0].parts[0]).toEqual({ functionResponse: { name: "t", response: { result: "plain text result" } } });
  });

  it("toGeminiTools：ToolDefinition[] → functionDeclarations", () => {
    expect(toGeminiTools(TOOLS)).toEqual([
      { functionDeclarations: [{ name: "compile.run", description: "编译", parameters: { type: "object", properties: {}, required: [] } }] },
    ]);
  });

  it("带工具调用：请求 tools + generationConfig；响应 functionCall → toolCalls", async () => {
    const mock = await startRouteMock(() => ({
      status: 200,
      payload: geminiPayload([{ functionCall: { name: "compile.run", args: { dryRun: false } } }]),
    }));
    mocks.push(mock);
    const provider = new GoogleProvider({
      id: "google",
      baseUrl: mock.url,
      apiKey: "k",
      model: "gemini-2.5-pro",
      fetchImpl: (u, i) => fetch(u, i) as Promise<Response>,
    });
    const res = await provider.chat([{ role: "user", content: "编译" }], { tools: TOOLS, temperature: 0.2, maxTokens: 512 });
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "compile.run", arguments: { dryRun: false } }]);
    expect(res.content).toBe("");
    const body = mock.requests[0].body as { tools?: unknown; generationConfig?: Record<string, number> };
    expect(body.tools).toEqual(toGeminiTools(TOOLS));
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 512 });
  });

  it("401 → PROVIDER_AUTH", async () => {
    const mock = await startRouteMock(() => ({ status: 401, payload: JSON.stringify({ error: { message: "API key not valid" } }) }));
    mocks.push(mock);
    const provider = new GoogleProvider({ id: "google", baseUrl: mock.url, apiKey: "bad", model: "gemini-2.5-flash" });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("PROVIDER_AUTH");
    expect((err as ProviderError).status).toBe(401);
  });

  it("403 → PROVIDER_AUTH", async () => {
    const mock = await startRouteMock(() => ({ status: 403, payload: "{}" }));
    mocks.push(mock);
    const provider = new GoogleProvider({ id: "google", baseUrl: mock.url, apiKey: "k", model: "m" });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("PROVIDER_AUTH");
  });

  it("429 → PROVIDER_RATE_LIMIT", async () => {
    const mock = await startRouteMock(() => ({ status: 429, payload: JSON.stringify({ error: { message: "Resource exhausted" } }) }));
    mocks.push(mock);
    const provider = new GoogleProvider({ id: "google", baseUrl: mock.url, apiKey: "k", model: "m" });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_RATE_LIMIT");
    expect((err as ProviderError).status).toBe(429);
  });

  it("网络失败（连接拒绝）→ PROVIDER_NETWORK", async () => {
    const url = await closedPortUrl();
    const provider = new GoogleProvider({ id: "google", baseUrl: url, apiKey: "k", model: "m", timeoutMs: 3_000 });
    let err: unknown;
    try {
      await provider.chat([{ role: "user", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect((err as ProviderError).code).toBe("PROVIDER_NETWORK");
  });

  it("非 JSON 响应 → PROVIDER_BAD_RESPONSE", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: "<html>not json</html>" }));
    mocks.push(mock);
    const provider = new GoogleProvider({ id: "google", baseUrl: mock.url, apiKey: "k", model: "m" });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("PROVIDER_BAD_RESPONSE");
  });

  it("apiKeyEnv 回退：缺 apiKey 时读 env", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: geminiPayload([{ text: "ok" }]) }));
    mocks.push(mock);
    process.env.VIDEOOS_PROVIDER_GOOGLE_KEY = "env-google-key";
    try {
      const provider = new GoogleProvider({
        id: "google",
        baseUrl: mock.url,
        apiKeyEnv: "VIDEOOS_PROVIDER_GOOGLE_KEY",
        model: "m",
      });
      await provider.chat([{ role: "user", content: "x" }]);
      expect(mock.requests[0].headers["x-goog-api-key"]).toBe("env-google-key");
    } finally {
      delete process.env.VIDEOOS_PROVIDER_GOOGLE_KEY;
    }
  });

  it("空消息 → PROVIDER_INVALID_INPUT", async () => {
    const provider = new GoogleProvider({ id: "google", baseUrl: "https://x.example", apiKey: "k", model: "m" });
    await expect(provider.chat([])).rejects.toThrow("PROVIDER_INVALID_INPUT");
  });
});
