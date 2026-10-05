// 对话会话持久化（issue #50，v0.2 §4）：<dataDir>/sessions/<id>.json，每会话一文件。
// - 契约冻结：SessionRecord / ChatMessageRecord / ChatToolCallRecord 形状与 Studio 前端（api.ts）共享
// - 原子写：同目录 tmp + rename（与 SettingsStore 同策略），mode 0o600
// - 损坏恢复：非法 JSON / 形状不符 → 改名保留 <id>.json.bad（旧备份先删，Windows rename 不覆盖）
//   → list 跳过、get/delete 404；其余会话不受影响
// - 无内存缓存：每次操作读盘（本地单进程、文件小；跨实例 / 服务重启永远一致）
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ServerError } from "../errors";

// ---------------------------------------------------------------- 契约（冻结，前端 api.ts 镜像）

/** 一次工具调用的持久化轨迹（orchestrator 在运行中/结束时写入） */
export interface ChatToolCallRecord {
  name: string;
  args: unknown;
  status: "ok" | "error" | "stopped";
  durationMs: number;
  resultSummary?: string;
  frame?: number;
  videoUrl?: string;
}

/** token 用量（一次 run 内跨步骤累计） */
export interface ChatUsageRecord {
  promptTokens: number;
  completionTokens: number;
}

/** 会话内一条消息（user 由 orchestrator 落库；assistant 一 run 一条，携带工具轨迹） */
export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  runId?: string;
  toolCalls?: ChatToolCallRecord[];
  usage?: ChatUsageRecord;
}

/** 会话记录（GET /api/sessions/:id 响应体） */
export interface SessionRecord {
  id: string;
  title: string;
  projectRoot: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessageRecord[];
}

/** GET /api/sessions 列表项（无 messages 正文） */
export interface SessionListItem {
  id: string;
  title: string;
  projectRoot: string | null;
  updatedAt: number;
  messageCount: number;
}

/** patchMessage 局部更新面（运行中轨迹 / 最终内容与用量回填） */
export interface ChatMessagePatch {
  content?: string;
  toolCalls?: ChatToolCallRecord[];
  usage?: ChatUsageRecord;
}

// ---------------------------------------------------------------- id

/** url-safe 随机 id（nanoid 风格）：`<prefix>_<12 字节 base64url>` */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

const SESSIONS_DIR = "sessions";
/** 会话文件 id 约束：s_ 前缀 + url-safe 字符（防路径穿越；长度上限 64） */
const ID_PATTERN = /^s_[A-Za-z0-9_-]{1,63}$/;

let tmpSeq = 0;

// ---------------------------------------------------------------- 形状校验（读盘时判损坏）

function isToolCallRecord(value: unknown): value is ChatToolCallRecord {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    (v.status === "ok" || v.status === "error" || v.status === "stopped") &&
    typeof v.durationMs === "number" &&
    (v.resultSummary === undefined || typeof v.resultSummary === "string") &&
    (v.frame === undefined || typeof v.frame === "number") &&
    (v.videoUrl === undefined || typeof v.videoUrl === "string")
  );
}

function isMessageRecord(value: unknown): value is ChatMessageRecord {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || (v.role !== "user" && v.role !== "assistant") || typeof v.content !== "string" || typeof v.createdAt !== "number") {
    return false;
  }
  if (v.runId !== undefined && typeof v.runId !== "string") return false;
  if (v.toolCalls !== undefined && (!Array.isArray(v.toolCalls) || !v.toolCalls.every(isToolCallRecord))) return false;
  if (v.usage !== undefined) {
    const u = v.usage as Record<string, unknown>;
    if (typeof u.promptTokens !== "number" || typeof u.completionTokens !== "number") return false;
  }
  return true;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    (v.projectRoot === null || typeof v.projectRoot === "string") &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    Array.isArray(v.messages) &&
    v.messages.every(isMessageRecord)
  );
}

// ---------------------------------------------------------------- SessionStore

export class SessionStore {
  /** 数据目录（sessions 子目录所在；与 settings.json 共用 resolveDataDir 结果） */
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private get dir(): string {
    return join(this.dataDir, SESSIONS_DIR);
  }

