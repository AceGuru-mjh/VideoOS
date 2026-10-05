// LiteTool + defineTool（zod 入参校验 → JSON Schema 描述）。
// defineTool 用 zod schema 同时生成 parameters（z.toJSONSchema，zod/v4）与运行时校验；
// 校验失败抛 LiteParamError（server 映射 -32602，message 含字段路径）。
import { z } from "zod/v4";
import type { JsonSchemaObject } from "./json";

/** tools/call 的统一返回形状（沿用 McpToolDeps.call 语义） */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 工具契约（SPEC §3.3）：name/description/parameters(JSON Schema)/call */
export interface LiteTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

/** 入参校验失败（server 捕获后回 -32602；message 含字段路径） */
export class LiteParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiteParamError";
  }
}

/** zod issue → "path: message; path2: message2"（字段路径直白可读） */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}

/** zod schema → JSON Schema（zod/v4 z.toJSONSchema；失败退化为宽松 object，绝不抛） */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as unknown as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}

/** zod 定义工具：parameters 从 schema 生成；call 收到已校验的强类型入参 */
export function defineTool<S extends z.ZodType>(opts: {
  name: string;
  description: string;
  schema: S;
  call: (args: z.infer<S>) => Promise<ToolResult> | ToolResult;
}): LiteTool {
  return {
    name: opts.name,
    description: opts.description,
    parameters: zodToJsonSchema(opts.schema),
    call: async (raw: Record<string, unknown>): Promise<ToolResult> => {
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        throw new LiteParamError(formatIssues(parsed.error));
      }
      return opts.call(parsed.data as z.infer<S>);
    },
  };
}

/** 手写 JSON Schema 的工具（不想引入 zod 时用） */
export function rawTool(opts: LiteTool): LiteTool {
  return opts;
}
