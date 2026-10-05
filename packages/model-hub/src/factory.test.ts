// 工厂测试（Issue #24）：首批 8 家 + 全量 openai-compatible 冒烟 + env 回退 + baseUrl 覆盖。
// 全部走 node:http 本地 mock（附录 F 姿势），零外网。
import { afterAll, describe, expect, it } from "bun:test";
import { OpenAICompatibleProvider, ProviderError } from "@videoos/agent";
import { createProviderFromDescriptor } from "./factory";
import { getDescriptor, loadCatalog } from "./index";
import { openAiChatPayload, startRouteMock } from "./test-utils";
import type { RouteMock } from "./test-utils";
import type { ChatMessage, ToolDefinition } from "@videoos/agent";
import type { ProviderDescriptor } from "./types";

const mocks: RouteMock[] = [];
afterAll(() => {
  for (const m of mocks) m.stop();
});

async function newMock(): Promise<RouteMock> {
  const mock = await startRouteMock(() => ({ status: 200, payload: openAiChatPayload("ok", "mock") }));
  mocks.push(mock);
  return mock;
}

const TOOLS: ToolDefinition[] = [
  { name: "compile.run", description: "编译", parameters: { type: "object", properties: {}, required: [] } },
];

const CONVERSATION: ChatMessage[] = [
  { role: "system", content: "你是视频工程师" },
  { role: "user", content: "编译一下" },
  { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "compile.run", arguments: {} }] },
  { role: "tool", content: '{"ok":true}', toolCallId: "call_1", name: "compile.run" },
];

const FIRST_BATCH = ["openai", "deepseek", "zhipu", "qwen", "moonshot", "doubao", "minimax", "siliconflow"];

describe("createProviderFromDescriptor — 首批 8 家 mock chat（Issue #24）", () => {
  for (const id of FIRST_BATCH) {
    it(`${id}：工厂实例化 + mock chat + 鉴权头 + 默认模型`, async () => {
      const d = getDescriptor(id) as ProviderDescriptor;
      expect(d.id).toBe(id);
      const mock = await newMock();
      const provider = createProviderFromDescriptor(d, {
        baseUrl: mock.url,
        apiKey: "test-key",
      });
      const res = await provider.chat([{ role: "user", content: "hi" }]);
      expect(res.content).toBe("ok");
      expect(res.model).toBe(d.models[0].id);
      expect(mock.requests.length).toBe(1);
      const req = mock.requests[0];
      expect(req.url).toBe(`${mock.url}/chat/completions`);
      expect(req.headers.authorization).toBe("Bearer test-key");
      expect((req.body as { model: string }).model).toBe(d.models[0].id);
    });
  }

  it("工具调用往返（zhipu）：请求带 tools，响应解析 toolCalls", async () => {
    const mock = await newMock();
    mock.setHandler(() => ({
      status: 200,
      payload: JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              role: "assistant",
              tool_calls: [{ id: "call_9", type: "function", function: { name: "compile.run", arguments: "{\"dryRun\":true}" } }],
            },
          },
        ],
        model: "glm-4.5",
      }),
    }));
    const provider = createProviderFromDescriptor(getDescriptor("zhipu") as ProviderDescriptor, {
      baseUrl: mock.url,
      apiKey: "k",
    });
    const res = await provider.chat([{ role: "user", content: "编译" }], { tools: TOOLS });
    expect(res.toolCalls).toEqual([{ id: "call_9", name: "compile.run", arguments: { dryRun: true } }]);
    const body = mock.requests[0].body as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools?.[0].function.name).toBe("compile.run");
  });

  it("完整对话 wire 转换（system/user/assistant/tool → OpenAI messages）", async () => {
    const mock = await newMock();
    const provider = createProviderFromDescriptor(getDescriptor("deepseek") as ProviderDescriptor, {
      baseUrl: mock.url,
      apiKey: "k",
    });
    await provider.chat(CONVERSATION);
    const body = mock.requests[0].body as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0]).toEqual({ role: "system", content: "你是视频工程师" });
    expect(body.messages[2].tool_calls).toBeArrayOfSize(1);
    expect(body.messages[3]).toEqual({ role: "tool", content: '{"ok":true}', tool_call_id: "call_1", name: "compile.run" });
  });
});

