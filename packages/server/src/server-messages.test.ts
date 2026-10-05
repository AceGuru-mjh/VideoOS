// 服务端双语文案测试：
// - 16-r4 mcpHint：zh 保持既有 UI 契约原文（ProjectPanel 直接渲染）；en 提供等价英文 + 同一 MCP client JSON 片段
// - 16-r5 errorDetail：错误详情双语层 —— 精确表 / 模板表（动态段保留）、"CODE: detail" 整串接线形态、
//   未收录透传、messageLang 解析；语言驱动源为 settings.general.language（默认 zh；en 为显式切换值）
import { describe, expect, test } from "bun:test";
import { errorDetail, mcpHint, messageLang } from "./server-messages";
import { DEFAULT_SETTINGS, type SettingsValues } from "./settings/schema";

const withLanguage = (language: "zh" | "en"): SettingsValues => ({
  ...structuredClone(DEFAULT_SETTINGS),
  general: { ...DEFAULT_SETTINGS.general, language },
});

/** en 译文中不应残留的 CJK 表意字符（含扩展 A / 兼容区） */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

describe("server-messages（16-r4：服务端用户可见文案双语）", () => {
  test("mcpHint：zh 原文逐字保持（既有契约）；en 等价英文 + 相同 MCP client JSON 片段", () => {
    const zh = mcpHint(withLanguage("zh"));
    expect(zh).toBe(
      "在项目目录运行 videoos mcp，或配置 MCP client: {\"mcpServers\":{\"videoos\":{\"command\":\"videoos\",\"args\":[\"mcp\"],\"cwd\":\"<projectRoot>\"}}}",
    );

    const en = mcpHint(withLanguage("en"));
    expect(en).toContain("Run `videoos mcp` in the project directory");
    expect(en).toContain('{"mcpServers":{"videoos":{"command":"videoos","args":["mcp"],"cwd":"<projectRoot>"}}}');
    expect(en).not.toContain("在项目目录"); // 不残留中文
  });

  test("默认设置（language=zh）走中文表 —— 与 /api/mcp 未切换语言时的响应一致", () => {
    expect(mcpHint(structuredClone(DEFAULT_SETTINGS))).toContain("在项目目录运行 videoos mcp");
  });
});