  private fileOf(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** 校验 id 形状（防路径穿越）→ 不合法直接按不存在处理 */
  private validId(id: string): boolean {
    return ID_PATTERN.test(id);
  }

  /** 会话列表（updatedAt 降序，最新在前；损坏文件跳过并留 .bad 备份） */
  list(): SessionListItem[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const items: SessionListItem[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // 自然排除 <id>.json.bad 与 tmp 残留
      const id = name.slice(0, -".json".length);
      if (!this.validId(id)) continue;
      const record = this.readOrBackup(id);
      if (record === null) continue;
      items.push({
        id: record.id,
        title: record.title,
        projectRoot: record.projectRoot,
        updatedAt: record.updatedAt,
        messageCount: record.messages.length,
      });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
    return items;
  }

  /** 创建会话（title 缺省「新对话」；projectRoot 缺省不绑定） */
  create(input: { title?: string; projectRoot?: string | null } = {}): SessionRecord {
    const title = typeof input.title === "string" && input.title.trim().length > 0 ? input.title.trim() : "新对话";
    const now = Date.now();
    const record: SessionRecord = {
      id: newId("s"),
      title,
      projectRoot: input.projectRoot ?? null,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.persist(record);
    return record;
  }

  /** 读取全量记录；不存在 / 损坏（已备份）→ 404 SESSION_NOT_FOUND */
  get(id: string): SessionRecord {
    const record = this.readOrBackup(id);
    if (record === null) {
      throw new ServerError("SESSION_NOT_FOUND", `session "${id}" not found`, 404);
    }
    return record;
  }

  /** 重命名（title 去首尾空白，不允许空） */
  rename(id: string, title: string): SessionRecord {
    const record = this.get(id);
    const clean = title.trim();
    if (clean.length === 0) {
      throw new ServerError("SERVER_INVALID_PARAMS", "title must be a non-empty string");
    }
    record.title = clean;
    record.updatedAt = Date.now();
    this.persist(record);
    return record;
  }

  /** 删除会话文件；不存在 → 404 */
  delete(id: string): void {
    const file = this.fileOf(id);
    if (!this.validId(id) || !existsSync(file)) {
      throw new ServerError("SESSION_NOT_FOUND", `session "${id}" not found`, 404);
    }
    unlinkSync(file);
  }

  /** 追加消息（orchestrator：user 在 run 开始时、assistant 首个回合建档时调用） */
  appendMessage(id: string, message: ChatMessageRecord): SessionRecord {
    const record = this.get(id);
    if (!isMessageRecord(message)) {
      throw new ServerError("SESSION_INVALID", `invalid chat message record: ${JSON.stringify(message).slice(0, 120)}`);
    }
    record.messages.push(message);
    record.updatedAt = Date.now();
    this.persist(record);
    return record;
  }

  /** 局部更新一条消息（运行中工具轨迹 / 最终内容与用量回填） */
  patchMessage(id: string, messageId: string, patch: ChatMessagePatch): SessionRecord {
    const record = this.get(id);
    const message = record.messages.find((m) => m.id === messageId);
    if (message === undefined) {
      throw new ServerError("SESSION_MESSAGE_NOT_FOUND", `message "${messageId}" not found in session "${id}"`, 404);
    }
    if (patch.content !== undefined) message.content = patch.content;
    if (patch.toolCalls !== undefined) message.toolCalls = patch.toolCalls;
    if (patch.usage !== undefined) message.usage = patch.usage;
    record.updatedAt = Date.now();
    this.persist(record);
    return record;
  }

  // ---------------------------------------------------------------- internals

  /** 读取 + 形状校验；损坏 → 备份 .bad 后按不存在处理（返回 null） */
  private readOrBackup(id: string): SessionRecord | null {
    if (!this.validId(id)) return null;
    const file = this.fileOf(id);
    if (!existsSync(file)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      this.backupCorrupt(file, err);
      return null;
    }
    if (!isSessionRecord(parsed) || parsed.id !== id) {
      this.backupCorrupt(file, new Error(isSessionRecord(parsed) ? `id mismatch (file ${id})` : "record shape invalid"));
      return null;
    }
    return parsed;
  }

  /** 损坏文件处置：改名保留为 <id>.json.bad（旧备份先删，Windows rename 不覆盖） */
  private backupCorrupt(file: string, cause: unknown): void {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[videoos/server] session file corrupt (${reason}); skipped (backup kept at ${file}.bad)`);
    try {
      try {
        unlinkSync(`${file}.bad`);
      } catch {
        // 无旧备份
      }
      renameSync(file, `${file}.bad`);
    } catch (err) {
      console.warn(`[videoos/server] session backup failed (${err instanceof Error ? err.message : String(err)}); continuing`);
    }
  }

  /** 原子持久化：tmp + rename（mode 0o600）；sessions 目录不存在时自动创建 */
  private persist(record: SessionRecord): void {
    mkdirSync(this.dir, { recursive: true });
    const file = this.fileOf(record.id);
    const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }
}
