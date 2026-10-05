// @videoos/mcp-archive —— tar/tar.gz 打包/列目录/解包工具服务器（stdio MCP）：手写 ustar tar + node:zlib。
// 安全要点：路径监狱 MCP_ARCHIVE_ROOTS；解包两遍扫描（先全量校验再落盘）防 tar-slip ——
// 拒绝 "../" 穿越、"/" 绝对路径、符号链接/设备条目；ustar 路径 ≤100 字节。
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { defineTool, err, jailFromEnv, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

const jail = await jailFromEnv("MCP_ARCHIVE_ROOTS");

const BLOCK = 512;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const LIST_PAGE = 500;

// ---------- ustar 写入 ----------

/** 八进制字段（length 含结尾 NUL，如 mode 8 字节 = 7 位数字 + \0） */
function writeOctal(buf: Buffer, value: number, offset: number, length: number): void {
  const digits = Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, "0");
  if (digits.length > length - 1) {
    throw new ToolError("E_TAR", `octal field overflow at ${offset} (value ${value})`);
  }
  buf.write(digits, offset, "utf8");
}

function tarHeader(entry: { name: string; size: number; mode: number; mtime: number; typeflag: "0" | "5" }): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(entry.name, 0, 100, "utf8");
  writeOctal(buf, entry.mode & 0o7777, 100, 8);
  writeOctal(buf, 0, 108, 8); // uid（portable：恒 0）
  writeOctal(buf, 0, 116, 8); // gid
  writeOctal(buf, entry.size, 124, 12);
  writeOctal(buf, entry.mtime, 136, 12);
  buf.write("        ", 148, "utf8"); // checksum 占位 = 8 空格
  buf.write(entry.typeflag, 156, "utf8");
  buf.write("ustar\0", 257, "utf8"); // magic
  buf.write("00", 263, "utf8"); // version
  writeOctal(buf, 0, 329, 8); // devmajor
  writeOctal(buf, 0, 337, 8); // devminor
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0"), 148, "utf8");
  buf[154] = 0;
  buf[155] = 0x20; // "NNNNNN\0 " 标准结尾
  return buf;
}

interface PackedEntry {
  name: string; // 相对路径（目录以 / 结尾）
  size: number;
  mode: number;
  mtime: number;
  typeflag: "0" | "5";
  content?: Buffer;
}

/** 递归收集目录条目（排序保证确定性；符号链接拒绝） */
async function collectEntries(dir: string): Promise<PackedEntry[]> {
  const entries: PackedEntry[] = [];
  let totalBytes = 0;
  async function walk(abs: string, prefix: string, depth: number): Promise<void> {
    if (depth > 16) throw new ToolError("E_LIMIT", `directory tree deeper than 16 levels: ${prefix || "."}`);
    const dirents = await readdir(abs, { withFileTypes: true });
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      if (entries.length >= MAX_ENTRIES) throw new ToolError("E_LIMIT", `too many entries (max ${MAX_ENTRIES})`);
      const rel = prefix === "" ? d.name : `${prefix}/${d.name}`;
      const child = join(abs, d.name);
      const st = await lstat(child);
      if (Buffer.byteLength(rel, "utf8") + (st.isDirectory() ? 1 : 0) > 100) {
        throw new ToolError("E_PATH", `path longer than 100 bytes (ustar limit): ${rel}`);
      }
      if (st.isSymbolicLink()) {
        throw new ToolError("E_SYMLINK", `symlinks are not packed (security): ${rel}`);
      }
      const mtime = Math.floor(st.mtimeMs / 1000);
      if (st.isDirectory()) {
        entries.push({ name: `${rel}/`, size: 0, mode: st.mode, mtime, typeflag: "5" });
        await walk(child, rel, depth + 1);
      } else if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) throw new ToolError("E_LIMIT", `file larger than 64MB: ${rel}`);
        totalBytes += st.size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new ToolError("E_LIMIT", "total payload exceeds 256MB");
        const content = await readFile(child);
        entries.push({ name: rel, size: content.length, mode: st.mode, mtime, typeflag: "0", content });
      } else {
        throw new ToolError("E_ENTRY", `unsupported file type (socket/fifo/device): ${rel}`);
      }
    }
  }
  await walk(dir, "", 0);
  return entries;
}

