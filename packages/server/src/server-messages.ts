// 服务端用户可见文案（中/英双表）：
// - 16-r4：mcpHint —— GET /api/mcp 的 hint 字段（ProjectPanel 直接渲染）。
// - 16-r5：errorDetail —— ServerError / 工具错误「CODE: detail」中 detail 部分的双语层。
//   客户端 useApiErrorMessage 已按错误码本地化标题（apps/studio errors.*），但 detail
//   原样展示（英文界面会出现中文 detail）→ 本表让 detail 也随 settings.general.language。
//   接线点（app.ts onError，单行，集成方落地）：
//     return c.json({ error: errorDetail(state.settings.get(), err.message) }, err.status as 400);
//   （errorDetail 自带 "CODE: " 前缀剥取/回贴，可直接传 err.message 整串。）
// - 语域说明：LLM 系统提示主体保持中文（与 UI 语言解耦），仅「回复语言指令」随设置
//   （orchestrator 的语言行，16-r5）；WS "server" 事件为技术日志不收录。
import type { SettingsValues } from "./settings/schema";

// ---------------------------------------------------------------- 语言解析

export type MessageLang = "zh" | "en";

/** 设置语言 → 文案语言（schema 枚举 zh/en；防御式兜底 zh） */
export function messageLang(settings: SettingsValues): MessageLang {
  return settings.general.language === "en" ? "en" : "zh";
}

/** GET /api/mcp 的 hint 字段（ProjectPanel 直接渲染；en 版保持既有 MCP client JSON 片段） */
export function mcpHint(settings: SettingsValues): string {
  return messageLang(settings) === "zh"
    ? "在项目目录运行 videoos mcp，或配置 MCP client: {\"mcpServers\":{\"videoos\":{\"command\":\"videoos\",\"args\":[\"mcp\"],\"cwd\":\"<projectRoot>\"}}}"
    : "Run `videoos mcp` in the project directory, or configure an MCP client: {\"mcpServers\":{\"videoos\":{\"command\":\"videoos\",\"args\":[\"mcp\"],\"cwd\":\"<projectRoot>\"}}}";
}

// ---------------------------------------------------------------- 错误详情双语表（16-r5）

/**
 * 精确匹配表 —— throw 点为静态字符串的中文 detail（与源码逐字节一致）。
 * 收录范围：聊天 / 确认流 / 渲染 / MCP / 供应商 / 项目初始化等用户可见路径；
 * 纯开发者向的 body 校验（"body.xxx required" 类）不收录（原样透传）。
 */
const EXACT_DETAILS: Readonly<Record<string, string>> = {
  // orchestrator.ts：POST /api/agent/chat 三类 409（Composer 409 提示卡 / MessageStream 渲染）
  "已有 Agent 运行中（单任务），请先等待完成或停止":
    "An agent run is already active (single task); wait for it to finish or stop it first",
  "未配置模型 Provider（在设置中心添加，或使用演示模式创建 manual 供应商）":
    "No model provider configured (add one in the Settings Center, or create a manual provider for demo mode)",
  "会话未绑定项目：请先在 Studio 打开项目，或创建会话时传入 projectRoot":
    "This session has no bound project: open a project in Studio first, or pass projectRoot when creating the session",
  // app.ts：渲染 409（RenderDialog renderError）
  "渲染进行中（v1 单任务）": "A render is already in progress (v1 allows a single render task)",
  // chat/mcp.ts：宿主缺失 501（McpPanel / /api/mcp/* 端点）
  "@videoos/mcp-host 未安装或不可用（可选依赖）；安装后 MCP 面板与端点可用":
    "@videoos/mcp-host is not installed or unavailable (optional dependency); the MCP panel and endpoints become available once it is installed",
};

/** 模板匹配表 —— throw 点含插值（confirmId / 服务器 id / 工具名 / 路径等）的 detail。
 *  pattern 与源码模板同构（隐式全串锚定）；en 以捕获组重建译文，动态段原样保留。 */
interface DetailTemplate {
  pattern: RegExp;
  en: (m: RegExpMatchArray) => string;
}

