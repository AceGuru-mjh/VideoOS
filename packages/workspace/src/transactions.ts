// Video Workspace Transaction System（SPEC §7.3）：
//   BEGIN → 快照受保护文件集（.video/snapshots/<txid>/payload/ + tx.json 清单）
//   N 次 VAP 修改 + compile + test
//   COMMIT → 保留快照（可 diff），裁剪至最近 MAX_FINISHED_SNAPSHOTS 个终态快照
//   ROLLBACK → 清空受保护路径后从 payload 恢复，快照保留（失败可重试）
//
// 受保护文件集（PROTECTED_PATHS）：src/、assets/、tests/、video.project.json —— 即「Agent 可编辑的全部」。
// .video/ 永不进入快照（生成区，且快照自身在 .video/snapshots 下，排除保证了快照不会自我递归）。
//
// v1 已知简化（SPEC 允许）：
//   - 多文件回滚非原子（清空→复制期间中断会留下部分状态），但快照目录在 status 变为
//     rolled-back 之前始终保留 → 可通过 resume(id) 再次 rollback 重试到完整恢复；
//   - 单写者假设：跨进程并发 commit/rollback 同一事务不做磁盘级 CAS。
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WorkspaceError } from "./errors";

export interface TransactionInfo {
  id: string;
  description?: string;
  status: "active" | "committed" | "rolled-back";
  createdAt: string;
  /** 受保护文件数（tx.json 中 files 清单的长度） */
  files: number;
}

/** tx.json 落盘记录（files 为相对项目根的路径清单） */
interface TxRecord {
  id: string;
  description?: string;
  createdAt: string;
  status: TransactionInfo["status"];
  files: string[];
}

/** 事务 id 格式：tx_ + 8 位递增序号 + _ + 6 位随机 hex（事务元数据不影响渲染确定性，可用随机） */
const ID_PATTERN = /^tx_(\d{8})_[0-9a-f]{6}$/;
/** 受保护路径（相对项目根；目录递归保护） */
export const PROTECTED_PATHS: readonly string[] = ["src", "assets", "tests", "video.project.json"];
/** 终态（committed/rolled-back）快照保留上限，超出删除最旧 */
export const MAX_FINISHED_SNAPSHOTS = 20;

const PROTECTED_DIRS = ["src", "assets", "tests"] as const;
const PROTECTED_FILES = ["video.project.json"] as const;

function seqOf(id: string): number {
  return Number.parseInt(id.slice(3, 11), 10);
}

function toInfo(record: TxRecord): TransactionInfo {
  return {
    id: record.id,
    ...(record.description !== undefined ? { description: record.description } : {}),
    status: record.status,
    createdAt: record.createdAt,
    files: record.files.length,
  };
}

// ---------------------------------------------------------------------------
// Transaction：begin() 返回的句柄；commit/rollback 幂等保护（终态后再操作抛 TX_NOT_ACTIVE）
// ---------------------------------------------------------------------------

export class Transaction {
  private record: TxRecord;

  /** @internal 由 TransactionManager.begin / resume 构造 */
  constructor(manager: TransactionManager, record: TxRecord) {
    this.manager = manager;
    this.record = { ...record };
  }

  private readonly manager: TransactionManager;

  get id(): string {
    return this.record.id;
  }

  get description(): string | undefined {
    return this.record.description;
  }

  get status(): TransactionInfo["status"] {
    return this.record.status;
  }

  /** 提交：保留当前工作区状态，快照留档（供 diff/审计）并按上限裁剪 */
  async commit(): Promise<void> {
    if (this.record.status !== "active") {
      throw new WorkspaceError("TX_NOT_ACTIVE", `transaction ${this.record.id} is ${this.record.status}; only an active transaction can be committed`);
    }
    this.record = { ...this.record, status: "committed" };
    this.manager.writeRecord(this.record);
    this.manager.pruneFinished();
  }

