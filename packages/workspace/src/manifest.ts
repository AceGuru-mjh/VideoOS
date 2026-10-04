// 项目清单 video.project.json 的类型/校验/解析（SPEC §9）。
// 宽松策略：未知字段放行（passthrough）——清单会随版本演进，解析器不做闭包式拒绝；
// 已知字段严格校验（类型/格式），失败抛 WorkspaceError("WORKSPACE_MANIFEST_INVALID")。
import { z } from "zod";
import { WorkspaceError } from "./errors";

export interface ProjectManifest {
  name: string;
  /** 相对项目根的 DSL 入口，默认 "src/video.ts" */
  entry: string;
  engines?: { videoos?: string };
  render?: { defaultBackend?: string; encoder?: string };
  agent?: { autonomous?: boolean; maxRepairLoops?: number };
}

/** entry 默认值（SPEC §9 目录结构固定 src/video.ts 为入口） */
export const DEFAULT_ENTRY = "src/video.ts";

const EnginesSchema = z.object({ videoos: z.string().min(1).optional() }).passthrough();
const RenderSchema = z
  .object({ defaultBackend: z.string().min(1).optional(), encoder: z.string().min(1).optional() })
  .passthrough();
const AgentSchema = z
  .object({ autonomous: z.boolean().optional(), maxRepairLoops: z.number().int().min(0).optional() })
  .passthrough();

/**
 * 清单 zod schema（未知字段放行）。
 * 注意：schema 本身要求 entry 必填（保证输入/输出类型一致，可独立用于严格校验）；
 * 默认值填充由 parseManifest 完成。
 */
export const ManifestSchema: z.ZodType<ProjectManifest> = z
  .object({
    name: z.string().min(1),
    entry: z.string().min(1),
    engines: EnginesSchema.optional(),
    render: RenderSchema.optional(),
    agent: AgentSchema.optional(),
  })
  .passthrough();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 解析清单：应用 entry 默认值 → zod 校验 → 返回 ProjectManifest。
 * 非法输入抛 WorkspaceError（code=WORKSPACE_MANIFEST_INVALID，message 含逐字段 issue 明细）。
 */
export function parseManifest(raw: unknown): ProjectManifest {
  const withDefaultEntry =
    isPlainObject(raw) && raw.entry === undefined ? { ...raw, entry: DEFAULT_ENTRY } : raw;
  const result = ManifestSchema.safeParse(withDefaultEntry);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
      .join("; ");
    throw new WorkspaceError("WORKSPACE_MANIFEST_INVALID", `invalid project manifest — ${issues}`);
  }
  return result.data;
}
