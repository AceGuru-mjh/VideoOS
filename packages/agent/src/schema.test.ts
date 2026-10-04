// zodToJsonSchema 转换测试：object/string/number/int/enum/optional/array/record/union/literal/describe/默认值
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { zodToJsonSchema } from "./schema";

describe("zodToJsonSchema", () => {
  it("object + required/optional 区分", () => {
    const schema = z.object({
      scene: z.string(),
      frame: z.number().optional(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: { scene: { type: "string" }, frame: { type: "number" } },
      required: ["scene"],
    });
  });

  it("string/number/boolean + describe", () => {
    expect(zodToJsonSchema(z.string().describe("场景名"))).toEqual({ type: "string", description: "场景名" });
    expect(zodToJsonSchema(z.number())).toEqual({ type: "number" });
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: "boolean" });
  });

  it("number int + min/max 检查透传", () => {
    const schema = z.number().int().min(0).max(10);
    expect(zodToJsonSchema(schema)).toEqual({ type: "integer", minimum: 0, maximum: 10 });
  });

  it("enum → string enum", () => {
    const schema = z.enum(["replace_text", "set_color"]);
    expect(zodToJsonSchema(schema)).toEqual({ type: "string", enum: ["replace_text", "set_color"] });
  });

  it("array → items 递归", () => {
    const schema = z.array(z.object({ name: z.string() }));
    expect(zodToJsonSchema(schema)).toEqual({
      type: "array",
      items: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    });
  });

  it("record → additionalProperties", () => {
    const schema = z.record(z.string(), z.number());
    expect(zodToJsonSchema(schema)).toEqual({ type: "object", additionalProperties: { type: "number" } });
  });

  it("union(string|number) → anyOf", () => {
    const schema = z.union([z.string(), z.number()]);
    expect(zodToJsonSchema(schema)).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
  });

  it("literal → const", () => {
    expect(zodToJsonSchema(z.literal("fade"))).toEqual({ type: "string", const: "fade" });
    expect(zodToJsonSchema(z.literal(42))).toEqual({ type: "number", const: 42 });
  });

  it("default 不进 required（内层展开）", () => {
    const schema = z.object({ volume: z.number().default(1) });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: { volume: { type: "number" } },
    });
  });

  it("工具真实 schema 冒烟（scene.modify 形状）", () => {
    const schema = z.object({
      scene: z.string().describe("场景名或 id"),
      operation: z.enum(["replace_text", "set_color", "set_duration", "set_animation"]),
      layer: z.string().optional(),
      value: z.union([z.string(), z.number()]),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["scene", "operation", "value"]);
    expect((json.properties as Record<string, unknown>).layer).toEqual({ type: "string" });
  });

  it("不支持的类型抛错", () => {
    expect(() => zodToJsonSchema(z.date())).toThrow(/unsupported zod type/);
    expect(() => zodToJsonSchema(z.tuple([z.string()]))).toThrow(/unsupported zod type/);
  });
});