// ---------- ustar 解析 ----------

interface TarEntry {
  path: string;
  size: number;
  mode: number;
  mtime: number;
  typeflag: string;
  data?: Buffer;
}

function cstr(block: Buffer, offset: number, length: number): string {
  const end = block.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return block.toString("utf8", offset, stop);
}

function parseOctal(block: Buffer, offset: number, length: number): number | null {
  const s = block.toString("utf8", offset, offset + length).replace(/\0/g, "").trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) return null;
  return Number.parseInt(s, 8);
}

function isZeroBlock(block: Buffer): boolean {
  for (const b of block) {
    if (b !== 0) return false;
  }
  return true;
}

/** 逐块解析 tar 字节流：坏 magic / checksum / 截断 → E_TAR */
function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let off = 0;
  let sawEnd = false;
  while (off + BLOCK <= buf.length) {
    const block = buf.subarray(off, off + BLOCK);
    if (isZeroBlock(block)) {
      sawEnd = true;
      break;
    }
    if (block.toString("latin1", 257, 262) !== "ustar") {
      throw new ToolError("E_TAR", `bad tar magic at offset ${off} (not a ustar archive)`);
    }
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!;
    const stored = parseOctal(block, 148, 8);
    if (stored === null || stored !== sum) {
      throw new ToolError("E_TAR", `header checksum mismatch at offset ${off} (stored ${stored}, computed ${sum})`);
    }
    const name = cstr(block, 0, 100);
    const prefix = cstr(block, 345, 155);
    const mode = parseOctal(block, 100, 8);
    const size = parseOctal(block, 124, 12);
    const mtime = parseOctal(block, 136, 12);
    if (name === "" || size === null || mode === null || mtime === null) {
      throw new ToolError("E_TAR", `malformed header fields at offset ${off}`);
    }
    const typeflag = String.fromCharCode(block[156] ?? 0);
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) {
      throw new ToolError("E_TAR", `truncated entry at offset ${off} (need ${size} bytes, have ${buf.length - dataStart})`);
    }
    entries.push({
      path: prefix !== "" ? `${prefix}/${name}` : name,
      size,
      mode,
      mtime,
      typeflag,
      ...(typeflag === "5" ? {} : { data: buf.subarray(dataStart, dataEnd) }),
    });
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (entries.length === 0) throw new ToolError("E_TAR", "no tar entries found (not a tar archive?)");
  if (!sawEnd && buf.length - off > 0) {
    throw new ToolError("E_TAR", `truncated archive: ${buf.length - off} trailing bytes without end-of-archive marker`);
  }
  return entries;
}

/** 读取归档文件（.tar / .tar.gz 按魔数识别，不看扩展名） */
async function readArchive(path: string): Promise<{ format: "tar" | "tar.gz"; entries: TarEntry[] }> {
  const abs = await jail.resolve(path);
  let raw: Buffer;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return Promise.reject(new ToolError("E_NOT_FOUND", `${path} is not a regular file`));
    if (st.size > MAX_ARCHIVE_BYTES) {
      return Promise.reject(new ToolError("E_LIMIT", `archive larger than ${MAX_ARCHIVE_BYTES} bytes`));
    }
    raw = await readFile(abs);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? "";
    throw new ToolError("E_NOT_FOUND", `cannot read ${path}${code !== "" ? ` (${code})` : ""}`);
  }
  let tarBuf = raw;
  let format: "tar" | "tar.gz" = "tar";
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      tarBuf = gunzipSync(raw);
    } catch (error) {
      throw new ToolError("E_TAR", `gunzip failed (corrupt gzip): ${error instanceof Error ? error.message : String(error)}`);
    }
    format = "tar.gz";
  }
  return { format, entries: parseTar(tarBuf) };
}

/** tar 条目路径安全化：拒绝绝对路径与 ".." 穿越（tar-slip），返回相对段列表 */
function safeSegments(entryPath: string): string[] {
  if (entryPath.startsWith("/")) {
    throw new ToolError("E_JAIL", `absolute path in tar entry "${entryPath}" — refusing (tar-slip guard)`);
  }
  const segs = entryPath.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) {
    throw new ToolError("E_JAIL", `".." path traversal in tar entry "${entryPath}" — refusing (tar-slip guard)`);
  }
  return segs;
}

