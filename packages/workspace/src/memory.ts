// Agent Memory 存储（SPEC §6.1 Memory / §9 .video/memory/）。
// name 白名单 /^[a-z0-9-]+$/：杜绝路径穿越（".."、"/"、"\"、"." 全部不匹配）。
// 写入原子性：同目录 tmp 文件 + rename（与 @videoos/cache ContentStore 同策略）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceError } from "./errors";

const NAME_PATTERN = /^[a-z0-9-]+$/;
const JSON_EXT = ".json";

let tmpSeq = 0;

export class MemoryStore {
  /** memory 根目录（通常为 <project>/.video/memory） */
  readonly memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  /** 读取 .video/memory/<name>.json；不存在 → null；非法 JSON → null + console.warn（损坏不致命，Agent 可重建） */
  async read<T = unknown>(name: string): Promise<T | null> {
    this.assertValidName(name);
    const file = this.fileFor(name);
    if (!existsSync(file)) return null;
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      console.warn(`[videoos/workspace] memory "${name}" is unreadable (${err instanceof Error ? err.message : String(err)}); returning null`);
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[videoos/workspace] memory "${name}" contains invalid JSON (${err instanceof Error ? err.message : String(err)}); returning null`);
      return null;
    }
  }

  /** 原子写入（tmp + rename）；目录不存在时自动创建 */
  async write(name: string, data: unknown): Promise<void> {
    this.assertValidName(name);
    mkdirSync(this.memoryDir, { recursive: true });
    const file = this.fileFor(name);
    const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, file);
  }

  /** 列出全部 memory 名（去扩展名、字典序）；目录不存在 → []；.tmp 中间文件被排除 */
  async list(): Promise<string[]> {
    if (!existsSync(this.memoryDir)) return [];
    return readdirSync(this.memoryDir)
      .filter((f) => f.endsWith(JSON_EXT))
      .map((f) => f.slice(0, -JSON_EXT.length))
      .sort();
  }

  /** 删除指定 memory；不存在时静默（幂等，便于 Agent 清理流程） */
  async remove(name: string): Promise<void> {
    this.assertValidName(name);
    const file = this.fileFor(name);
    if (existsSync(file)) unlinkSync(file);
  }

  private assertValidName(name: string): void {
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      throw new WorkspaceError(
        "WORKSPACE_INVALID_MEMORY_NAME",
        `memory name must match ${NAME_PATTERN.toString()} (got ${JSON.stringify(name)})`,
      );
    }
  }

  private fileFor(name: string): string {
    return join(this.memoryDir, `${name}${JSON_EXT}`);
  }
}
