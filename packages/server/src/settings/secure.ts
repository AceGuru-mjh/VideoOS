// API Key 安全存储（issue #46）：<dataDir>/settings.secure.json —— 与 settings.json 严格分离。
// - 原子写：同目录 tmp + rename（与 SettingsStore 同策略），mode 0o600（仅所有者可读写）
// - 损坏恢复：非法 JSON / 非对象 → 空库运行，原文件保留为 settings.secure.json.bad 备份 + console.warn
// - 契约：settings.json 与设置 API 响应永不包含 Key 材料；仅 /api/providers 的 keyMask（首 3 + 末 4）可见
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SECURE_FILE = "settings.secure.json";
const SECURE_BACKUP = "settings.secure.json.bad";

let tmpSeq = 0;

export class SecureStore {
  /** 数据目录（settings.secure.json 所在；与 SettingsStore 共用同一 dataDir） */
  readonly dataDir: string;
  private keys: Record<string, string>;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.keys = this.load();
  }

  get(id: string): string | undefined {
    const key = this.keys[id];
    return typeof key === "string" && key.length > 0 ? key : undefined;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  /** 存储 Key（空串视为删除）；值未变化时不重写文件 */
  set(id: string, key: string): void {
    if (key.length === 0) {
      this.delete(id);
      return;
    }
    if (this.keys[id] === key) return;
    this.keys[id] = key;
    this.persist();
  }

  delete(id: string): void {
    if (!(id in this.keys)) return;
    delete this.keys[id];
    this.persist();
  }

  /** 已存 Key 的 id 列表（诊断/测试用） */
  ids(): string[] {
    return Object.keys(this.keys);
  }

  // ---------------------------------------------------------------- internals

  private load(): Record<string, string> {
    const file = join(this.dataDir, SECURE_FILE);
    if (!existsSync(file)) return {};
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      this.backupCorrupt(file, err);
      return {};
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.backupCorrupt(file, err);
      return {};
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      this.backupCorrupt(file, new Error("root is not a JSON object"));
      return {};
    }
    const out: Record<string, string> = {};
    for (const [id, key] of Object.entries(data as Record<string, unknown>)) {
      if (typeof key === "string" && key.length > 0) out[id] = key;
    }
    return out;
  }

  /** 损坏文件处置：改名保留为 settings.secure.json.bad（旧备份先删，Windows rename 不覆盖），随后以空库运行 */
  private backupCorrupt(file: string, cause: unknown): void {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[videoos/server] secure key file corrupt (${reason}); starting empty (backup kept at ${SECURE_BACKUP})`);
    try {
      const backup = join(this.dataDir, SECURE_BACKUP);
      try {
        unlinkSync(backup);
      } catch {
        // 无旧备份
      }
      renameSync(file, backup);
    } catch (err) {
      console.warn(`[videoos/server] secure key backup failed (${err instanceof Error ? err.message : String(err)}); continuing empty`);
    }
  }

  /** 原子持久化：tmp + rename（mode 0o600）；目录不存在时自动创建 */
  private persist(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const file = join(this.dataDir, SECURE_FILE);
    const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
    writeFileSync(tmp, `${JSON.stringify(this.keys, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }
}
