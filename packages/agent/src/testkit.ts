// 测试/演示用最小 WorkspaceLike 实现（快照 = 受控目录整体拷贝）。
// ⚠️ 生产环境请使用 packages/workspace（M5）的 ProjectWorkspace —— 它满足本包 WorkspaceLike 结构契约
// （root / readMemory / writeMemory / transactions.begin / transactions.list）。
// 本实现仅供 @videoos/agent 的离线测试、MCP/CLI 冒烟与无 workspace 依赖的演示场景使用。
//
// 快照语义：begin 时把 src/ tests/ assets/ 与 video.project.json（存在时）拷贝到
// .video/snapshots/<txid>/；rollback = 删除受控路径后从快照恢复（begin 之后新增的文件随之消失）；
// commit = 保留快照（可 diff）。事务索引持久化在 .video/snapshots/index.json（list() 的数据源）。
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TransactionHandle, WorkspaceLike } from "./session";

const TRACKED_DIRS = ["src", "tests", "assets"] as const;
const TRACKED_FILES = ["video.project.json"] as const;

interface TxIndexEntry {
  id: string;
  description?: string;
  status: "active" | "committed" | "rolled-back";
  at: string;
}

class TestTransaction implements TransactionHandle {
  status: "active" | "committed" | "rolled-back" = "active";

  constructor(
    readonly id: string,
    readonly description: string | undefined,
    private readonly snapshotDir: string,
    private readonly onEnd: (tx: TestTransaction) => Promise<void>,
  ) {}

  private assertActive(): void {
    if (this.status !== "active") {
      throw new Error(`TRANSACTION_NOT_ACTIVE: transaction ${this.id} is already ${this.status}`);
    }
  }

  async commit(): Promise<void> {
    this.assertActive();
    this.status = "committed";
    await this.onEnd(this);
  }

  async rollback(): Promise<void> {
    this.assertActive();
    // 从快照恢复受控路径（begin 之后新增/修改的文件全部还原）
    const projectRoot = this.deriveRoot();
    for (const dir of TRACKED_DIRS) {
      const target = join(projectRoot, dir);
      await rm(target, { recursive: true, force: true });
      const snap = join(this.snapshotDir, dir);
      if (existsSync(snap)) await cp(snap, target, { recursive: true });
    }
    for (const file of TRACKED_FILES) {
      const target = join(projectRoot, file);
      const snap = join(this.snapshotDir, file);
      if (existsSync(snap)) {
        await cp(snap, target);
      } else {
        await rm(target, { force: true });
      }
    }
    this.status = "rolled-back";
    await this.onEnd(this);
  }

  /** snapshotDir = <root>/.video/snapshots/<id> → 回推项目根 */
  private deriveRoot(): string {
    const marker = join(".video", "snapshots");
    const idx = this.snapshotDir.lastIndexOf(marker);
    if (idx <= 0) throw new Error(`TRANSACTION_SNAPSHOT_INVALID: ${this.snapshotDir}`);
    return this.snapshotDir.slice(0, idx);
  }
}

/**
 * 创建最小工作区（root 目录需已存在或可创建）。
 * memory 布局：.video/memory/<name>.json（与 packages/workspace 约定一致）。
 */
export async function createTestWorkspace(root: string): Promise<WorkspaceLike> {
  const snapshotsDir = join(root, ".video", "snapshots");
  const memoryDir = join(root, ".video", "memory");
  await mkdir(snapshotsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  const indexPath = join(snapshotsDir, "index.json");
  const readIndex = async (): Promise<TxIndexEntry[]> => {
    try {
      return JSON.parse(await readFile(indexPath, "utf8")) as TxIndexEntry[];
    } catch {
      return [];
    }
  };
  const writeIndex = async (entries: TxIndexEntry[]): Promise<void> => {
    await writeFile(indexPath, JSON.stringify(entries, null, 2), "utf8");
  };

  let seq = 0;

  return {
    root,
    async readMemory(name: string): Promise<unknown | null> {
      try {
        return JSON.parse(await readFile(join(memoryDir, `${name}.json`), "utf8")) as unknown;
      } catch {
        return null;
      }
    },
    async writeMemory(name: string, data: unknown): Promise<void> {
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(memoryDir, `${name}.json`), JSON.stringify(data, null, 2), "utf8");
    },
    transactions: {
      async begin(description?: string): Promise<TransactionHandle> {
        const id = `tx-${Date.now().toString(36)}-${++seq}`;
        const snapshotDir = join(snapshotsDir, id);
        await mkdir(snapshotDir, { recursive: true });
        for (const dir of TRACKED_DIRS) {
          const src = join(root, dir);
          if (existsSync(src)) await cp(src, join(snapshotDir, dir), { recursive: true });
        }
        for (const file of TRACKED_FILES) {
          const src = join(root, file);
          if (existsSync(src)) await cp(src, join(snapshotDir, file));
        }
        const entries = await readIndex();
        entries.push({ id, ...(description !== undefined ? { description } : {}), status: "active", at: new Date().toISOString() });
        await writeIndex(entries);
        return new TestTransaction(id, description, snapshotDir, async (tx) => {
          const list = await readIndex();
          const entry = list.find((e) => e.id === tx.id);
          if (entry !== undefined) entry.status = tx.status;
          await writeIndex(list);
        });
      },
      async list(): Promise<unknown[]> {
        return readIndex();
      },
    },
  };
}

/** 列出目录下（一层）文件名（测试辅助） */
export async function listDirOrNull(path: string): Promise<string[] | null> {
  try {
    return (await readdir(path)).sort();
  } catch {
    return null;
  }
}
