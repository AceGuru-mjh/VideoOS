// MCP 推荐服务器预设（v0.2 §5「agent 工具太少」直答）：agent-kit/mcp.json 内置服务器 + 可视化套件新增
// 纯计算包的服务端镜像（共 28 个），GET /api/mcp/presets 供 Studio「一键导入推荐服务器」（常驻可用，无需 @videoos/mcp-host）。
//
// enabled 政策（逐包核验 packages/mcp-<n>/src/index.ts 的 env/落盘行为，当前分支实测）：
// - enabled=true（纯计算，导入即生效，零 env 依赖）：time/color/csv/regex/markdown/code/math/json/text/crypto
//   （零 node:fs、零网络）+ diff（文件对比只读 readFile/stat，jailFromEnv("MCP_DIFF_ROOTS") 缺省回退 cwd）
//   + subtitle（parse/stringify/shift/scale/merge/info 全部文本入参文本出参，零 node:fs —— 任务草案把 subtitle
//   归入停用组按「涉及落盘」假设，核验不成立，按「启用组 = 核验过的纯计算组」政策划入启用组）。
//   + chart/stats/palette（Task 2-a 可视化套件新增：纯字符串 SVG 拼装/纯数值计算/纯色彩数学，零 env 依赖）。
// - enabled=false（涉及文件系统/系统信息/网络/进程内代码执行，预置 env 后一键开启）：
//   fs/shell/media/assets/image/font/sqlite/git/archive/plot（jailFromEnv("MCP_<NAME>_ROOTS")，预置 "." 即
//   服务进程 cwd —— mcp-host spawn 继承 cwd，与 agent-kit/mcp.json 同语义）、os（系统信息/env 回显）、
//   web（http/https 抓取 + dns）、bridge（MCP_PLUGIN_ROOTS 进程内加载插件代码，缺省 <repo>/plugins）。
//
// 注意：args 相对仓库根（mcp-host spawn 不改 cwd，Studio 从仓库根启动时直接可用）。
// 合并语义在客户端（apps/studio McpSettingsPage.importPresets：按 id 保留既有、追加新增，再 PUT /api/mcp/servers）。
import type { McpServerEntry } from "../settings/schema";

/** 预设默认超时（与 PUT /api/mcp/servers 缺省归一一致） */
const PRESET_TIMEOUT_MS = 30_000;

/** 启用组（纯计算，见文件头核验依据）——测试断言启用集合与它完全一致 */
export const MCP_PRESET_ENABLED_IDS: readonly string[] = [
  "time",
  "color",
  "csv",
  "diff",
  "regex",
  "markdown",
  "code",
  "math",
  "json",
  "text",
  "crypto",
  "subtitle",
  "chart",
  "stats",
  "palette",
];

/**
 * 28 个内置 MCP 服务器预设（agent-kit 交付 25 个；可视化套件新增 chart/stats/palette 3 个；合计 139 个工具）。
 * 只读常量——修改请用 listMcpPresets() 的深拷贝。
 */
export const MCP_PRESETS: McpServerEntry[] = [
  // ---- 触文件系统/系统/网络（默认停用，预置 env 一键开启） ----
  { id: "fs", label: "文件系统", command: "bun", args: ["run", "packages/mcp-fs/src/index.ts"], env: { MCP_FS_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "shell", label: "Shell 命令", command: "bun", args: ["run", "packages/mcp-shell/src/index.ts"], env: { MCP_SHELL_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "os", label: "系统信息", command: "bun", args: ["run", "packages/mcp-os/src/index.ts"], env: {}, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "web", label: "网页抓取", command: "bun", args: ["run", "packages/mcp-web/src/index.ts"], env: {}, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 纯计算（默认启用，导入即生效） ----
  { id: "json", label: "JSON 工具", command: "bun", args: ["run", "packages/mcp-json/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "csv", label: "CSV 处理", command: "bun", args: ["run", "packages/mcp-csv/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "text", label: "文本处理", command: "bun", args: ["run", "packages/mcp-text/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "diff", label: "文本/文件对比", command: "bun", args: ["run", "packages/mcp-diff/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "regex", label: "正则工具", command: "bun", args: ["run", "packages/mcp-regex/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "markdown", label: "Markdown 分析", command: "bun", args: ["run", "packages/mcp-markdown/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "code", label: "源码分析", command: "bun", args: ["run", "packages/mcp-code/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "math", label: "数学计算", command: "bun", args: ["run", "packages/mcp-math/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 触文件系统/系统/网络（默认停用） ----
  { id: "media", label: "音视频处理", command: "bun", args: ["run", "packages/mcp-media/src/index.ts"], env: { MCP_MEDIA_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "assets", label: "素材库", command: "bun", args: ["run", "packages/mcp-assets/src/index.ts"], env: { MCP_ASSETS_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "image", label: "图像处理", command: "bun", args: ["run", "packages/mcp-image/src/index.ts"], env: { MCP_IMAGE_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "font", label: "字体工具", command: "bun", args: ["run", "packages/mcp-font/src/index.ts"], env: { MCP_FONT_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "sqlite", label: "SQLite 数据库", command: "bun", args: ["run", "packages/mcp-sqlite/src/index.ts"], env: { MCP_SQLITE_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "git", label: "Git 操作", command: "bun", args: ["run", "packages/mcp-git/src/index.ts"], env: { MCP_GIT_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 纯计算（默认启用） ----
  { id: "crypto", label: "哈希与编码", command: "bun", args: ["run", "packages/mcp-crypto/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "color", label: "颜色工具", command: "bun", args: ["run", "packages/mcp-color/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 触文件系统/系统/网络（默认停用） ----
  { id: "plot", label: "图表绘制", command: "bun", args: ["run", "packages/mcp-plot/src/index.ts"], env: { MCP_PLOT_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "subtitle", label: "字幕处理", command: "bun", args: ["run", "packages/mcp-subtitle/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "archive", label: "归档处理", command: "bun", args: ["run", "packages/mcp-archive/src/index.ts"], env: { MCP_ARCHIVE_ROOTS: "." }, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 纯计算（默认启用） ----
  { id: "time", label: "时间与时区", command: "bun", args: ["run", "packages/mcp-time/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 触文件系统/系统/网络（默认停用；MCP_PLUGIN_ROOTS 缺省 <repo>/plugins，无需预置） ----
  { id: "bridge", label: "插件桥接", command: "bun", args: ["run", "packages/mcp-bridge/src/index.ts"], env: {}, enabled: false, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  // ---- 纯计算（默认启用；Task 2-a 可视化套件新增） ----
  { id: "chart", label: "图表生成", command: "bun", args: ["run", "packages/mcp-chart/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "stats", label: "统计计算", command: "bun", args: ["run", "packages/mcp-stats/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
  { id: "palette", label: "配色方案", command: "bun", args: ["run", "packages/mcp-palette/src/index.ts"], env: {}, enabled: true, whitelist: [], timeoutMs: PRESET_TIMEOUT_MS },
];

/** 预设列表深拷贝（调用方可安全改写，不污染模块常量） */
export function listMcpPresets(): McpServerEntry[] {
  return MCP_PRESETS.map((preset) => ({
    ...preset,
    ...(preset.label !== undefined ? { label: preset.label } : {}),
    args: [...preset.args],
    env: { ...preset.env },
    whitelist: [...preset.whitelist],
  }));
}
