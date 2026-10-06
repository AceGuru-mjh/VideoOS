// sha256 校验（node:crypto）：产物完整性是升级安全底线 —— 缺校验和资产一律拒绝安装。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** 流式计算文件 sha256（hex 小写）；大文件不整读内存 */
export function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    // @types/node 22 起 data 回调参数为 string | Buffer（编码可变），统一按 Buffer 处理
    stream.on("data", (chunk: string | Buffer) => hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * 解析 `sha256sum *` 格式文本：每行 "<hash>  <filename>"（hash 与文件名之间 ≥1 空格，
 * 文件名前可能有二进制标记 `*`）。空行与 # 注释忽略；不合规行跳过（不抛错 ——
 * 多余的行不该让整个校验瘫痪）。返回 文件名 → hash（hex 小写）。
 */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const m = /^([0-9a-fA-F]{64})[ \t]+\*?(\S.*)$/.exec(trimmed);
    if (m === null) continue;
    const name = (m[2] ?? "").trim();
    if (name.length === 0) continue;
    map.set(name, (m[1] ?? "").toLowerCase());
  }
  return map;
}

/** 校验文件 sha256 与期望值（hex，大小写不敏感；`<hash>  <name>` 复合格式也接受） */
export async function verifyAsset(path: string, expectedHex: string): Promise<boolean> {
  const expected = expectedHex.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = await sha256File(path);
  return actual === expected;
}
