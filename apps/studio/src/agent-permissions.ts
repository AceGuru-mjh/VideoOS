// Agent 权限镜像（v0.2 §6 issue #54）— 客户端单一致的事实源。
// 逐字节镜像 packages/server/src/chat/gate.ts 的 resolvePermission（31 VAP 工具
// 三组分级 + mcp_* 类目覆盖 + 自主级预设）：权限矩阵 UI 用它渲染 ghost 预设，
// server 用同名函数真实裁决。两处改动必须同步。
// 用户可见文案（级别名/提示、工具组标签、权限决定标签）全部移入 i18n 词典
// （zh-chat/en-chat 的 permissions 段）；本文件只保留 i18n 键常量，工具名等
// 协议串不翻译。
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
  /** 展示名 i18n 键（词典 permissions.autonomy.<level>.name） */
  nameKey: string;
  /** 提示 i18n 键（词典 permissions.autonomy.<level>.hint） */
  hintKey: string;
}

export const AUTONOMY_LEVELS: readonly AutonomyLevelMeta[] = [
  { level: "L1", nameKey: "permissions.autonomy.L1.name", hintKey: "permissions.autonomy.L1.hint" },
  { level: "L2", nameKey: "permissions.autonomy.L2.name", hintKey: "permissions.autonomy.L2.hint" },
  { level: "L3", nameKey: "permissions.autonomy.L3.name", hintKey: "permissions.autonomy.L3.hint" },
  { level: "L4", nameKey: "permissions.autonomy.L4.name", hintKey: "permissions.autonomy.L4.hint" },
];

// ---------------------------------------------------------------- 工具类目分组（矩阵 UI）

export interface ToolGroupMeta {
  key: string;
  match(name: string): boolean;
}

const GROUP_DEFS: Array<{ key: string; prefixes: string[] }> = [
  { key: "compile", prefixes: ["compile."] },
  { key: "scene", prefixes: ["scene.", "layer."] },
  { key: "render", prefixes: ["render."] },
  { key: "test", prefixes: ["test."] },
  { key: "asset", prefixes: ["asset.", "audio."] },
  { key: "transaction", prefixes: ["transaction."] },
  { key: "cache", prefixes: ["cache."] },
  { key: "inspect", prefixes: ["inspect.", "diff.", "check."] },
  { key: "storyboard", prefixes: ["storyboard."] },
  { key: "mcp", prefixes: [MCP_TOOL_PREFIX] },
];

export const TOOL_GROUPS: readonly ToolGroupMeta[] = GROUP_DEFS.map((g) => ({
  key: g.key,
  match: (name: string): boolean => g.prefixes.some((p) => name.startsWith(p)),
}));

export function toolGroupKey(name: string): string {
  for (const g of TOOL_GROUPS) {
    if (g.match(name)) return g.key;
  }
  return "other";
}

/** 组标签的 i18n 键（含未分组兜底 other → permissions.group.other） */
export function toolGroupLabelKey(key: string): string {
  return `permissions.group.${key}`;
}

export const PERMISSION_DECISIONS: readonly PermissionDecision[] = ["allow", "confirm", "deny"];

/** 权限决定按钮文案的 i18n 键（词典 permissions.decision.*） */
export const DECISION_LABEL_KEYS: Record<PermissionDecision, string> = {
  allow: "permissions.decision.allow",
  confirm: "permissions.decision.confirm",
  deny: "permissions.decision.deny",
};

/** 确认等待超时（镜像 server gate.ts DEFAULT_CONFIRM_TIMEOUT_MS） */
export const CONFIRM_TIMEOUT_MS = 120_000;
