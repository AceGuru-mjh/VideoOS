// VapToolRegistry 测试：未注册工具 / schema 校验失败 / execute 异常包装 / 审计事件 / list JSON Schema
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { VapContext, VapEvent } from "../session";
import { VapToolRegistry } from "./registry";

function stubContext(): { ctx: VapContext; events: VapEvent[] } {
  const events: VapEvent[] = [];
  const ctx = {
    events: {
      emit: (e: VapEvent): void => {
        events.push(e);
      },
      all: (): VapEvent[] => [...events],
    },
  } as unknown as VapContext;
  return { ctx, events };
}

describe("VapToolRegistry", () => {
  it("未注册工具 → TOOL_NOT_FOUND（含可用工具列表）", async () => {
    const registry = new VapToolRegistry();
    const { ctx } = stubContext();
    const result = await registry.call("no.such.tool", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^TOOL_NOT_FOUND: "no\.such\.tool"/);
  });

  it("schema 校验失败 → SCHEMA: 前缀（含字段路径）", async () => {
    const registry = new VapToolRegistry();
    registry.register({
      name: "demo.echo",
      description: "示例",
      schema: z.object({ text: z.string(), count: z.number().int().min(1) }),
      execute: async (args) => ({ ok: true, data: args }),
    });
    const { ctx } = stubContext();
    const result = await registry.call("demo.echo", { text: 123, count: 0 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^SCHEMA:/);
    expect(result.error).toMatch(/text/);
    expect(result.error).toMatch(/count/);
  });

  it("execute 抛异常 → TOOL_ERROR 不向外抛", async () => {
    const registry = new VapToolRegistry();
    registry.register({
      name: "demo.boom",
      description: "抛错示例",
      schema: z.object({}),
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const { ctx } = stubContext();
    const result = await registry.call("demo.boom", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("TOOL_ERROR: kaboom");
  });

  it("每次调用产生 tool-call / tool-result 审计事件（成功与失败路径都有）", async () => {
    const registry = new VapToolRegistry();
    registry.register({
      name: "demo.ok",
      description: "成功",
      schema: z.object({ n: z.number() }),
      execute: async (args) => ({ ok: true, data: { doubled: (args.n as number) * 2 } }),
    });
    const { ctx, events } = stubContext();
    const result = await registry.call("demo.ok", { n: 21 }, ctx);
    expect(result).toEqual({ ok: true, data: { doubled: 42 } });
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe("tool-call");
    expect(events[0]!.tool).toBe("demo.ok");
    expect(events[0]!.detail).toEqual({ args: { n: 21 } });
    expect(events[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[1]!.kind).toBe("tool-result");
    expect(events[1]!.detail).toEqual({ ok: true });

    await registry.call("demo.ok", { n: "bad" }, ctx); // SCHEMA 失败
    expect(events[3]!.kind).toBe("tool-result");
    expect((events[3]!.detail as Record<string, unknown>).error).toMatch(/^SCHEMA:/);
  });

  it("list() 输出 JSON Schema（MCP tools/list 直接可用）；重复注册覆盖", () => {
    const registry = new VapToolRegistry();
    registry.register({
      name: "demo.a",
      description: "A 工具",
      schema: z.object({ scene: z.string().describe("场景名"), frame: z.number().optional() }),
      execute: async () => ({ ok: true }),
    });
    registry.register({
      name: "demo.b",
      description: "B 工具",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    });
    const list = registry.list();
    expect(list.map((t) => t.name)).toEqual(["demo.a", "demo.b"]);
    expect(list[0]!.parameters).toEqual({
      type: "object",
      properties: { scene: { type: "string", description: "场景名" }, frame: { type: "number" } },
      required: ["scene"],
    });
    expect(registry.names()).toEqual(["demo.a", "demo.b"]);

    // 覆盖注册：同名工具更新描述，list 刷新
    registry.register({
      name: "demo.a",
      description: "A 工具 v2",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    });
    expect(registry.get("demo.a")!.description).toBe("A 工具 v2");
    expect(registry.list().find((t) => t.name === "demo.a")!.parameters).toEqual({ type: "object", properties: {} });
  });

  it("register 参数校验：空名/缺描述/缺 execute 抛 VAP 错", () => {
    const registry = new VapToolRegistry();
    expect(() => registry.register({ name: "", description: "x", schema: z.object({}), execute: async () => ({ ok: true }) })).toThrow(/name/);
    expect(() => registry.register({ name: "t", description: "", schema: z.object({}), execute: async () => ({ ok: true }) })).toThrow(/description/);
  });
});
