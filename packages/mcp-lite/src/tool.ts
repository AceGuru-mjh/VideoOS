// MCP-Lite 工具定义器：zod schema → JSON Schema（tools/list 参数描述）+ 安全校验 + 标准化结果。
// 全部 mcp-* 服务器统一走 defineTool，保证入参校验/错误形状/审计口径一致（agent-kit SPEC §3.5 安全基线）。
import { z } from "zod";

type JsonSchemaObject = Record<string, unknown>;

/** zod 内部 _def.typeName 判别（zod 3.x） */
function defType(schema: z.ZodTypeAny): string {
  return (schema._def as { typeName?: string }).typeName ?? "";
}

function hasIntCheck(schema: z.ZodNumber): boolean {
  const checks = (schema._def as { checks?: Array<{ kind?: string }> }).checks ?? [];
  return checks.some((c) => c.kind === "int");
}

function numberBounds(schema: z.ZodNumber): JsonSchemaObject {
  const out: JsonSchemaObject = {};
  const checks = (schema._def as { checks?: Array<{ kind?: string; value?: number }> }).checks ?? [];
  for (const c of checks) {
    if (c.kind === "min") out.minimum = c.value;
    if (c.kind === "max") out.maximum = c.value;
  }
  return out;
}

/**
 * zod → JSON Schema 转换（受控子集：object/string/number/boolean/literal/enum/array/record/
 * optional/default/nullable/union(string|number) + .describe()）。
 * 不识别的 schema 抛错 —— 宁可失败也不给 LLM 错误契约（与 @videoos/agent 同哲学）。
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const type = defType(schema);
  const description =
    typeof schema.description === "string" && schema.description.length > 0
      ? { description: schema.description }
      : {};

  switch (type) {
    case "ZodString":
      return { type: "string", ...description };

    case "ZodNumber": {
      const number = schema as z.ZodNumber;
      return { type: hasIntCheck(number) ? "integer" : "number", ...numberBounds(number), ...description };
    }

    case "ZodBoolean":
      return { type: "boolean", ...description };

    case "ZodLiteral": {
      const value = (schema._def as { value: unknown }).value;
      const jsonType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      return { type: jsonType, const: value, ...description };
    }

    case "ZodEnum": {
      const values = (schema._def as { values: string[] }).values;
      return { type: "string", enum: [...values], ...description };
    }

    case "ZodArray": {
      const inner = (schema._def as { type: z.ZodTypeAny }).type;
      return { type: "array", items: zodToJsonSchema(inner), ...description };
    }

    case "ZodRecord": {
      const def = schema._def as { keyType: z.ZodTypeAny; valueType: z.ZodTypeAny };
      return { type: "object", additionalProperties: zodToJsonSchema(def.valueType), ...description };
    }

    case "ZodObject": {
      const def = schema._def as { shape(): Record<string, z.ZodTypeAny> };
      const shape =
        typeof (schema as { shape?: unknown }).shape === "object"
          ? (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape
          : def.shape();
      const properties: JsonSchemaObject = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (defType(value) !== "ZodOptional" && defType(value) !== "ZodDefault") required.push(key);
      }
      return { type: "object", properties, ...(required.length > 0 ? { required } : {}), ...description };
    }

    case "ZodOptional":
    case "ZodDefault": {
      const inner = (schema._def as { innerType: z.ZodTypeAny }).innerType;
      return zodToJsonSchema(inner);
    }

    case "ZodNullable": {
      const inner = (schema._def as { innerType: z.ZodTypeAny }).innerType;
      return { ...zodToJsonSchema(inner), ...description };
    }

    case "ZodUnion": {
      const options = (schema._def as { options: z.ZodTypeAny[] }).options;
      const types = [...new Set(options.map((o) => (zodToJsonSchema(o).type as string) ?? "unknown"))];
      if (types.length === 1) return { type: types[0], ...description };
      return { type: types, ...description };
    }

    default:
      throw new Error(`zodToJsonSchema: unsupported zod type "${type}" (use a plain z.object shape)`);
  }
}

/** 工具结果形状（与 VapToolResult / McpToolDeps.call 一致） */
export interface LiteToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 成功结果 */
export function ok(data?: unknown): LiteToolResult {
  return { ok: true, ...(data !== undefined ? { data } : {}) };
}

/** 失败结果（error 建议带 CODE: 前缀，如 "E_NOT_FOUND: ..."） */
export function err(error: string): LiteToolResult {
  return { ok: false, error };
}

/** 工具实现抛出的结构化错误（defineTool 捕获 → err()，不炸服务器；message 自带 "CODE: " 前缀） */
export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ToolError";
    this.code = code;
  }
}

/** mcp-lite 工具接口（agent-kit SPEC §3.3） */
export interface LiteTool {
  /** 命名空间式工具名，如 "fs.read"（域前缀.动词） */
  name: string;
  description: string;
  /** JSON Schema（zodToJsonSchema 产物） */
  parameters: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<LiteToolResult>;
}

export type ToolRunner<T extends z.ZodTypeAny> = (args: z.infer<T>) => Promise<LiteToolResult> | LiteToolResult;

/**
 * 声明一个工具：zod 入参 + 运行器 → LiteTool。
 * - schema 必须是 z.object(...)（或 .partial/.extend 派生物）——MCP 工具入参恒为对象
 * - 校验失败 → LiteValidationError（server 层映射 -32602，message 含字段路径）
 * - runner 抛 ToolError → { ok:false, error:"CODE: msg" }
 * - runner 抛其他异常 → { ok:false, error:"TOOL_ERROR: msg" }（不炸服务器，LLM 可读）
 */
export function defineTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  runner: ToolRunner<T>,
): LiteTool {
  return {
    name,
    description,
    parameters: zodToJsonSchema(schema) as Record<string, unknown>,
    async call(args: Record<string, unknown>): Promise<LiteToolResult> {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) {
        throw new LiteValidationError(zodIssuesToMessage(parsed.error));
      }
      try {
        return await runner(parsed.data as z.infer<T>);
      } catch (error) {
        if (error instanceof ToolError) return err(error.message);
        return err(`TOOL_ERROR: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** 入参校验失败（server 层 → -32602） */
export class LiteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiteValidationError";
  }
}

/** zod 校验失败 → 人类可读摘要（路径 + 消息，分号连接） */
function zodIssuesToMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") + ": " : ""}${issue.message}`)
    .join("; ");
}