describe("工厂行为细节", () => {
  it("env key 回退：缺 apiKey 时读 VIDEOOS_PROVIDER_DEEPSEEK_KEY", async () => {
    const mock = await newMock();
    process.env.VIDEOOS_PROVIDER_DEEPSEEK_KEY = "env-fallback-key";
    try {
      const provider = createProviderFromDescriptor(getDescriptor("deepseek") as ProviderDescriptor, {
        baseUrl: mock.url,
      });
      await provider.chat([{ role: "user", content: "hi" }]);
      expect(mock.requests[0].headers.authorization).toBe("Bearer env-fallback-key");
    } finally {
      delete process.env.VIDEOOS_PROVIDER_DEEPSEEK_KEY;
    }
  });

  it("creds.baseUrl 覆盖目录默认（custom baseUrl 覆盖验收项）", async () => {
    const mock = await newMock();
    const desc = getDescriptor("openai") as ProviderDescriptor;
    expect(desc.baseUrl).toBe("https://api.openai.com/v1");
    const provider = createProviderFromDescriptor(desc, { baseUrl: mock.url, apiKey: "k" });
    await provider.chat([{ role: "user", content: "hi" }]);
    expect(mock.requests[0].url).toContain("127.0.0.1");
  });

  it("creds.model 覆盖默认模型 + capabilities 取自选中条目", async () => {
    const mock = await newMock();
    const desc = getDescriptor("zhipu") as ProviderDescriptor;
    const provider = createProviderFromDescriptor(desc, { baseUrl: mock.url, apiKey: "k", model: "glm-4.5-air" });
    await provider.chat([{ role: "user", content: "hi" }]);
    expect((mock.requests[0].body as { model: string }).model).toBe("glm-4.5-air");
    // glm-4.5-air: tools=true / vision=false（目录声明）
    expect(provider.capabilities).toEqual({ vision: false, tools: true });
  });

  it("custom 类型：缺 baseUrl → HUB_MISSING_BASE_URL", () => {
    const custom = getDescriptor("custom") as ProviderDescriptor;
    let err: unknown;
    try {
      createProviderFromDescriptor(custom, { apiKey: "k" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("HUB_MISSING_BASE_URL");
  });

  it("custom 类型：填 baseUrl 后走 openai-compatible 行为", async () => {
    const mock = await newMock();
    const provider = createProviderFromDescriptor(getDescriptor("custom") as ProviderDescriptor, {
      baseUrl: `${mock.url}/v1`,
      apiKey: "k",
      model: "my-model",
    });
    const res = await provider.chat([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("ok");
    expect(mock.requests[0].url).toBe(`${mock.url}/v1/chat/completions`);
  });

  it("未知 type → HUB_UNKNOWN_TYPE", () => {
    const bogus = { ...getDescriptor("openai"), type: "quantum-link" } as unknown as ProviderDescriptor;
    let err: unknown;
    try {
      createProviderFromDescriptor(bogus);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("HUB_UNKNOWN_TYPE");
  });

  it("anthropic 分支 → AnthropicProvider（/v1/messages + x-api-key）", async () => {
    const mock = await newMock();
    mock.setHandler(() => ({
      status: 200,
      payload: JSON.stringify({ content: [{ type: "text", text: "hi from claude" }], usage: { input_tokens: 3, output_tokens: 4 } }),
    }));
    const provider = createProviderFromDescriptor(getDescriptor("anthropic") as ProviderDescriptor, {
      baseUrl: mock.url,
      apiKey: "sk-ant-test",
    });
    const res = await provider.chat([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("hi from claude");
    expect(mock.requests[0].url).toBe(`${mock.url}/v1/messages`);
    expect(mock.requests[0].headers["x-api-key"]).toBe("sk-ant-test");
  });

  it("timeoutMs 透传（实例化不报错即可，超时行为由 @videoos/agent 保证）", () => {
    const provider = createProviderFromDescriptor(getDescriptor("openai") as ProviderDescriptor, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      timeoutMs: 5_000,
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });
});

describe("全量 openai-compatible 家冒烟（Issue #25 验收）", () => {
  const families = loadCatalog().filter((d) => d.type === "openai-compatible" || d.type === "custom");
  it("冒烟覆盖家数 ≥ 20", () => {
    expect(families.length).toBeGreaterThanOrEqual(20);
  });
  for (const desc of families) {
    it(`${desc.id}：mock chat 冒烟`, async () => {
      const mock = await newMock();
      const provider = createProviderFromDescriptor(desc, { baseUrl: mock.url, apiKey: "k" });
      const res = await provider.chat([{ role: "user", content: "ping" }]);
      expect(res.content).toBe("ok");
      expect(res.model).toBe(desc.models[0].id);
    });
  }
});