  /**
   * 回滚：清空受保护路径 → 从 payload/ 复制回快照内容 → 标记 rolled-back。
   * 状态标记在恢复完成之后落盘：中途失败时快照与 active 状态都在，可 resume(id).rollback() 重试。
   */
  async rollback(): Promise<void> {
    if (this.record.status !== "active") {
      throw new WorkspaceError("TX_NOT_ACTIVE", `transaction ${this.record.id} is ${this.record.status}; only an active transaction can be rolled back`);
    }
    const payload = this.manager.payloadDirFor(this.record.id);
    if (!existsSync(payload)) {
      throw new WorkspaceError("TX_SNAPSHOT_MISSING", `snapshot payload for ${this.record.id} is missing; cannot rollback`);
    }
    // 1) 清空受保护路径（canonical 集合 —— 与 begin 的快照范围一致；
    //    事务期间新建的受保护路径若不在快照中，回滚后即被清除 = 恢复到快照时刻状态）
    for (const dir of PROTECTED_DIRS) {
      const target = join(this.manager.root, dir);
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    }
    for (const file of PROTECTED_FILES) {
      const target = join(this.manager.root, file);
      if (existsSync(target)) rmSync(target, { force: true });
    }
    // 2) payload 内容复制回 root（v1 非原子多文件恢复；快照仍在，可重试）
    for (const entry of readdirSync(payload, { withFileTypes: true })) {
      const from = join(payload, entry.name);
      const to = join(this.manager.root, entry.name);
      if (entry.isDirectory()) {
        cpSync(from, to, { recursive: true });
      } else {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    }
    this.record = { ...this.record, status: "rolled-back" };
    this.manager.writeRecord(this.record);
    this.manager.pruneFinished();
  }
}

// ---------------------------------------------------------------------------
// TransactionManager
// ---------------------------------------------------------------------------

export class TransactionManager {
  readonly root: string;
  readonly snapshotDir: string;

  constructor(root: string, snapshotDir: string) {
    this.root = root;
    this.snapshotDir = snapshotDir;
  }

  /**
   * 开启事务：快照当前受保护文件集 → snapshots/<id>/payload/ + tx.json。
   * 单活动事务约束：磁盘扫描（跨实例/跨进程可见）发现任一 active 事务即抛 TX_ALREADY_ACTIVE。
   */
  async begin(description?: string): Promise<Transaction> {
    if (description !== undefined && (typeof description !== "string" || description.length === 0)) {
      throw new WorkspaceError("TX_INVALID_DESCRIPTION", "transaction description must be a non-empty string when provided");
    }
    const active = this.findActiveRecord();
    if (active !== null) {
      throw new WorkspaceError("TX_ALREADY_ACTIVE", `transaction ${active.id} is still active; commit or rollback it before starting a new one`);
    }
    const id = `tx_${String(this.nextSeq()).padStart(8, "0")}_${randomBytes(3).toString("hex")}`;
    const payload = this.payloadDirFor(id);
    mkdirSync(payload, { recursive: true });
    // 快照受保护目录（fs.cp recursive）+ 清单文件
    for (const dir of PROTECTED_DIRS) {
      const source = join(this.root, dir);
      if (existsSync(source)) cpSync(source, join(payload, dir), { recursive: true });
    }
    for (const file of PROTECTED_FILES) {
      const source = join(this.root, file);
      if (existsSync(source)) copyFileSync(source, join(payload, file));
    }
    const record: TxRecord = {
      id,
      ...(description !== undefined ? { description } : {}),
      createdAt: new Date().toISOString(),
      status: "active",
      files: this.collectProtectedFiles(),
    };
    this.writeRecord(record);
    return new Transaction(this, record);
  }

  /** 全部事务信息，按创建时间倒序（新→旧）；损坏的 tx.json 记录跳过并 warn */
  async list(): Promise<TransactionInfo[]> {
    return this.readAllRecords()
      .sort((a, b) => seqOf(b.id) - seqOf(a.id))
      .map(toInfo);
  }

  /** 按 id 查询；id 非法或快照不存在 → null */
  async info(id: string): Promise<TransactionInfo | null> {
    const record = this.readRecord(id);
    return record === null ? null : toInfo(record);
  }

  /** 当前 active 事务信息（无则 null）—— Agent/Server 恢复流程入口 */
  async active(): Promise<TransactionInfo | null> {
    const record = this.findActiveRecord();
    return record === null ? null : toInfo(record);
  }