const tools = [
  defineTool(
    "archive.pack",
    "Pack a directory into a .tar.gz (hand-written ustar + gzip); paths are relative to the packed dir.",
    z.object({
      dir: z.string().describe("directory to pack (inside MCP_ARCHIVE_ROOTS)"),
      output: z.string().describe("output .tar.gz path (inside MCP_ARCHIVE_ROOTS)"),
    }),
    async ({ dir, output }) => {
      const dirAbs = await jail.resolve(dir);
      let st;
      try {
        st = await stat(dirAbs);
      } catch {
        return err(`E_NOT_FOUND: directory does not exist: ${dir}`);
      }
      if (!st.isDirectory()) return err(`E_NOT_DIR: ${dir} is not a directory`);

      const entries = await collectEntries(dirAbs);
      const chunks: Buffer[] = [];
      for (const e of entries) {
        chunks.push(tarHeader(e));
        if (e.typeflag === "0" && e.content !== undefined && e.size > 0) {
          chunks.push(e.content);
          const pad = (BLOCK - (e.size % BLOCK)) % BLOCK;
          if (pad > 0) chunks.push(Buffer.alloc(pad));
        }
      }
      chunks.push(Buffer.alloc(BLOCK * 2)); // end of archive
      const gz = gzipSync(Buffer.concat(chunks));

      const outAbs = await jail.resolve(output);
      await mkdir(dirname(outAbs), { recursive: true });
      await writeFile(outAbs, gz);
      return ok({
        output: outAbs,
        files: entries.filter((e) => e.typeflag === "0").length,
        entries: entries.length,
        bytes: gz.length,
      });
    },
  ),
  defineTool(
    "archive.list",
    "List entries of a .tar or .tar.gz (format detected by gzip magic bytes); first 500 entries shown.",
    z.object({ path: z.string().describe("archive path (inside MCP_ARCHIVE_ROOTS)") }),
    async ({ path }) => {
      const { format, entries } = await readArchive(path);
      const shown = entries.slice(0, LIST_PAGE).map((e) => ({
        path: e.path,
        size: e.size,
        mode: (e.mode & 0o7777).toString(8),
        mtime: new Date(e.mtime * 1000).toISOString(),
        type: e.typeflag === "5" ? "dir" : "file",
      }));
      return ok({
        format,
        count: entries.length,
        entries: shown,
        truncated: entries.length > LIST_PAGE,
      });
    },
  ),
  defineTool(
    "archive.extract",
    "Extract a .tar/.tar.gz into destDir; two-pass validation rejects tar-slip (../, absolute paths) and symlink/device entries before writing anything.",
    z.object({
      path: z.string().describe("archive path (inside MCP_ARCHIVE_ROOTS)"),
      destDir: z.string().describe("destination directory (inside MCP_ARCHIVE_ROOTS, created if missing)"),
    }),
    async ({ path, destDir }) => {
      const { entries } = await readArchive(path);
      const destAbs = await jail.resolve(destDir);

      // pass 1：全量校验（一个坏条目也不落盘）
      const validated = entries.map((entry) => {
        const segs = safeSegments(entry.path);
        const isDir = entry.typeflag === "5";
        if (!isDir && entry.typeflag !== "0" && entry.typeflag !== "\0" && entry.typeflag !== "7") {
          throw new ToolError(
            "E_JAIL",
            `tar entry "${entry.path}" has unsupported typeflag ${JSON.stringify(entry.typeflag)} (symlink/device) — refusing`,
          );
        }
        return { entry, segs, isDir };
      });

      // pass 2：落盘
      await mkdir(destAbs, { recursive: true });
      let files = 0;
      let bytes = 0;
      for (const { entry, segs, isDir } of validated) {
        const target = segs.length === 0 ? destAbs : join(destAbs, ...segs);
        // 防御性包含检查（safeSegments 已保证，双保险）
        if (target !== destAbs && !target.startsWith(destAbs + "/")) {
          throw new ToolError("E_JAIL", `resolved entry path escapes destination: ${entry.path}`);
        }
        if (isDir) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, entry.data ?? Buffer.alloc(0));
          files += 1;
          bytes += entry.size;
        }
      }
      return ok({ destDir: destAbs, files, entries: validated.length, bytes });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-archive", serverVersion: "0.1.0" });
