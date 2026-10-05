// Agent 权限镜像（v0.2 §6 issue #54）— 客户端单一致的事实源。
// 逐字节镜像 packages/server/src/chat/gate.ts 的 resolvePermission（31 VAP 工具
// 三组分级 + mcp_* 类目覆盖 + 自主级预设）：权限矩阵 UI 用它渲染 ghost 预设，
// server 用同名函数真实裁决。两处改动必须同步。
import type { AgentSection, AutonomyLevel, PermissionDecision } from "./settings";

/** 纯检查类（无副作用）：L1-L4 全部 allow */
export const PURE_INSPECT_TOOLS: ReadonlySet<string> = new Set([
  "compile.diagnostics",
  "compile.vir",
  "scene.list",
  "scene.inspect",
  "layer.inspect",
  "asset.list",
  "audio.list",
  "render.status",
  "cache.stats",
  "test.results",
  "transaction.list",
  "inspect.frame",
  "diff.frames",
  "check.overflow",
  "check.missingAssets",
  "storyboard.plan",
]);

/** 核心变更类（迭代工作流主干）：L2 起允许 */
export const CORE_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "compile.run",
  "render.preview",
  "render.range",
  "render.cancel",
  "test.run",
  "transaction.begin",
  "transaction.commit",
  "transaction.rollback",
  "storyboard.toScenes",
]);

/** 危险变更类（破坏性/不可逆/昂贵输出）：L2 需确认；L3 仅 render.final（confirmRender 时）与 cache.clear 需确认 */
export const DANGEROUS_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "scene.modify",
  "layer.modify",
  "audio.set",
  "asset.add",
  "render.final",
  "cache.clear",
]);

export const MCP_TOOL_PREFIX = "mcp_";

/** 权限裁决（镜像 server gate.ts；显式覆盖 > mcp 类目 > 自主级预设）。 */
export function resolvePermission(toolName: string, agent: AgentSection): PermissionDecision {
  const explicit = agent.toolPermissions[toolName];
  if (explicit !== undefined) return explicit;
  if (toolName.startsWith(MCP_TOOL_PREFIX)) {
    const mcpClass = agent.toolPermissions["mcp"];
    if (mcpClass !== undefined) return mcpClass;
    return agent.autonomy === "L1" || agent.autonomy === "L2" ? "confirm" : "allow";
  }
  switch (agent.autonomy) {
    case "L1":
      return PURE_INSPECT_TOOLS.has(toolName) ? "allow" : "confirm";
    case "L2":
      if (PURE_INSPECT_TOOLS.has(toolName)) return "allow";
      if (DANGEROUS_MUTATION_TOOLS.has(toolName)) return "confirm";
      return CORE_MUTATION_TOOLS.has(toolName) ? "allow" : "confirm";
    case "L3":
      if (toolName === "cache.clear") return "confirm";
      if (toolName === "render.final") return agent.confirmRender ? "confirm" : "allow";
      return "allow";
    case "L4":
      return "allow";
  }
}

// ---------------------------------------------------------------- 自主级别元数据（UI）

export interface AutonomyLevelMeta {
  level: AutonomyLevel;
  name: string;
  hint: string;
}

export const AUTONOMY_LEVELS: readonly AutonomyLevelMeta[] = [
  { level: "L1", name: "全确认", hint: "每个动作都需要你确认" },
  { level: "L2", name: "谨慎", hint: "修改场景与渲染需确认" },
  { level: "L3", name: "标准（推荐）", hint: "仅最终渲染需确认" },
  { level: "L4", name: "全自动", hint: "全自动无需确认" },
];

// ---------------------------------------------------------------- 工具类目分组（矩阵 UI）

export interface ToolGroupMeta {
  key: string;
  label: string;
  match(name: string): boolean;
}

const GROUP_DEFS: Array<{ key: string; label: string; prefixes: string[] }> = [
  { key: "compile", label: "编译", prefixes: ["compile."] },
  { key: "scene", label: "场景与图层", prefixes: ["scene.", "layer."] },
  { key: "render", label: "渲染", prefixes: ["render."] },
  { key: "test", label: "测试", prefixes: ["test."] },
  { key: "asset", label: "素材与音频", prefixes: ["asset.", "audio."] },
  { key: "transaction", label: "事务", prefixes: ["transaction."] },
  { key: "cache", label: "缓存", prefixes: ["cache."] },
  { key: "inspect", label: "检查", prefixes: ["inspect.", "diff.", "check."] },
  { key: "storyboard", label: "分镜", prefixes: ["storyboard."] },
  { key: "mcp", label: "MCP 工具", prefixes: [MCP_TOOL_PREFIX] },
];

export const TOOL_GROUPS: readonly ToolGroupMeta[] = GROUP_DEFS.map((g) => ({
  key: g.key,
  label: g.label,
  match: (name: string): boolean => g.prefixes.some((p) => name.startsWith(p)),
}));

export function toolGroupKey(name: string): string {
  for (const g of TOOL_GROUPS) {
    if (g.match(name)) return g.key;
  }
  return "other";
}

/** 组标签（含未分组兜底「其他」） */
export function toolGroupLabel(key: string): string {
  return TOOL_GROUPS.find((g) => g.key === key)?.label ?? "其他";
}

export const PERMISSION_DECISIONS: readonly PermissionDecision[] = ["allow", "confirm", "deny"];

export const DECISION_LABELS: Record<PermissionDecision, string> = {
  allow: "允许",
  confirm: "需确认",
  deny: "拒绝",
};

/** 确认等待超时（镜像 server gate.ts DEFAULT_CONFIRM_TIMEOUT_MS） */
export const CONFIRM_TIMEOUT_MS = 120_000;
