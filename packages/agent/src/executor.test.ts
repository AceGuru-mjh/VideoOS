// AgentExecutor 测试（ManualProvider 确定性脚本，离线）：
// 工具循环（assistant→tool→assistant）/ maxSteps / 失败记忆 / 事件透传
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AgentExecutor, AgentMemory, DEFAULT_SYSTEM_PROMPT, createDefaultTools, createVapContext, ModelRouter, VapToolRegistry,
} from "./index";
import { ManualProvider } from "./providers/manual";
import { createFixtureProject } from "./testing";
import type { FixtureProject } from "./testing";
import type { VapContext } from "./session";

let fixture: FixtureProject;
let ctx: VapContext;

beforeAll(async () => {
  fixture = await createFixtureProject();
  ctx = await createVapContext({ workspace: fixture.workspace });
});

afterAll(async () => {
  await fixture.dispose();
});

type ScriptStep = { content?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };

/** 装配：脚本 provider（进 router）+ 全量默认工具 registry */
function setup(script: ScriptStep[]): { registry: VapToolRegistry; makeExecutor: (opts?: { maxSteps?: number; memory?: AgentMemory }) => AgentExecutor } {
  const provider = new ManualProvider({ id: "manual", script });
  const registry = new VapToolRegistry();
  for (const tool of createDefaultTools()) registry.register(tool);
  return {
    registry,
    makeExecutor: (opts = {}) =>
      new AgentExecutor({
        router: new ModelRouter([provider]),
        registry,
        context: ctx,
        ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
        ...(opts.memory !== undefined ? { memory: opts.memory } : {}),
      }),
  };
}

describe("AgentExecutor", () => {
  it("工具循环：toolCalls → registry.call → tool 消息回填 → 最终 content", async () => {
    const { makeExecutor } = setup([
      { toolCalls: [{ id: "c1", name: "compile.run", arguments: {} }] },
      { content: "编译完成" },
    ]);
    const result = await makeExecutor().run("帮我编译项目");
    expect(result.output).toBe("编译完成");
    expect(result.toolCallCount).toBe(1);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]!.role).toBe("assistant");
    expect(result.steps[0]!.toolCalls).toEqual([{ id: "c1", name: "compile.run", arguments: {} }]);
    expect(result.steps[1]!.role).toBe("tool");
    expect(result.steps[1]!.toolCallId).toBe("c1");
    expect(result.steps[1]!.name).toBe("compile.run");
    expect(JSON.parse(result.steps[1]!.content).ok).toBe(true);
    expect(result.steps[2]).toEqual({ role: "assistant", content: "编译完成" });
    // 事件流：tool-call / tool-result / compile 均出现
    const kinds = new Set(result.events.map((e) => e.kind));
    expect(kinds.has("tool-call")).toBe(true);
    expect(kinds.has("tool-result")).toBe(true);
    expect(kinds.has("compile")).toBe(true);
  });

  it("多工具并发调用：一次 assistant 发起 2 个 toolCalls 逐个执行", async () => {
    const { makeExecutor } = setup([
      {
        toolCalls: [
          { id: "c1", name: "compile.run", arguments: {} },
          { id: "c2", name: "scene.list", arguments: {} },
        ],
      },
      { content: "两个工具都完成" },
    ]);
    const result = await makeExecutor().run("编译并列出场景");
    expect(result.toolCallCount).toBe(2);
    expect(result.steps).toHaveLength(4); // assistant + tool + tool + assistant
    expect(result.steps[1]!.name).toBe("compile.run");
    expect(result.steps[2]!.name).toBe("scene.list");
    expect(JSON.parse(result.steps[1]!.content).data.scenes).toBe(1);
  });

  it("maxSteps=1：一轮工具调用后耗尽 → MAX_STEPS_REACHED", async () => {
    const { makeExecutor } = setup([
      { toolCalls: [{ id: "c1", name: "scene.list", arguments: {} }] },
      { content: "done" },
    ]);
    const result = await makeExecutor({ maxSteps: 1 }).run("列出场景");
    expect(result.output).toBe("MAX_STEPS_REACHED"); // 无 content 时精确等于
    expect(result.toolCallCount).toBe(1);
    expect(result.steps).toHaveLength(2); // assistant + tool
  });

  it("maxSteps 耗尽时附带最后 assistant content", async () => {
    const { makeExecutor } = setup([
      { content: "A", toolCalls: [{ id: "c1", name: "compile.diagnostics", arguments: {} }] },
      { content: "B", toolCalls: [{ id: "c2", name: "scene.list", arguments: {} }] },
      { content: "done" },
    ]);
    const result = await makeExecutor({ maxSteps: 2 }).run("继续");
    expect(result.output).toBe("MAX_STEPS_REACHED\nB");
    expect(result.toolCallCount).toBe(2);
    expect(result.steps).toHaveLength(4); // (assistant+tool) × 2
  });

  it("无工具调用：直接返回首条 content", async () => {
    const { makeExecutor } = setup([{ content: "你好，我是视频工程师" }]);
    const result = await makeExecutor().run("介绍一下自己");
    expect(result.output).toBe("你好，我是视频工程师");
    expect(result.steps).toHaveLength(1);
    expect(result.toolCallCount).toBe(0);
  });

  it("工具失败 → 失败记忆记录；项目事实注入系统提示（memory 可用）", async () => {
    const { makeExecutor } = setup([
      { toolCalls: [{ id: "c1", name: "no.such.tool", arguments: {} }] },
      { content: "工具不存在" },
    ]);
    const memory = new AgentMemory(fixture.workspace);
    await memory.rememberFact("brandColor", "#6d28d9");
    const result = await makeExecutor({ memory }).run("调用不存在的工具");
    expect(result.output).toBe("工具不存在");
    expect(result.steps[1]!.role).toBe("tool");
    const toolPayload = JSON.parse(result.steps[1]!.content) as { ok: boolean; error: string };
    expect(toolPayload.ok).toBe(false); // TOOL_NOT_FOUND 结构化回填给 LLM
    expect(toolPayload.error).toMatch(/TOOL_NOT_FOUND/);
    const failures = await memory.recallFailures();
    expect(failures.some((f) => f.task === "tool:no.such.tool" && /TOOL_NOT_FOUND/.test(f.error))).toBe(true);
    expect(await memory.recallFacts()).toEqual({ brandColor: "#6d28d9" });
  });

  it("DEFAULT_SYSTEM_PROMPT：中文系统提示含工具清单与事务工作流", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("VideoOS 视频工程师");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("compile.run");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("transaction.begin");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("语义时间线");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("check.overflow");
  });

  it("maxSteps 非法值抛错", () => {
    const provider = new ManualProvider({ id: "m", script: [] });
    const registry = new VapToolRegistry();
    expect(() => new AgentExecutor({ router: new ModelRouter([provider]), registry, context: ctx, maxSteps: 0 })).toThrow(/maxSteps/);
  });

  it("router 无 provider → PROVIDER_NONE 透传", async () => {
    const provider = new ManualProvider({ id: "m", script: [] });
    const registry = new VapToolRegistry();
    const executor = new AgentExecutor({ router: new ModelRouter([]), registry, context: ctx });
    void provider;
    await expect(executor.run("hi")).rejects.toThrow(/PROVIDER_NONE/);
  });
});
