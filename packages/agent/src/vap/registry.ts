// VAP 工具注册表（SPEC §7）：JSON Schema 参数描述 + zod 校验 + 结构化输出 + 每调用审计事件。
// MCP tools/list 直接消费 registry.list()；LLM providers 的 tools 参数同形（executor 透传）。
import { z } from "zod";
import { zodToJsonSchema } from "../schema";
import type { VapContext } from "../session";
import { createCompileTools } from "./tools-compile";
import { createDiagnoseTools } from "./tools-diagnose";
import { createProjectTools } from "./tools-project";
import { createRenderTools } from "./tools-render";
import { createSceneTools } from "./tools-scene";
import { createStoryboardTools } from "./tools-storyboard";
import type { StoryboardGenerator } from "./tools-storyboard";
import { createTestTools } from "./tools-test";
import { createTransactionTools } from "./tools-transaction";

export interface VapToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 工具入参形状（zod 校验后的普通对象） */
export type VapToolArgs = Record<string, unknown>;

export interface VapTool {
  /** 命名空间式工具名，如 "compile.run" */
  name: string;
  description: string;
  /** zod schema（registry.call 前置校验；zodToJsonSchema 生成 JSON Schema） */
  schema: z.ZodTypeAny;
  execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult>;
}

export interface VapToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 注册表错误（code 前缀 VAP_*） */
export class VapRegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "VapRegistryError";
    this.code = code;
  }
}

/** zod 校验失败 → 人类可读摘要（路径 + 消息） */
function zodIssuesToMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") + ": " : ""}${issue.message}`)
    .join("; ");
}

export class VapToolRegistry {
  private readonly tools = new Map<string, VapTool>();
  private readonly jsonSchemaCache = new Map<string, Record<string, unknown>>();

  /** 注册/覆盖同名工具（后者覆盖前者；Map 保持首次插入序） */
  register(tool: VapTool): void {
    if (tool === null || typeof tool !== "object") {
      throw new VapRegistryError("VAP_INVALID_TOOL", "tool must be an object");
    }
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      throw new VapRegistryError("VAP_INVALID_TOOL", "tool.name must be a non-empty string");
    }
    if (typeof tool.description !== "string" || tool.description.length === 0) {
      throw new VapRegistryError("VAP_INVALID_TOOL", `tool "${tool.name}" must have a non-empty description`);
    }
    if (typeof tool.execute !== "function") {
      throw new VapRegistryError("VAP_INVALID_TOOL", `tool "${tool.name}" must have an execute() function`);
    }
    this.tools.set(tool.name, tool);
    this.jsonSchemaCache.delete(tool.name);
  }

  get(name: string): VapTool | undefined {
    return this.tools.get(name);
  }

  /** 工具清单（MCP tools/list / LLM tools 参数直接可用；JSON Schema 惰性缓存） */
  list(): VapToolInfo[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.parametersOf(tool),
    }));
  }

  /** 已注册工具名（排序稳定，事件/日志用） */
  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  private parametersOf(tool: VapTool): Record<string, unknown> {
    let schema = this.jsonSchemaCache.get(tool.name);
    if (schema === undefined) {
      schema = zodToJsonSchema(tool.schema);
      this.jsonSchemaCache.set(tool.name, schema);
    }
    return schema;
  }

  /**
   * 调用工具：未注册 → TOOL_NOT_FOUND；schema 校验失败 → SCHEMA: ...；
   * execute 异常 → TOOL_ERROR（不抛出，全部以 VapToolResult 返回，LLM 可读到错误并自我修复）。
   * 每次调用产生 tool-call / tool-result 审计事件。
   */
  async call(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      return { ok: false, error: `TOOL_NOT_FOUND: ${JSON.stringify(name)} (available: ${this.names().join(", ")})` };
    }
    ctx.events.emit({ at: new Date().toISOString(), kind: "tool-call", tool: name, detail: { args } });

    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const result: VapToolResult = { ok: false, error: `SCHEMA: ${zodIssuesToMessage(parsed.error)}` };
      ctx.events.emit({ at: new Date().toISOString(), kind: "tool-result", tool: name, detail: result });
      return result;
    }

    let result: VapToolResult;
    try {
      result = await tool.execute(parsed.data as VapToolArgs, ctx);
    } catch (err) {
      result = { ok: false, error: `TOOL_ERROR: ${err instanceof Error ? err.message : String(err)}` };
    }
    ctx.events.emit({
      at: new Date().toISOString(),
      kind: "tool-result",
      tool: name,
      detail: { ok: result.ok, ...(result.error !== undefined ? { error: result.error } : {}) },
    });
    return result;
  }
}

export interface DefaultToolsOptions {
  /** 注入后 storyboard.plan 走 LLM 生成（默认确定性模板） */
  storyboardGenerator?: StoryboardGenerator;
}

/** 全部内置 VAP 工具（30+，SPEC §7.2）：compile/scene/layer/asset/audio/render/cache/test/transaction/diagnose/storyboard */
export function createDefaultTools(options: DefaultToolsOptions = {}): VapTool[] {
  return [
    ...createCompileTools(),
    ...createSceneTools(),
    ...createProjectTools(),
    ...createRenderTools(),
    ...createTestTools(),
    ...createTransactionTools(),
    ...createDiagnoseTools(),
    ...createStoryboardTools({ ...(options.storyboardGenerator !== undefined ? { storyboardGenerator: options.storyboardGenerator } : {}) }),
  ];
}
