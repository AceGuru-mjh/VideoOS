// 会话持久化（#50）：<dataDir>/sessions/<id>.json 一会话一文件，原子写。
// 消息含 role/content/artifacts/usage/taskCards/toolCalls；服务重启会话保留。
// 惰性加载 + 内存缓存：list() 只读摘要；get() 全量。并发写经实例内串行链。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ChatSession, SessionMessage, SessionSummary } from "./types";

/** 会话不存在（app.ts 映射为 404 SERVER_SESSION_NOT_FOUND） */
export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`session not found: ${id}`);
    this.name = "SessionNotFoundError";
  }
}

/** 会话参数非法（app.ts 映射为 400） */
export class SessionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionValidationError";
  }
}

const TITLE_MAX = 80;

function newId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 从首条用户消息推导标题（前 40 字符，裁剪到词/字符边界） */
export function deriveTitle(message: string): string {
  const single = message.replace(/\s+/g, " ").trim();
  if (single.length === 0) return "New chat";
  return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}

function sanitizeMessage(raw: unknown): SessionMessage | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string" || (rec.role !== "user" && rec.role !== "assistant")) return null;
  return {
    id: rec.id,
    role: rec.role,
    content: typeof rec.content === "string" ? rec.content : "",
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    ...(typeof rec.runId === "string" ? { runId: rec.runId } : {}),
    ...(Array.isArray(rec.artifacts) ? { artifacts: rec.artifacts as SessionMessage["artifacts"] } : {}),
    ...(Array.isArray(rec.taskCards) ? { taskCards: rec.taskCards as SessionMessage["taskCards"] } : {}),
    ...(Array.isArray(rec.toolCalls) ? { toolCalls: rec.toolCalls as SessionMessage["toolCalls"] } : {}),
    ...(rec.usage !== null && typeof rec.usage === "object" ? { usage: rec.usage as SessionMessage["usage"] } : {}),
    ...(typeof rec.error === "string" ? { error: rec.error } : {}),
    ...(rec.stopped === true ? { stopped: true } : {}),
  };
}

function sanitizeSession(raw: unknown, fallbackId: string): ChatSession | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string") return null;
  const messages = Array.isArray(rec.messages)
    ? rec.messages.map(sanitizeMessage).filter((m): m is SessionMessage => m !== null)
    : [];
  return {
    id: rec.id || fallbackId,
    title: typeof rec.title === "string" && rec.title.length > 0 ? rec.title.slice(0, TITLE_MAX) : "New chat",
    projectRoot: typeof rec.projectRoot === "string" ? rec.projectRoot : null,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
    messages,
  };
}

