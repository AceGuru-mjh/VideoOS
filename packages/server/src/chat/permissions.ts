// 工具权限门禁（#49）：orchestrator 在每次工具调用前过此纯函数，不依赖 executor。
// 语义（按优先级从高到低，全部在下方逐条实现并配单测）：
// 1. 危险命令黑名单 settings.agent.dangerousCommandPatterns（正则源文本）对
//    JSON.stringify(args) 匹配 → 一律 deny（任何自主级别、任何显式 allow 都不可越过），
//    reason 以 DANGEROUS_COMMAND 开头并包含命中的 pattern。
// 2. settings.agent.toolPermissions[toolName] 显式条目优先于级别预设：
//    "allow" → allow；"deny" → deny（reason 以 PERMISSION_DENIED 开头）；
//    "confirm" → deny，reason 说明需要用户确认（交互式确认卡在后续里程碑接入，
//    过渡期诚实语义：用户可在设置里把该工具改为 allow）。
// 3. 自主级别预设：L1 全部 confirm；L2 confirm 集 {render.final, render.range,
//    transaction.rollback, cache.clear}；L3 confirm 集 {render.final, render.range}；
//    L4 全部 allow。
// 非法正则 pattern 不会抛错：编译失败时退化为字面子串匹配（argsJson.includes(pattern)）。
import type { AutonomyLevel, StudioSettings } from "../settings";

export type PermissionDecision = { action: "allow" } | { action: "deny"; reason: string };

/** 各级别需要 confirm 的工具集（"*" = 全部工具；供测试与设置 UI 渲染） */
export function confirmSetForLevel(level: AutonomyLevel): string[] {
  switch (level) {
    case 1:
      return ["*"];
    case 2:
      return ["render.final", "render.range", "transaction.rollback", "cache.clear"];
    case 3:
      return ["render.final", "render.range"];
    case 4:
      return [];
  }
}

/** confirm 的过渡期拒绝理由（S4 确认卡落地前的诚实语义，面向模型与用户可读） */
export const CONFIRM_REQUIRED_REASON =
  "requires user confirmation (interactive confirm cards arrive in a later milestone); the user can set this tool to allow in settings";

/** 单条 pattern 匹配：合法正则 → regex.test；非法正则 → 字面子串匹配（永不抛错） */
function patternMatches(source: string, argsJson: string): boolean {
  try {
    return new RegExp(source).test(argsJson);
  } catch {
    return argsJson.includes(source);
  }
}

/**
 * 工具调用权限裁决（纯函数，无副作用）。
 * settings 来自 SettingsStore.get() 的只读视图；调用方在每次工具执行前取新鲜值。
 */
export function evaluateToolPermission(input: {
  toolName: string;
  args: Record<string, unknown>;
  settings: StudioSettings;
}): PermissionDecision {
  const { toolName, args, settings } = input;

  // 规则 1：危险命令黑名单（最高优先级，任何级别/显式 allow 均不可越过）
  let argsJson: string | undefined;
  for (const pattern of settings.agent.dangerousCommandPatterns) {
    if (typeof pattern !== "string" || pattern.length === 0) continue;
    argsJson ??= JSON.stringify(args) ?? "{}";
    if (patternMatches(pattern, argsJson)) {
      return {
        action: "deny",
        reason: `DANGEROUS_COMMAND: tool "${toolName}" args match dangerous pattern "${pattern}" (dangerous patterns deny at every autonomy level)`,
      };
    }
  }

  // 规则 2：单工具显式三态（优先于级别预设）
  const explicit = settings.agent.toolPermissions[toolName];
  if (explicit === "allow") return { action: "allow" };
  if (explicit === "deny") {
    return { action: "deny", reason: `PERMISSION_DENIED: tool "${toolName}" is set to "deny" in settings.agent.toolPermissions` };
  }
  if (explicit === "confirm") return { action: "deny", reason: CONFIRM_REQUIRED_REASON };

  // 规则 3：自主级别预设
  const confirmSet = confirmSetForLevel(settings.agent.autonomyLevel);
  if (confirmSet.includes("*") || confirmSet.includes(toolName)) {
    return { action: "deny", reason: CONFIRM_REQUIRED_REASON };
  }
  return { action: "allow" };
}
