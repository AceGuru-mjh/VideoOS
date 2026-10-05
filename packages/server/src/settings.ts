// Studio 设置中心（v0.2 SPEC §5）：类型化 schema + 原子持久化 + 深合并更新。
// 数据落盘 <dataDir>/settings.json；语言(zh/en)、Agent 自主性、工具权限、
// Skills 启用集、MCP 服务器配置全部经此存取（唯一事实源，UI 与 orchestrator 共读）。
import { existsSync, readFileSync } from "node:fs";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 界面语言（全面中英切换） */
export type LanguageCode = "zh" | "en";

/** 单工具权限三态：allow 直接执行 / confirm 需用户确认 / deny 拒绝 */
export type ToolPermissionMode = "allow" | "confirm" | "deny";

/** 自主级别：L1 全确认 / L2 仅危险确认 / L3 渲染前确认 / L4 全自动 */
export type AutonomyLevel = 1 | 2 | 3 | 4;

/** MCP 服务器条目（settings.mcp.servers 的值形状） */
export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  /** 工具白名单（空 = 全部） */
  whitelist: string[];
  timeoutMs: number;
}

export interface StudioSettings {
  language: LanguageCode;
  agent: {
    autonomyLevel: AutonomyLevel;
    maxSteps: number;
    toolPermissions: Record<string, ToolPermissionMode>;
    /** 危险命令黑名单（正则源文本，命中 → 强制 confirm/deny） */
    dangerousCommandPatterns: string[];
  };
  skills: {
    /** name → 启用态；缺省视为 true */
    enabled: Record<string, boolean>;
    customDir: string | null;
    autoTrigger: boolean;
  };
  mcp: {
    servers: Record<string, McpServerEntry>;
    /** Agent 工具表合并 MCP 工具（31 VAP 之外） */
    mergeTools: boolean;
  };
}

/** 校验失败（app.ts 映射为 400 SERVER_INVALID_SETTINGS） */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export const DEFAULT_SETTINGS: StudioSettings = {
  language: "zh",
  agent: {
    autonomyLevel: 3,
    maxSteps: 24,
    toolPermissions: {},
    dangerousCommandPatterns: ["rm\\s+-rf", "del\\s+/[sq]", "format\\s+[a-z]:", "shutdown", "mkfs"],
  },
  skills: { enabled: {}, customDir: null, autoTrigger: true },
  mcp: { servers: {}, mergeTools: false },
};

const SETTINGS_FILENAME = "settings.json";

/** 默认数据目录：env VIDEOOS_DATA_DIR → 仓根 .videoos-data（monorepo 布局探测） */
export function defaultDataDir(): string {
  const env = process.env.VIDEOOS_DATA_DIR;
  if (typeof env === "string" && env.length > 0) return resolve(env);
  const here = dirname(fileURLToPath(import.meta.url)); // packages/server/src
  return resolve(here, "..", "..", "..", ".videoos-data");
}

// ---------------------------------------------------------------------------
// 校验器（手写、无第三方依赖；逐字段给出可读错误）
// ---------------------------------------------------------------------------

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SettingsValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new SettingsValidationError(`${path} must be a boolean`);
  return value;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new SettingsValidationError(`${path} must be an array`);
  return value.map((v, i) => expectString(v, `${path}[${i}]`));
}

function validateMcpServerEntry(value: unknown, path: string): McpServerEntry {
  const rec = expectRecord(value, path);
  const entry: McpServerEntry = {
    command: expectString(rec.command, `${path}.command`),
    args: rec.args === undefined ? [] : expectStringArray(rec.args, `${path}.args`),
    env: {},
    enabled: rec.enabled === undefined ? true : expectBoolean(rec.enabled, `${path}.enabled`),
    whitelist: rec.whitelist === undefined ? [] : expectStringArray(rec.whitelist, `${path}.whitelist`),
    timeoutMs: 30_000,
  };
  if (rec.env !== undefined) {
    const env = expectRecord(rec.env, `${path}.env`);
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string") throw new SettingsValidationError(`${path}.env.${k} must be a string`);
      entry.env[k] = v;
    }
  }
  if (rec.timeoutMs !== undefined) {
    if (typeof rec.timeoutMs !== "number" || !Number.isInteger(rec.timeoutMs) || rec.timeoutMs < 100 || rec.timeoutMs > 600_000) {
      throw new SettingsValidationError(`${path}.timeoutMs must be an integer in [100, 600000]`);
    }
    entry.timeoutMs = rec.timeoutMs;
  }
  return entry;
}

