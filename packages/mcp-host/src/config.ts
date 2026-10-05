// @videoos/mcp-host 配置层（agent-kit SPEC §3.4 冻结契约）：
// McpServerConfig / McpHostConfig 类型 + mcp.json 的 zod 校验与 loadHostConfig 读取。
// 校验策略：server 级未知字段一律报错（错误信息带 mcp.json 内的字段路径），避免配置拼写错误静默失效。
import { readFile } from "node:fs/promises";
import { z } from "zod";

/** 单次 tools/call 默认超时（ms）——McpServerConfig.timeoutMs 缺省值 */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** 崩溃重启退避基数（ms）：退避序列 = base × 2^n（缺省 1000 → 1s/2s/4s） */
export const DEFAULT_RESTART_BACKOFF_MS = 1_000;
/** 握手（initialize / tools/list）单步超时（ms） */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** 滚动窗口内允许的最大重启次数；超过则标记 unhealthy 并从 listTools 排除 */
export const MAX_RESTARTS_PER_WINDOW = 3;
/** 重启计数的滚动窗口长度（ms） */
export const RESTART_WINDOW_MS = 60_000;
/** stop() 发出 SIGTERM 后等待进程退出的宽限期，超时改发 SIGKILL（ms） */
export const STOP_GRACE_MS = 3_000;

/** 单个子服务器配置（mcp.json `servers.<name>` 节点） */
export interface McpServerConfig {
  /** 可执行文件，如 "bun" 或绝对路径 exe */
  command: string;
  /** 命令行参数，如 ["run", "packages/mcp-time/src/index.ts"] */
  args: string[];
  /** 追加到 process.env 之上的环境变量（多根 env 如 MCP_FS_ROOTS 写在这里） */
  env?: Record<string, string>;
  /** 是否启用，默认 true；false 时 start() 跳过（记一条 log） */
  enabled?: boolean;
  /** 单次 call 超时（ms），默认 30_000；超时只杀本次等待，不杀进程 */
  timeoutMs?: number;
  /** 工具白名单（原始名或 "<server>.<name>" 全名）；缺省 = 该服务器全部工具 */
  allowedTools?: string[];
}

/** 宿主配置（mcp.json 根对象；也可编程构造后直接交给 McpHost） */
export interface McpHostConfig {
  servers: Record<string, McpServerConfig>;
  /**
   * 崩溃重启退避基数 ms（可选，SPEC 冻结面之外的健壮性参数）：
   * 第 n 次重启前等待 restartBackoff × 2^n（缺省 1000 → 1s/2s/4s）。
   */
  restartBackoff?: number;
}

const serverConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedTools: z.array(z.string().min(1)).optional(),
  })
  .strict();

const hostConfigSchema = z
  .object({
    servers: z.record(z.string(), serverConfigSchema),
    restartBackoff: z.number().int().positive().optional(),
  })
  .strict();

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读取并校验 mcp.json（宿主配置，见 SPEC 附录 G）。
 * 失败一律抛 Error：
 *   - 文件不可读 / JSON 语法错误 → 消息含原因；
 *   - zod 校验失败 → 每条 issue 一行，前缀为 `servers > <name> > <field>` 形式的字段路径。
 */
export async function loadHostConfig(path: string): Promise<McpHostConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`loadHostConfig: cannot read ${path}: ${errText(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`loadHostConfig: invalid JSON in ${path}: ${errText(error)}`);
  }
  const result = hostConfigSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? `${issue.path.join(" > ")}: ` : "";
      return `  ${where}${issue.message}`;
    });
    throw new Error(`loadHostConfig: invalid config ${path}:\n${lines.join("\n")}`);
  }
  return result.data as McpHostConfig;
}
