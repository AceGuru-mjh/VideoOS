// testConnection 诊断器测试（Issue #28）：五分支分类 + ok 分支 ≥ 10 用例（全部离线 mock）。
import { afterAll, describe, expect, it } from "bun:test";
import { getDescriptor } from "./index";
import { testConnection } from "./diagnostics";
import { closedPortUrl, openAiModelsPayload, startRouteMock } from "./test-utils";
import type { RouteMock } from "./test-utils";
import type { ProviderDescriptor } from "./types";

const mocks: RouteMock[] = [];
afterAll(() => {
  for (const m of mocks) m.stop();
});

const chatOkPayload = JSON.stringify({ content: [{ type: "text", text: "ok" }] });
const openAiChatOk = JSON.stringify({ choices: [{ message: { content: "ok", role: "assistant" } }] });

const desc = (id: string): ProviderDescriptor => getDescriptor(id) as ProviderDescriptor;

describe("testConnection — openai-compatible 家", () => {
  it("ok：/models 200 → 模型列表 + 延迟", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: openAiModelsPayload(["gpt-4o", "gpt-4o-mini"]) }));
    mocks.push(mock);
    const report = await testConnection(desc("openai"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.ok).toBe(true);
    expect(report.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(report.latencyMs).toBeGreaterThanOrEqual(0);
    expect(report.error).toBeUndefined();
  });

  it("auth：/models 401 → kind=auth + hint", async () => {
    const mock = await startRouteMock(() => ({ status: 401, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("deepseek"), { baseUrl: mock.url, apiKey: "bad" });
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe("auth");
    expect(report.error?.hint).toContain("API Key");
  });

  it("auth：/models 403 → kind=auth", async () => {
    const mock = await startRouteMock(() => ({ status: 403, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("zhipu"), { baseUrl: mock.url, apiKey: "no-perm" });
    expect(report.error?.kind).toBe("auth");
  });

  it("rate-limit：/models 429 → kind=rate-limit", async () => {
    const mock = await startRouteMock(() => ({ status: 429, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("groq"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe("rate-limit");
    expect(report.error?.hint).toContain("稍后重试");
  });

  it("unknown：/models 500 → kind=unknown 且附响应前 300 字符", async () => {
    const longBody = "x".repeat(600);
    const mock = await startRouteMock(() => ({ status: 500, payload: JSON.stringify({ detail: longBody }) }));
    mocks.push(mock);
    const report = await testConnection(desc("qwen"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.error?.kind).toBe("unknown");
    expect(report.error?.message.length).toBeLessThanOrEqual(320);
  });

  it("network：连接拒绝 → kind=network + hint", async () => {
    const url = await closedPortUrl();
    const report = await testConnection(desc("moonshot"), { baseUrl: url, apiKey: "k" }, { timeoutMs: 3_000 });
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe("network");
    expect(report.error?.hint).toContain("baseUrl");
  });

  it("model：/models 404 → 退化 chat 404 → kind=model", async () => {
    const mock = await startRouteMock(() => {
      // /models 404 → 触发退化；chat 也 404 → model 分类
      return { status: 404, payload: "{}" };
    });
    mocks.push(mock);
    const report = await testConnection(desc("minimax"), { baseUrl: mock.url, apiKey: "k", model: "nonexistent-model" });
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe("model");
    expect(report.error?.hint).toContain("模型名");
  });

  it("退化成功：/models 404 → chat 200 → ok=true（无 models 列表）", async () => {
    const mock = await startRouteMock((req) =>
      req.url.endsWith("/models") ? { status: 404, payload: "{}" } : { status: 200, payload: openAiChatOk },
    );
    mocks.push(mock);
    const report = await testConnection(desc("siliconflow"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.ok).toBe(true);
    expect(report.models).toBeUndefined();
    expect(mock.requests.length).toBe(2);
    expect(mock.requests[1].url).toContain("/chat/completions");
  });
});

describe("testConnection — google 家", () => {
  it("ok：/v1beta/models 200 → 模型名剥 models/ 前缀", async () => {
    const mock = await startRouteMock(() => ({
      status: 200,
      payload: JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-2.5-pro" }] }),
    }));
    mocks.push(mock);
    const report = await testConnection(desc("google"), { baseUrl: mock.url, apiKey: "g" });
    expect(report.ok).toBe(true);
    expect(report.models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(mock.requests[0].headers["x-goog-api-key"]).toBe("g");
  });

  it("auth：listModels 401 → kind=auth", async () => {
    const mock = await startRouteMock(() => ({ status: 401, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("google"), { baseUrl: mock.url, apiKey: "bad" });
    expect(report.error?.kind).toBe("auth");
  });

  it("rate-limit：listModels 429 → kind=rate-limit", async () => {
    const mock = await startRouteMock(() => ({ status: 429, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("google"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.error?.kind).toBe("rate-limit");
  });
});

describe("testConnection — anthropic / azure-openai（最小 chat 退化）", () => {
  it("anthropic：chat 200 → ok=true（POST /v1/messages, max_tokens=1）", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: chatOkPayload }));
    mocks.push(mock);
    const report = await testConnection(desc("anthropic"), { baseUrl: mock.url, apiKey: "sk-x" });
    expect(report.ok).toBe(true);
    expect(report.models).toBeUndefined();
    const req = mock.requests[0];
    expect(req.url).toBe(`${mock.url}/v1/messages`);
    expect((req.body as { max_tokens: number }).max_tokens).toBe(1);
    expect(req.headers["x-api-key"]).toBe("sk-x");
  });

  it("anthropic：chat 401 → kind=auth", async () => {
    const mock = await startRouteMock(() => ({ status: 401, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("anthropic"), { baseUrl: mock.url, apiKey: "bad" });
    expect(report.error?.kind).toBe("auth");
  });

  it("azure-openai：chat 200 → ok=true（URL 带 api-version 与 deployment）", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: openAiChatOk }));
    mocks.push(mock);
    const report = await testConnection(desc("azure-openai"), {
      baseUrl: mock.url,
      apiKey: "az",
      model: "my-deployment",
    });
    expect(report.ok).toBe(true);
    const req = mock.requests[0];
    expect(req.url).toContain("/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21");
    expect(req.headers["api-key"]).toBe("az");
  });

  it("azure-openai：chat 404（部署不存在）→ kind=model", async () => {
    const mock = await startRouteMock(() => ({ status: 404, payload: "{}" }));
    mocks.push(mock);
    const report = await testConnection(desc("azure-openai"), {
      baseUrl: mock.url,
      apiKey: "az",
      model: "missing-deployment",
    });
    expect(report.error?.kind).toBe("model");
  });
});

describe("testConnection — custom 边界", () => {
  it("custom 未填 baseUrl → 结构化错误（不发请求）", async () => {
    const report = await testConnection(desc("custom"), { apiKey: "k" });
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe("unknown");
    expect(report.error?.message).toContain("baseUrl");
  });

  it("custom 填 baseUrl 后走 /models 快路径", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: openAiModelsPayload(["my-model"]) }));
    mocks.push(mock);
    const report = await testConnection(desc("custom"), { baseUrl: mock.url, apiKey: "k" });
    expect(report.ok).toBe(true);
    expect(report.models).toEqual(["my-model"]);
  });

  it("fetchImpl 注入可用（无外网依赖）", async () => {
    const mock = await startRouteMock(() => ({ status: 200, payload: openAiModelsPayload(["a", "b"]) }));
    mocks.push(mock);
    const report = await testConnection(
      desc("openai"),
      { baseUrl: mock.url, apiKey: "k" },
      { fetchImpl: (u, i) => fetch(u, i) as Promise<Response> },
    );
    expect(report.ok).toBe(true);
    expect(report.models).toEqual(["a", "b"]);
  });
});