/** 深合并校验：patch 中出现的字段覆盖 current，未出现字段保留；返回新对象（不改入参） */
function mergeSettings(current: StudioSettings, patch: unknown): StudioSettings {
  const rec = expectRecord(patch, "settings");
  const next: StudioSettings = {
    language: current.language,
    agent: { ...current.agent, toolPermissions: { ...current.agent.toolPermissions }, dangerousCommandPatterns: [...current.agent.dangerousCommandPatterns] },
    skills: { ...current.skills, enabled: { ...current.skills.enabled } },
    mcp: { ...current.mcp, servers: { ...current.mcp.servers } },
  };

  if (rec.language !== undefined) {
    if (rec.language !== "zh" && rec.language !== "en") {
      throw new SettingsValidationError('settings.language must be "zh" or "en"');
    }
    next.language = rec.language;
  }

  if (rec.agent !== undefined) {
    const agent = expectRecord(rec.agent, "settings.agent");
    if (agent.autonomyLevel !== undefined) {
      if (![1, 2, 3, 4].includes(agent.autonomyLevel as number)) {
        throw new SettingsValidationError("settings.agent.autonomyLevel must be 1, 2, 3 or 4");
      }
      next.agent.autonomyLevel = agent.autonomyLevel as AutonomyLevel;
    }
    if (agent.maxSteps !== undefined) {
      if (typeof agent.maxSteps !== "number" || !Number.isInteger(agent.maxSteps) || agent.maxSteps < 1 || agent.maxSteps > 200) {
        throw new SettingsValidationError("settings.agent.maxSteps must be an integer in [1, 200]");
      }
      next.agent.maxSteps = agent.maxSteps;
    }
    if (agent.toolPermissions !== undefined) {
      const perms = expectRecord(agent.toolPermissions, "settings.agent.toolPermissions");
      for (const [tool, mode] of Object.entries(perms)) {
        if (mode !== "allow" && mode !== "confirm" && mode !== "deny") {
          throw new SettingsValidationError(`settings.agent.toolPermissions.${tool} must be "allow" | "confirm" | "deny"`);
        }
        next.agent.toolPermissions[tool] = mode;
      }
    }
    if (agent.dangerousCommandPatterns !== undefined) {
      next.agent.dangerousCommandPatterns = expectStringArray(agent.dangerousCommandPatterns, "settings.agent.dangerousCommandPatterns");
    }
  }

  if (rec.skills !== undefined) {
    const skills = expectRecord(rec.skills, "settings.skills");
    if (skills.enabled !== undefined) {
      const enabled = expectRecord(skills.enabled, "settings.skills.enabled");
      for (const [name, on] of Object.entries(enabled)) {
        next.skills.enabled[name] = expectBoolean(on, `settings.skills.enabled.${name}`);
      }
    }
    if (skills.customDir !== undefined) {
      if (skills.customDir !== null && typeof skills.customDir !== "string") {
        throw new SettingsValidationError("settings.skills.customDir must be a string or null");
      }
      next.skills.customDir = skills.customDir;
    }
    if (skills.autoTrigger !== undefined) {
      next.skills.autoTrigger = expectBoolean(skills.autoTrigger, "settings.skills.autoTrigger");
    }
  }

  if (rec.mcp !== undefined) {
    const mcp = expectRecord(rec.mcp, "settings.mcp");
    if (mcp.servers !== undefined) {
      const servers = expectRecord(mcp.servers, "settings.mcp.servers");
      // PUT 语义：servers 为整体替换（删掉的条目即移除）
      next.mcp.servers = {};
      for (const [name, entry] of Object.entries(servers)) {
        next.mcp.servers[name] = validateMcpServerEntry(entry, `settings.mcp.servers.${name}`);
      }
    }
    if (mcp.mergeTools !== undefined) {
      next.mcp.mergeTools = expectBoolean(mcp.mergeTools, "settings.mcp.mergeTools");
    }
  }

  return next;
}

/** 落盘 JSON 的形状守卫（读取时逐字段白名单拷贝，未知字段忽略 → 前向兼容） */
function sanitizeLoaded(raw: unknown): StudioSettings {
  try {
    return mergeSettings(DEFAULT_SETTINGS, raw);
  } catch {
    return { ...DEFAULT_SETTINGS }; // 损坏的 settings.json → 回默认（不删文件，用户可修复）
  }
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private readonly dataDir: string;
  private current: StudioSettings;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.current = this.load();
  }

  private get filePath(): string {
    return resolve(this.dataDir, SETTINGS_FILENAME);
  }

  private load(): StudioSettings {
    try {
      if (!existsSync(this.filePath)) return structuredClone(DEFAULT_SETTINGS);
      return sanitizeLoaded(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** 当前设置（只读视图；调用方不得改写） */
  get(): Readonly<StudioSettings> {
    return this.current;
  }

  /** 深合并更新 + 原子落盘（串行化写避免交错） */
  update(patch: unknown): StudioSettings {
    const next = mergeSettings(this.current, patch);
    this.current = next;
    this.writeChain = this.writeChain.then(() => this.persist(next)).catch(() => undefined);
    void this.writeChain;
    return structuredClone(next);
  }

  /** 语言便捷读写（高频路径：TopBar 即时切换） */
  setLanguage(language: LanguageCode): StudioSettings {
    return this.update({ language });
  }

  private async persist(settings: StudioSettings): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = resolve(this.dataDir, `${SETTINGS_FILENAME}.tmp-${process.pid}-${Date.now().toString(36)}`);
    await writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