const TEMPLATE_DETAILS: readonly DetailTemplate[] = [
  // app.ts：POST /api/agent/resolve —— 确认卡已失效（确认流 404）
  {
    pattern: /^confirm "([^"]*)" 不存在或已被裁决（超时\/停止\/已处理）$/,
    en: (m) => `confirm "${m[1] ?? ""}" not found or already resolved (timed out / stopped / already handled)`,
  },
  // chat/mcp.ts：启动失败（McpPanel 启动钮错误）
  {
    pattern: /^mcp server "([^"]*)" 启动失败：([\s\S]+)$/,
    en: (m) => `mcp server "${m[1] ?? ""}" failed to start: ${m[2] ?? ""}`,
  },
  // chat/mcp.ts：启动未知服务器 404
  {
    pattern: /^mcp server "([^"]*)" not found \(PUT \/api\/mcp\/servers 先配置\)$/,
    en: (m) => `mcp server "${m[1] ?? ""}" not found (configure it first via PUT /api/mcp/servers)`,
  },
  // chat/skills.ts：PATCH /api/skills/:name 未知技能 404
  {
    pattern: /^skill "([^"]*)" not found \(GET \/api\/skills 查看可用技能\)$/,
    en: (m) => `skill "${m[1] ?? ""}" not found (see GET /api/skills for available skills)`,
  },
  // state.ts：新建项目校验（Welcome 新建表单错误）
  {
    pattern: /^非法项目名：(.+)$/,
    en: (m) => `Invalid project name: ${m[1] ?? ""}`,
  },
  // state.ts：目录已是项目 409（Welcome 新建表单错误）
  {
    pattern: /^(.+) 已是 VideoOS 项目$/,
    en: (m) => `${m[1] ?? ""} is already a VideoOS project`,
  },
  // settings/providers.ts：id 重复 400（设置中心新增供应商）
  {
    pattern: /^provider "([^"]*)" already exists（id 重复，换一个 id 或省略由服务端生成）$/,
    en: (m) => `provider "${m[1] ?? ""}" already exists (duplicate id; pick another id, or omit it to let the server generate one)`,
  },
  // settings/providers.ts：条目改名 400（设置中心编辑供应商）
  {
    pattern: /^entry\.id (.+) does not match route id "([^"]*)"（不支持改名，请删除后重建）$/,
    en: (m) => `entry.id ${m[1] ?? ""} does not match route id "${m[2] ?? ""}" (rename is not supported; delete and recreate the entry instead)`,
  },
  // chat/gate.ts：权限拒绝（VapToolResult.error，TaskCard 工具错误行 + LLM 自修复提示）
  {
    pattern: /^工具 "([^"]*)" 已被权限设置拒绝（deny），请改用其他方式或询问用户$/,
    en: (m) => `tool "${m[1] ?? ""}" denied by permission settings; try a different approach or ask the user`,
  },
  // chat/gate.ts：确认挂起前运行已被停止
  {
    pattern: /^工具 "([^"]*)" 调用前运行已被停止$/,
    en: (m) => `tool "${m[1] ?? ""}" was not called because the run had already been stopped`,
  },
  // chat/gate.ts：用户拒绝 / 确认超时
  {
    pattern: /^工具 "([^"]*)" 用户拒绝了本次调用或确认超时$/,
    en: (m) => `tool "${m[1] ?? ""}" was denied by the user or the confirmation timed out`,
  },
  // chat/gate.ts：MCP 合并工具不可用（detail = mcp_<server>_<tool>（说明））
  {
    pattern: /^(.+)（settings\.mcp\.mergeTools 未开启或无运行中服务器）$/,
    en: (m) => `${m[1] ?? ""} (settings.mcp.mergeTools is disabled or no MCP server is running)`,
  },
];

/**
 * 双语错误详情：服务端错误的用户可见中文 detail → 中/英双译文。
 * - 查表：先精确匹配（静态串），再模板匹配（带插值串，动态段捕获回填）；未命中原样透传。
 * - 入参兼容 "CODE: detail" 整串（app.onError 单行接线即可整体翻译 detail 部分）：
 *   剥取大写错误码前缀 → 译 detail → 回贴前缀。
 * - zh：中文为源语言，一律原样返回（含未命中透传）。
 */
export function errorDetail(settings: SettingsValues, detail: string): string {
  if (messageLang(settings) === "zh") return detail;
  const prefixed = /^([A-Z][A-Z0-9_]+): (.*)$/s.exec(detail);
  const body = prefixed !== null ? prefixed[2] ?? "" : detail;
  const exactEn = EXACT_DETAILS[body];
  let translated: string | null = exactEn ?? null;
  if (translated === null) {
    for (const t of TEMPLATE_DETAILS) {
      const m = body.match(t.pattern);
      if (m !== null) {
        translated = t.en(m);
        break;
      }
    }
  }
  if (translated === null) return detail; // 未收录：整串（含前缀）原样透传
  return prefixed !== null ? `${prefixed[1]}: ${translated}` : translated;
}
