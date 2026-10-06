// MCP 推荐服务器预设测试（v0.2 §5「agent 工具太少」直答）：
// - 28 条 / id 唯一且匹配 MCP_SERVER_ID_PATTERN（无下划线）/ 整体过 McpServerEntrySchema
// - 每条 command "bun" + args 指向真实存在的 packages/mcp-<n>/src/index.ts（fs 断言）
// - 启用集 = 核验过的纯计算集；停用集（触盘/系统/网络）监狱根 env 预置 "."
// - listMcpPresets 深拷贝（改写副本不污染模块常量）
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { MCP_PRESETS, MCP_PRESET_ENABLED_IDS, listMcpPresets } from "./mcp-presets";
import { McpServerEntrySchema, MCP_SERVER_ID_PATTERN } from "../settings/schema";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

/** 触盘类服务器 → 监狱根 env 键（jailFromEnv 读取；预置 "." = 服务进程 cwd） */
const JAIL_ROOT_ENV_KEYS: Record<string, string> = {
  fs: "MCP_FS_ROOTS",
  shell: "MCP_SHELL_ROOTS",
  media: "MCP_MEDIA_ROOTS",
  assets: "MCP_ASSETS_ROOTS",
  image: "MCP_IMAGE_ROOTS",
  font: "MCP_FONT_ROOTS",
  sqlite: "MCP_SQLITE_ROOTS",
  git: "MCP_GIT_ROOTS",
  archive: "MCP_ARCHIVE_ROOTS",
  plot: "MCP_PLOT_ROOTS",
};

/** 系统信息 / 网络 / 进程内插件执行（无 env 需求，但默认不开） */
const SYSTEM_OR_NETWORK_IDS = ["os", "web", "bridge"];

describe("MCP 预设（agent-kit 25 + 可视化套件 3 = 28 服务器）", () => {
  test("恰好 28 条；id 唯一、匹配 MCP_SERVER_ID_PATTERN（无下划线）、整体过 McpServerEntrySchema", () => {
    expect(MCP_PRESETS).toHaveLength(28);
    const ids = new Set(MCP_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(28);
    for (const preset of MCP_PRESETS) {
      expect(MCP_SERVER_ID_PATTERN.test(preset.id)).toBe(true); // serverId 不含下划线 → mcp_<id>_<tool> 可逆解析
      expect(McpServerEntrySchema.safeParse(preset).success).toBe(true);
      expect(preset.command).toBe("bun");
      expect(preset.timeoutMs).toBe(30_000);
      expect(preset.whitelist).toEqual([]);
      expect(typeof preset.label === "string" && preset.label.length > 0).toBe(true); // 中文显示名
    }
  });

  test("每条 args = [\"run\", \"packages/mcp-<id>/src/index.ts\"] 且文件真实存在", () => {
    for (const preset of MCP_PRESETS) {
      expect(preset.args).toEqual(["run", `packages/mcp-${preset.id}/src/index.ts`]);
      expect(existsSync(join(REPO_ROOT, "packages", `mcp-${preset.id}`, "src", "index.ts"))).toBe(true);
    }
  });

  test("env 键合法（大写字母数字下划线）且值非空", () => {
    for (const preset of MCP_PRESETS) {
      for (const [key, value] of Object.entries(preset.env)) {
        expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test("启用集 = 核验过的纯计算集（15 个：零 env 依赖）；与 MCP_PRESET_ENABLED_IDS 完全一致", () => {
    const enabled = MCP_PRESETS.filter((p) => p.enabled).map((p) => p.id).sort();
    // 核验依据：各包 src/index.ts —— time/color/csv/regex/markdown/code/math/json/text/crypto 零 node:fs 零网络；
    // diff 只读文件（jailFromEnv 缺省回退 cwd）；subtitle 全部工具文本入参文本出参（零 node:fs）；
    // chart/stats/palette 为可视化套件新增纯计算包（SVG 字符串拼装/数值计算/色彩数学）
    expect(enabled).toEqual([
      "chart", "code", "color", "crypto", "csv", "diff", "json", "markdown", "math", "palette", "regex", "stats", "subtitle", "text", "time",
    ]);
    expect(enabled).toEqual([...MCP_PRESET_ENABLED_IDS].sort());
    // 启用组一律零 env（导入即生效，无需任何配置）
    for (const preset of MCP_PRESETS.filter((p) => p.enabled)) {
      expect(preset.env).toEqual({});
    }
  });

  test("停用集：监狱根 env 预置 \".\"（用户一键开启）；os/web/bridge 无 env 需求但默认停用", () => {
    for (const [id, envKey] of Object.entries(JAIL_ROOT_ENV_KEYS)) {
      const preset = MCP_PRESETS.find((p) => p.id === id);
      expect(preset).toBeDefined();
      expect(preset!.enabled).toBe(false);
      expect(preset!.env).toEqual({ [envKey]: "." });
    }
    for (const id of SYSTEM_OR_NETWORK_IDS) {
      const preset = MCP_PRESETS.find((p) => p.id === id);
      expect(preset).toBeDefined();
      expect(preset!.enabled).toBe(false);
      expect(preset!.env).toEqual({});
    }
    // 28 = 15 启用 + 13 停用
    expect(MCP_PRESETS.filter((p) => p.enabled)).toHaveLength(15);
    expect(MCP_PRESETS.filter((p) => !p.enabled)).toHaveLength(13);
  });

  test("listMcpPresets 深拷贝：改写副本不影响 MCP_PRESETS 常量", () => {
    const copy = listMcpPresets();
    expect(copy).toHaveLength(MCP_PRESETS.length);
    expect(copy).toEqual(MCP_PRESETS);
    copy[0]!.enabled = !copy[0]!.enabled;
    copy[0]!.args.push("tampered");
    copy[0]!.env.POLLUTED = "x";
    copy[0]!.whitelist.push("nope");
    expect(MCP_PRESETS[0]!.enabled).not.toBe(copy[0]!.enabled);
    expect(MCP_PRESETS[0]!.args).not.toContain("tampered");
    expect(MCP_PRESETS[0]!.env).not.toHaveProperty("POLLUTED");
    expect(MCP_PRESETS[0]!.whitelist).toEqual([]);
  });
});
