// 通用内容寻址文件存储：root/<namespace>/<aa>/<bb>/<key>（二级分片防单目录爆炸）
// 写入原子性：先写同目录临时文件再 rename —— 并发写同 key 时最终内容必为某次完整写入
import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 单命名空间统计 */
export interface NamespaceStats {
  entries: number;
  bytes: number;
}

/** 缓存统计（cache.stats VAP 工具 / `videoos cache stats` 的数据源） */
export interface CacheStats {
  entries: number;
  bytes: number;
  namespaces: Record<string, NamespaceStats>;
}

/** 缓存错误（code 前缀 CACHE_*；message 以 `${code}: ` 开头便于正则断言） */
export class CacheError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CacheError";
    this.code = code;
  }
}

/** 命名空间 / key 必须是路径安全片段（禁止分隔符与目录穿越） */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateSegment(kind: string, value: string): void {
  if (typeof value !== "string" || value.length === 0 || !SEGMENT_RE.test(value)) {
    throw new CacheError("CACHE_INVALID_NAME", `${kind} must match ${SEGMENT_RE.toString()} (path-safe, no separators), got: ${JSON.stringify(value)}`);
  }
}

/** 递归累计目录内文件数与字节数（跳过未完成的 .tmp- 中间文件） */
async function accumulate(dir: string, out: NamespaceStats): Promise<void> {
  let items: Dirent[];
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 目录消失（并发 clear）视为空
  }
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      await accumulate(full, out);
    } else if (item.isFile() && !item.name.includes(".tmp-")) {
      out.entries++;
      out.bytes += (await stat(full)).size;
    }
  }
}

/**
 * 内容寻址文件存储。
 * 典型 root = `<project>/.video/cache`；帧缓存用 namespace "frames"（SPEC §9）。
 */
export class ContentStore {
  readonly root: string;
  /** 临时文件序号（进程内唯一即可；rename 保证落位原子性） */
  private seq = 0;

  constructor(root: string) {
    if (typeof root !== "string" || root.length === 0) {
      throw new CacheError("CACHE_INVALID_ROOT", `root must be a non-empty string, got: ${JSON.stringify(root)}`);
    }
    this.root = resolve(root);
  }

  /** 存储路径：root/namespace/aa/bb/<key>（aa/bb 取 key 前两段；key 不足 4 字符不分片） */
  path(namespace: string, key: string): string {
    validateSegment("namespace", namespace);
    validateSegment("key", key);
    if (key.length >= 4) {
      return join(this.root, namespace, key.slice(0, 2), key.slice(2, 4), key);
    }
    return join(this.root, namespace, key);
  }

  /** 写入并返回落位路径；同 key 重复写 = 覆盖（原子） */
  async put(namespace: string, key: string, data: Buffer): Promise<string> {
    if (!Buffer.isBuffer(data)) {
      throw new CacheError("CACHE_INVALID_DATA", `data must be a Buffer, got: ${typeof data}`);
    }
    const target = this.path(namespace, key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${this.seq++}`;
    await writeFile(tmp, data);
    await rename(tmp, target);
    return target;
  }

  /** 读取；不存在返回 null */
  async get(namespace: string, key: string): Promise<Buffer | null> {
    const target = this.path(namespace, key);
    if (!existsSync(target)) return null;
    return readFile(target);
  }

  async has(namespace: string, key: string): Promise<boolean> {
    return existsSync(this.path(namespace, key));
  }

  /** 全量统计（按命名空间细分）；root 不存在时返回空统计 */
  async stats(): Promise<CacheStats> {
    const namespaces: Record<string, NamespaceStats> = {};
    let entries = 0;
    let bytes = 0;
    if (!existsSync(this.root)) return { entries, bytes, namespaces };
    for (const ns of await readdir(this.root, { withFileTypes: true })) {
      if (!ns.isDirectory()) continue;
      const nsStats: NamespaceStats = { entries: 0, bytes: 0 };
      await accumulate(join(this.root, ns.name), nsStats);
      namespaces[ns.name] = nsStats;
      entries += nsStats.entries;
      bytes += nsStats.bytes;
    }
    return { entries, bytes, namespaces };
  }

  /** 清空：给定 namespace 只清该命名空间，否则清空整个 root */
  async clear(namespace?: string): Promise<void> {
    if (namespace === undefined) {
      await rm(this.root, { recursive: true, force: true });
      return;
    }
    validateSegment("namespace", namespace);
    await rm(join(this.root, namespace), { recursive: true, force: true });
  }
}
