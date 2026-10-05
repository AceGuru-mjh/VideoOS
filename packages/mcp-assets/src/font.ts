// TTF/OTF 名称表解析（SPEC §3.5 mcp-assets：assets.info 字体详情）。
// sfnt 容器（0x00010000 / "OTTO"）→ name 表 → platformID 3 (UTF-16BE) 优先、platformID 1 (Latin-1) 兜底；
// woff/wof2 只返回 format（不做名称提取）；非字体二进制返回 null。
// 所有读取均带边界检查（畸形文件只丢名称，不越界、不抛错）。

export interface FontNameInfo {
  family?: string;
  fullName?: string;
  subfamily?: string;
  format: string;
}

/** uint16 大端读取（调用方保证边界） */
function u16be(buf: Uint8Array, off: number): number {
  return (buf[off] << 8) | buf[off + 1];
}

/** uint32 大端读取（调用方保证边界） */
function u32be(buf: Uint8Array, off: number): number {
  return (((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0);
}

/** 4 字节标签 → 可打印字符（仅用于比较/展示） */
function isTag(buf: Uint8Array, off: number, b0: number, b1: number, b2: number, b3: number): boolean {
  return buf[off] === b0 && buf[off + 1] === b1 && buf[off + 2] === b2 && buf[off + 3] === b3;
}

/** 手工 UTF-16BE 解码（不依赖 TextDecoder("utf-16be") 的运行时可用性） */
function decodeUtf16Be(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return out;
}

/** Latin-1（单字节）解码 */
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * 解析字体名称：成功返回 { family?, fullName?, subfamily?, format }；
 * woff/wof2 → { format: "woff" }；其它二进制（非 sfnt）→ null。
 */
export function parseFontName(buf: Uint8Array): FontNameInfo | null {
  if (buf.length < 12) return null;
  // 容器标签（offset 0，4 字节）：wOFF / wOF2 → 只报格式
  if (isTag(buf, 0, 0x77, 0x4f, 0x46, 0x46) || isTag(buf, 0, 0x77, 0x4f, 0x46, 0x32)) {
    return { format: "woff" };
  }
  const isTtf = isTag(buf, 0, 0x00, 0x01, 0x00, 0x00); // 0x00010000（TrueType）
  const isOtf = isTag(buf, 0, 0x4f, 0x54, 0x54, 0x4f); // "OTTO"（CFF 轮廓）
  if (!isTtf && !isOtf) return null;
  const info: FontNameInfo = { format: isTtf ? "ttf" : "otf" };

  // 表目录：numTables @4；表记录从 12 起，每条 16 字节：tag(4) checksum(4) offset(4) length(4)
  const numTables = u16be(buf, 4);
  let nameTableOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) break;
    if (isTag(buf, rec, 0x6e, 0x61, 0x6d, 0x65)) {
      // "name"
      nameTableOffset = u32be(buf, rec + 8);
      break;
    }
  }
  if (nameTableOffset < 0 || nameTableOffset + 6 > buf.length) return info;

  // name 表头：format @0、count @2、stringOffset @4（均 uint16 大端）；记录 12 字节/条
  const count = u16be(buf, nameTableOffset + 2);
  const stringOffset = u16be(buf, nameTableOffset + 4);
  const byNameId = new Map<number, Array<{ platformID: number; off: number; len: number }>>();
  for (let i = 0; i < count; i++) {
    const rec = nameTableOffset + 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = u16be(buf, rec);
    const nameID = u16be(buf, rec + 6);
    if (nameID !== 1 && nameID !== 2 && nameID !== 4) continue;
    const list = byNameId.get(nameID) ?? [];
    list.push({ platformID, off: u16be(buf, rec + 10), len: u16be(buf, rec + 8) });
    byNameId.set(nameID, list);
  }

  // nameID：1=family、4=fullName、2=subfamily；platformID 3（UTF-16BE）优先，1（Latin-1）兜底
  for (const [nameID, field] of [
    [1, "family"],
    [4, "fullName"],
    [2, "subfamily"],
  ] as const) {
    const records = byNameId.get(nameID);
    if (records === undefined) continue;
    const rec = records.find((r) => r.platformID === 3) ?? records.find((r) => r.platformID === 1);
    if (rec === undefined) continue;
    const start = nameTableOffset + stringOffset + rec.off;
    const end = start + rec.len;
    if (start < 0 || end > buf.length) continue;
    const bytes = buf.subarray(start, end);
    const value = (rec.platformID === 3 ? decodeUtf16Be(bytes) : decodeLatin1(bytes)).trim();
    if (value.length > 0) info[field] = value;
  }
  return info;
}