export class SessionStore {
  private readonly dir: string;
  private readonly cache = new Map<string, ChatSession>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dir = resolve(dataDir, "sessions");
  }

  // ------------------------------------------------------------------ 读取

  /** 全量会话摘要（updatedAt 倒序） */
  list(): SessionSummary[] {
    this.ensureLoaded();
    return [...this.cache.values()]
      .map((s): SessionSummary => ({
        id: s.id,
        title: s.title,
        projectRoot: s.projectRoot,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  get(id: string): ChatSession | null {
    this.ensureLoaded();
    const hit = this.cache.get(id);
    return hit === undefined ? null : structuredClone(hit);
  }

  require(id: string): ChatSession {
    const session = this.get(id);
    if (session === null) throw new SessionNotFoundError(id);
    return session;
  }

  // ------------------------------------------------------------------ CRUD

  create(input: { title?: string; projectRoot?: string | null } = {}): ChatSession {
    if (input.title !== undefined && (typeof input.title !== "string" || input.title.length > TITLE_MAX)) {
      throw new SessionValidationError(`title must be a string of at most ${TITLE_MAX} chars`);
    }
    if (input.projectRoot !== undefined && input.projectRoot !== null && typeof input.projectRoot !== "string") {
      throw new SessionValidationError("projectRoot must be a string or null");
    }
    const session: ChatSession = {
      id: newId(),
      title: (input.title ?? "").trim() || "New chat",
      projectRoot: input.projectRoot ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    };
    this.cache.set(session.id, session);
    this.persist(session);
    return structuredClone(session);
  }

  patch(id: string, patch: { title?: string; projectRoot?: string | null }): ChatSession {
    const session = this.require(id);
    if (patch.title !== undefined) {
      if (typeof patch.title !== "string" || patch.title.trim().length === 0 || patch.title.length > TITLE_MAX) {
        throw new SessionValidationError(`title must be a non-empty string of at most ${TITLE_MAX} chars`);
      }
      session.title = patch.title.trim();
    }
    if (patch.projectRoot !== undefined) {
      if (patch.projectRoot !== null && typeof patch.projectRoot !== "string") {
        throw new SessionValidationError("projectRoot must be a string or null");
      }
      session.projectRoot = patch.projectRoot;
    }
    session.updatedAt = nowIso();
    this.cache.set(session.id, session);
    this.persist(session);
    return structuredClone(session);
  }

  delete(id: string): boolean {
    this.ensureLoaded();
    const existed = this.cache.delete(id);
    if (existed) {
      this.writeChain = this.writeChain
        .then(() => rm(this.fileOf(id), { force: true }))
        .catch(() => undefined);
      void this.writeChain;
    }
    return existed;
  }

  // ------------------------------------------------------------------ 消息

  /** 追加用户消息（自动推导会话标题：首条用户消息前 40 字符） */
  appendUserMessage(id: string, content: string): SessionMessage {
    const session = this.require(id);
    const message: SessionMessage = { id: newMessageId(), role: "user", content, createdAt: nowIso() };
    session.messages.push(message);
    if (session.messages.filter((m) => m.role === "user").length === 1) {
      session.title = deriveTitle(content);
    }
    session.updatedAt = nowIso();
    this.cache.set(session.id, session);
    this.persist(session);
    return structuredClone(message);
  }

  /** 追加 assistant 消息（占位，后续 patchMessage 增量回填流式内容） */
  appendAssistantMessage(id: string, runId: string): SessionMessage {
    const session = this.require(id);
    const message: SessionMessage = { id: newMessageId(), role: "assistant", content: "", createdAt: nowIso(), runId };
    session.messages.push(message);
    session.updatedAt = nowIso();
    this.cache.set(session.id, session);
    this.persist(session);
    return structuredClone(message);
  }

  /** 定向更新消息（流式回填/artifact 落定/usage 收口）；返回更新后消息 */
  patchMessage(sessionId: string, messageId: string, patch: Partial<Omit<SessionMessage, "id" | "role">>): SessionMessage {
    const session = this.require(sessionId);
    const message = session.messages.find((m) => m.id === messageId);
    if (message === undefined) throw new SessionNotFoundError(`message ${messageId} in ${sessionId}`);
    if (patch.content !== undefined && typeof patch.content === "string") message.content = patch.content;
    if (patch.artifacts !== undefined && Array.isArray(patch.artifacts)) message.artifacts = patch.artifacts;
    if (patch.taskCards !== undefined && Array.isArray(patch.taskCards)) message.taskCards = patch.taskCards;
    if (patch.toolCalls !== undefined && Array.isArray(patch.toolCalls)) message.toolCalls = patch.toolCalls;
    if (patch.usage !== undefined) message.usage = patch.usage;
    if (typeof patch.error === "string") message.error = patch.error;
    if (patch.stopped === true) message.stopped = true;
    session.updatedAt = nowIso();
    this.cache.set(session.id, session);
    this.persist(session);
    return structuredClone(message);
  }

  // ------------------------------------------------------------------ 落盘

  private fileOf(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(join(this.dir, name), "utf8"));
        const session = sanitizeSession(raw, name.slice(0, -5));
        if (session !== null) this.cache.set(session.id, session);
      } catch {
        // 单个损坏会话文件：跳过（不拖垮整体启动）
      }
    }
  }

  /** 原子写（tmp + rename）；写失败仅记录——内存态仍是事实源，下次写覆盖 */
  private persist(session: ChatSession): void {
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        const tmp = join(this.dir, `${session.id}.tmp-${process.pid}-${Date.now().toString(36)}`);
        await writeFile(tmp, JSON.stringify(session, null, 2), "utf8");
        await rename(tmp, this.fileOf(session.id));
        // 清理同会话历史 tmp 残片（崩溃恢复兜底）
        try {
          for (const name of readdirSync(this.dir)) {
            if (name.startsWith(`${session.id}.tmp-`)) await rm(join(this.dir, name), { force: true });
          }
        } catch {
          // 目录列举失败无碍
        }
      })
      .catch(() => undefined);
    void this.writeChain;
  }
}
