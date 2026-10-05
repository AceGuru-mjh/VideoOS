// permissions.ts 单元测试：三条规则 + 优先级 + 非法正则容错。
import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type StudioSettings } from "../settings";
import { CONFIRM_REQUIRED_REASON, confirmSetForLevel, evaluateToolPermission } from "./permissions";

/** 便捷构造：默认设置 + 覆盖段（浅合并顶层，agent/skills 段整体替换） */
function settings(override: Partial<StudioSettings> = {}): StudioSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...override };
}

function agentSettings(agent: Partial<StudioSettings["agent"]>): StudioSettings {
  return settings({ agent: { ...structuredClone(DEFAULT_SETTINGS.agent), ...agent } });
}

describe("confirmSetForLevel", () => {
  test("L1 全部 / L2 危险四件套 / L3 渲染前 / L4 空", () => {
    expect(confirmSetForLevel(1)).toEqual(["*"]);
    expect(confirmSetForLevel(2)).toEqual(["render.final", "render.range", "transaction.rollback", "cache.clear"]);
    expect(confirmSetForLevel(3)).toEqual(["render.final", "render.range"]);
    expect(confirmSetForLevel(4)).toEqual([]);
  });
});

describe("规则 3：自主级别预设", () => {
  test("L4 全部 allow（默认工具）", () => {
    const d = evaluateToolPermission({ toolName: "scene.list", args: {}, settings: agentSettings({ autonomyLevel: 4 }) });
    expect(d).toEqual({ action: "allow" });
  });

  test("L1 任意工具都要求 confirm（过渡期 → deny + 确认理由）", () => {
    const d = evaluateToolPermission({ toolName: "scene.list", args: {}, settings: agentSettings({ autonomyLevel: 1 }) });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reason).toBe(CONFIRM_REQUIRED_REASON);
  });

  test("L3：render.final/render.range confirm，普通工具 allow", () => {
    const s = agentSettings({ autonomyLevel: 3 });
    expect(evaluateToolPermission({ toolName: "scene.modify", args: {}, settings: s }).action).toBe("allow");
    expect(evaluateToolPermission({ toolName: "render.final", args: {}, settings: s }).action).toBe("deny");
    expect(evaluateToolPermission({ toolName: "render.range", args: { from: 0, to: 9 }, settings: s }).action).toBe("deny");
  });

  test("L2：cache.clear/transaction.rollback 额外 confirm；L3 下两者 allow", () => {
    const l2 = agentSettings({ autonomyLevel: 2 });
    expect(evaluateToolPermission({ toolName: "cache.clear", args: {}, settings: l2 }).action).toBe("deny");
    expect(evaluateToolPermission({ toolName: "transaction.rollback", args: {}, settings: l2 }).action).toBe("deny");
    const l3 = agentSettings({ autonomyLevel: 3 });
    expect(evaluateToolPermission({ toolName: "cache.clear", args: {}, settings: l3 }).action).toBe("allow");
    expect(evaluateToolPermission({ toolName: "transaction.rollback", args: {}, settings: l3 }).action).toBe("allow");
  });
});

describe("规则 2：显式 toolPermissions 优先于级别预设", () => {
  test("L1 下显式 allow → allow", () => {
    const s = agentSettings({ autonomyLevel: 1, toolPermissions: { "scene.list": "allow" } });
    expect(evaluateToolPermission({ toolName: "scene.list", args: {}, settings: s })).toEqual({ action: "allow" });
  });

  test("L4 下显式 deny → deny，reason 含 PERMISSION_DENIED", () => {
    const s = agentSettings({ autonomyLevel: 4, toolPermissions: { "scene.list": "deny" } });
    const d = evaluateToolPermission({ toolName: "scene.list", args: {}, settings: s });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reason).toContain("PERMISSION_DENIED");
  });

  test("L4 下显式 confirm → deny + 确认理由", () => {
    const s = agentSettings({ autonomyLevel: 4, toolPermissions: { "render.preview": "confirm" } });
    const d = evaluateToolPermission({ toolName: "render.preview", args: {}, settings: s });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reason).toBe(CONFIRM_REQUIRED_REASON);
  });

  test("显式条目只影响该工具，不外溢", () => {
    const s = agentSettings({ autonomyLevel: 4, toolPermissions: { "scene.list": "deny" } });
    expect(evaluateToolPermission({ toolName: "scene.list", args: {}, settings: s }).action).toBe("deny");
    expect(evaluateToolPermission({ toolName: "scene.inspect", args: {}, settings: s }).action).toBe("allow");
  });
});

describe("规则 1：危险命令黑名单（最高优先级）", () => {
  test("默认 pattern 命中 rm -rf → L4 也 deny，reason 含 pattern", () => {
    const s = agentSettings({ autonomyLevel: 4 }); // 全 allow 级别
    const d = evaluateToolPermission({
      toolName: "scene.modify",
      args: { note: "rm -rf /tmp/x" },
      settings: s,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") {
      expect(d.reason).toContain("DANGEROUS_COMMAND");
      expect(d.reason).toContain("rm\\s+-rf"); // 命中的 pattern 源文本（正则源，含转义）
    }
  });

  test("pattern 匹配的是 JSON.stringify(args) 全文（嵌套值也命中）", () => {
    const s = agentSettings({ autonomyLevel: 4, dangerousCommandPatterns: ["shutdown"] });
    const d = evaluateToolPermission({
      toolName: "layer.modify",
      args: { ops: [{ deep: { cmd: "sudo shutdown now" } }] },
      settings: s,
    });
    expect(d.action).toBe("deny");
  });

  test("显式 allow 不能越过危险 pattern", () => {
    const s = agentSettings({
      autonomyLevel: 4,
      toolPermissions: { "scene.modify": "allow" },
      dangerousCommandPatterns: ["mkfs"],
    });
    const d = evaluateToolPermission({ toolName: "scene.modify", args: { x: "mkfs.ext4" }, settings: s });
    expect(d.action).toBe("deny");
  });

  test("未命中 pattern 的正常参数不受影响", () => {
    const s = agentSettings({ autonomyLevel: 4 });
    const d = evaluateToolPermission({
      toolName: "scene.modify",
      args: { note: "把标题改成 Hello（正常编辑）" },
      settings: s,
    });
    expect(d).toEqual({ action: "allow" });
  });
});

describe("非法正则 pattern 容错", () => {
  test("非法正则退化为字面子串匹配，不抛错", () => {
    const s = agentSettings({ autonomyLevel: 4, dangerousCommandPatterns: ["([unclosed]"] });
    // 字面包含 → deny
    const hit = evaluateToolPermission({ toolName: "scene.modify", args: { text: "([unclosed]" }, settings: s });
    expect(hit.action).toBe("deny");
    // 不包含 → allow
    const miss = evaluateToolPermission({ toolName: "scene.modify", args: { text: "正常文本" }, settings: s });
    expect(miss).toEqual({ action: "allow" });
  });

  test("空 pattern 与非字符串条目被跳过", () => {
    const s = agentSettings({ autonomyLevel: 4, dangerousCommandPatterns: ["", "rm\\s+-rf"] });
    expect(evaluateToolPermission({ toolName: "scene.list", args: {}, settings: s })).toEqual({ action: "allow" });
  });
});