describe("errorDetail（16-r5：错误详情双语层）", () => {
  test("精确表：静态中文 detail —— zh 原样返回；en 命中译文且无 CJK 残留", () => {
    const table: ReadonlyArray<readonly [string, string]> = [
      [
        "已有 Agent 运行中（单任务），请先等待完成或停止",
        "An agent run is already active (single task); wait for it to finish or stop it first",
      ],
      [
        "未配置模型 Provider（在设置中心添加，或使用演示模式创建 manual 供应商）",
        "No model provider configured (add one in the Settings Center, or create a manual provider for demo mode)",
      ],
      [
        "会话未绑定项目：请先在 Studio 打开项目，或创建会话时传入 projectRoot",
        "This session has no bound project: open a project in Studio first, or pass projectRoot when creating the session",
      ],
      ["渲染进行中（v1 单任务）", "A render is already in progress (v1 allows a single render task)"],
      [
        "@videoos/mcp-host 未安装或不可用（可选依赖）；安装后 MCP 面板与端点可用",
        "@videoos/mcp-host is not installed or unavailable (optional dependency); the MCP panel and endpoints become available once it is installed",
      ],
    ];
    for (const [zh, en] of table) {
      expect(errorDetail(withLanguage("zh"), zh)).toBe(zh); // 中文为源语言：原样
      const translated = errorDetail(withLanguage("en"), zh);
      expect(translated).toBe(en);
      expect(translated).not.toMatch(CJK_RE);
    }
  });

  test("模板表：带插值的中文 detail —— 动态段（id / 路径 / 工具名 / 错误信息）保留进 en", () => {
    const table: ReadonlyArray<readonly [string, string]> = [
      [
        'confirm "cf_ab12cd" 不存在或已被裁决（超时/停止/已处理）',
        'confirm "cf_ab12cd" not found or already resolved (timed out / stopped / already handled)',
      ],
      ['mcp server "fs" 启动失败：spawn ENOENT', 'mcp server "fs" failed to start: spawn ENOENT'],
      [
        'mcp server "shell" not found (PUT /api/mcp/servers 先配置)',
        'mcp server "shell" not found (configure it first via PUT /api/mcp/servers)',
      ],
      [
        'skill "product-demo" not found (GET /api/skills 查看可用技能)',
        'skill "product-demo" not found (see GET /api/skills for available skills)',
      ],
      ['非法项目名："my project"', 'Invalid project name: "my project"'],
      ["/tmp/x/my-video 已是 VideoOS 项目", "/tmp/x/my-video is already a VideoOS project"],
      [
        'provider "openai" already exists（id 重复，换一个 id 或省略由服务端生成）',
        'provider "openai" already exists (duplicate id; pick another id, or omit it to let the server generate one)',
      ],
      [
        'entry.id "new-id" does not match route id "old-id"（不支持改名，请删除后重建）',
        'entry.id "new-id" does not match route id "old-id" (rename is not supported; delete and recreate the entry instead)',
      ],
      [
        '工具 "scene.modify" 已被权限设置拒绝（deny），请改用其他方式或询问用户',
        'tool "scene.modify" denied by permission settings; try a different approach or ask the user',
      ],
      [
        '工具 "render.final" 调用前运行已被停止',
        'tool "render.final" was not called because the run had already been stopped',
      ],
      [
        '工具 "cache.clear" 用户拒绝了本次调用或确认超时',
        'tool "cache.clear" was denied by the user or the confirmation timed out',
      ],
      [
        "mcp_fs_read（settings.mcp.mergeTools 未开启或无运行中服务器）",
        "mcp_fs_read (settings.mcp.mergeTools is disabled or no MCP server is running)",
      ],
    ];
    for (const [zh, en] of table) {
      expect(errorDetail(withLanguage("zh"), zh)).toBe(zh); // 中文为源语言：原样
      expect(errorDetail(withLanguage("en"), zh)).toBe(en);
    }
  });

  test('"CODE: detail" 整串（app.onError 单行接线形态）：前缀剥取 → 译 detail → 回贴', () => {
    const source = "CHAT_RUN_ACTIVE: 已有 Agent 运行中（单任务），请先等待完成或停止";
    expect(errorDetail(withLanguage("en"), source)).toBe(
      "CHAT_RUN_ACTIVE: An agent run is already active (single task); wait for it to finish or stop it first",
    );
    // gate.ts 工具错误同形（VapToolResult.error，TaskCard 工具错误行）：非 ServerError 前缀同样兼容
    expect(errorDetail(withLanguage("en"), 'PERMISSION_DENIED: 工具 "render.final" 用户拒绝了本次调用或确认超时')).toBe(
      'PERMISSION_DENIED: tool "render.final" was denied by the user or the confirmation timed out',
    );
    expect(errorDetail(withLanguage("en"), 'MCP_TOOL_UNAVAILABLE: mcp_fs_read（settings.mcp.mergeTools 未开启或无运行中服务器）')).toBe(
      "MCP_TOOL_UNAVAILABLE: mcp_fs_read (settings.mcp.mergeTools is disabled or no MCP server is running)",
    );
    // zh：整串原样（含前缀）
    expect(errorDetail(withLanguage("zh"), source)).toBe(source);
  });

  test("未收录 detail 原样透传（英文技术串 / 未知中文串 / 空串 / 前缀未命中）", () => {
    const en = withLanguage("en");
    expect(errorDetail(en, "no project open (POST /api/project/open first)")).toBe("no project open (POST /api/project/open first)");
    expect(errorDetail(en, "某条未收录的中文提示")).toBe("某条未收录的中文提示");
    expect(errorDetail(en, "")).toBe("");
    // 开发者向 detail（路径越界内部信息）刻意不收录：带前缀整串透传
    const escape = "SERVER_PATH_ESCAPE: path escapes project root: ../secrets";
    expect(errorDetail(en, escape)).toBe(escape);
  });

  test("messageLang：zh / en 解析 + 默认设置为 zh", () => {
    expect(messageLang(withLanguage("zh"))).toBe("zh");
    expect(messageLang(withLanguage("en"))).toBe("en");
    expect(messageLang(structuredClone(DEFAULT_SETTINGS))).toBe("zh");
  });
});