  /**
   * 恢复一个已存在的事务句柄（典型：进程重启后对遗留 active 事务执行 commit/rollback；
   * 或 server/MCP 场景下按 id 跨请求操作）。非 active 状态抛 TX_NOT_ACTIVE，不存在抛 TX_NOT_FOUND。
   */
  async resume(id: string): Promise<Transaction> {
    const record = this.readRecord(id);
    if (record === null) {
      throw new WorkspaceError("TX_NOT_FOUND", `no transaction snapshot found for id "${id}"`);
    }
    if (record.status !== "active") {
      throw new WorkspaceError("TX_NOT_ACTIVE", `transaction ${id} is ${record.status}; only an active transaction can be resumed`);
    }
    return new Transaction(this, record);
  }

  // -------------------------------------------------------------------------
  // internal（供 Transaction 回调）
  // -------------------------------------------------------------------------

  /** @internal */
  payloadDirFor(id: string): string {
    return join(this.snapshotDir, id, "payload");
  }

  /** @internal */
  writeRecord(record: TxRecord): void {
    const dir = join(this.snapshotDir, record.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tx.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  /**
   * 裁剪终态快照：committed/rolled-back 按序号倒序保留 MAX_FINISHED_SNAPSHOTS 个，超出删除最旧；
   * active 快照永不删除；无 tx.json 的残缺目录（中断的 begin）一并清理。
   * @internal
   */
  pruneFinished(): void {
    if (!existsSync(this.snapshotDir)) return;
    const entries = readdirSync(this.snapshotDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
      .map((e) => e.name);
    const records = new Map<string, TxRecord | null>();
    for (const name of entries) records.set(name, this.readRecord(name));
    // 残缺目录（无 tx.json）直接清理
    for (const [name, record] of records) {
      if (record === null) rmSync(join(this.snapshotDir, name), { recursive: true, force: true });
    }
    const finished = [...records.values()]
      .filter((r): r is TxRecord => r !== null && r.status !== "active")
      .sort((a, b) => seqOf(b.id) - seqOf(a.id));
    for (const record of finished.slice(MAX_FINISHED_SNAPSHOTS)) {
      rmSync(join(this.snapshotDir, record.id), { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private nextSeq(): number {
    if (!existsSync(this.snapshotDir)) return 1;
    let max = 0;
    for (const entry of readdirSync(this.snapshotDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = ID_PATTERN.exec(entry.name);
      if (match === null) continue;
      const seq = seqOf(entry.name);
      if (seq > max) max = seq;
    }
    return max + 1;
  }

  private findActiveRecord(): TxRecord | null {
    return this.readAllRecords().find((r) => r.status === "active") ?? null;
  }

  /** 收集受保护文件清单（相对 root，字典序稳定；.video 天然不在扫描范围） */
  private collectProtectedFiles(): string[] {
    const files: string[] = [];
    const walk = (absDir: string, relDir: string): void => {
      if (!existsSync(absDir)) return;
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) walk(join(absDir, entry.name), rel);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(rel);
      }
    };
    for (const dir of PROTECTED_DIRS) walk(join(this.root, dir), dir);
    for (const file of PROTECTED_FILES) {
      if (existsSync(join(this.root, file))) files.push(file);
    }
    return files.sort();
  }

  private readRecord(id: string): TxRecord | null {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    const file = join(this.snapshotDir, id, "tx.json");
    if (!existsSync(file)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const record = parsed as Partial<TxRecord>;
      if (typeof record.id !== "string" || record.id !== id) return null;
      if (typeof record.createdAt !== "string" || !Array.isArray(record.files)) return null;
      if (record.status !== "active" && record.status !== "committed" && record.status !== "rolled-back") return null;
      return {
        id: record.id,
        ...(typeof record.description === "string" ? { description: record.description } : {}),
        createdAt: record.createdAt,
        status: record.status,
        files: record.files.filter((f): f is string => typeof f === "string"),
      };
    } catch (err) {
      console.warn(`[videoos/workspace] transaction record ${id} is corrupted (${err instanceof Error ? err.message : String(err)}); skipped`);
      return null;
    }
  }

  private readAllRecords(): TxRecord[] {
    if (!existsSync(this.snapshotDir)) return [];
    const records: TxRecord[] = [];
    for (const entry of readdirSync(this.snapshotDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const record = this.readRecord(entry.name);
      if (record !== null) records.push(record);
    }
    return records;
  }
}
