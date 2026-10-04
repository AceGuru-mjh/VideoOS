// 内容寻址哈希基础（SPEC 附录 B）：SHA-256 + 稳定 JSON 序列化
// 确定性契约：virHash(同内容不同键序) 必须一致 —— 缓存命中的前提
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Vir } from "@videoos/vir";

/** SHA-256 十六进制摘要（64 hex 小写）；字符串按 UTF-8 编码 */
export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * 稳定（规范化）JSON 序列化：
 * - 对象键按字典序排序（与插入序无关）
 * - 数组保持原顺序
 * - 数字沿用 JSON 序列化（整数直出、浮点保留原值；NaN/Infinity 退化为 "null"，与 JSON.stringify 一致）
 * - undefined/function/symbol 输出 "null"（与 JSON.stringify 的成员丢弃语义不同：此处统一占位，
 *   保证「键存在但值为 undefined」与「值为 null」哈希一致，避免歧义）
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort(); // 稳定排序：与属性插入序无关
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      return "null";
  }
}

/** VIR 内容哈希 = SHA256(canonicalJson(vir))（附录 B） */
export function virHash(vir: Vir): string {
  return sha256Hex(canonicalJson(vir));
}

/** 资产文件哈希 = SHA256(文件字节)（附录 B；异步读取，大文件不阻塞） */
export async function assetHash(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256Hex(bytes);
}
