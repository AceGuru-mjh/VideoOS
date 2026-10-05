// @videoos/mcp-assets —— 素材库索引/检索工具服务器（stdio MCP）：扫描监狱内图片/音频/视频/字体，
// 关键设计点：索引缓存 = 模块级 Map + <root>/.assets-index.json（模块级缓存属 SPEC 允许的有状态例外）；
// 音视频时长用 ffprobe（缺二进制 → 只报 size）、图片宽高用 @napi-rs/canvas loadImage（失败省略）、
// 字体家族名手写 sfnt name 表解析（读表目录→定位 name 表→取 nameID=1，仅按需读取文件片段，不整读大字体）。
import { defineTool, runStdioServer, ok, err, jailFromEnv, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";
import { spawn, spawnSync } from "node:child_process";
import { readdir, stat, open, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { loadImage } from "@napi-rs/canvas";

const jail = await jailFromEnv("MCP_ASSETS_ROOTS");

// ---------------------------------------------------------------------------
// 类型映射与扫描
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const FONT_EXTS = new Set(["ttf", "otf", "woff", "woff2"]);
const ALL_EXTS = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, ...FONT_EXTS]);

type AssetType = "image" | "audio" | "video" | "font";

function assetTypeOf(filePath: string): AssetType | undefined {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (FONT_EXTS.has(ext)) return "font";
  return undefined;
}

interface AssetEntry {
  path: string; // 相对被索引 root 的 posix 路径
  type: AssetType;
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

interface IndexFile {
  version: 1;
  root: string;
  indexedAt: number;
  assets: AssetEntry[];
}

/** 目录递归深度上限（工程契约：≤5）与索引规模上限 */
const MAX_DEPTH = 5;
const MAX_ASSETS = 2_000;
const MAX_PROBE_FILES = 200;

async function scanFiles(rootDir: string, dir: string, depth: number, out: string[]): Promise<void> {
  if (out.length >= MAX_ASSETS || depth > MAX_DEPTH) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_ASSETS) return;
    if (entry.name.startsWith(".")) continue; // 跳过隐藏文件/目录（含 .assets-index.json）
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanFiles(rootDir, full, depth + 1, out);
    } else if (entry.isFile()) {
      if (assetTypeOf(entry.name) !== undefined) out.push(full);
    }
  }
}

// ---------------------------------------------------------------------------
// ffprobe 时长（二进制缺失/失败 → undefined，只报 size）
// ---------------------------------------------------------------------------

const binaryCache = new Map<string, boolean>();
function hasBinary(bin: string): boolean {
  const cached = binaryCache.get(bin);
  if (cached !== undefined) return cached;
  let okBinary = false;
  try {
    okBinary = spawnSync(bin, ["-version"], { timeout: 5_000 }).error === undefined;
  } catch {
    okBinary = false;
  }
  binaryCache.set(bin, okBinary);
  return okBinary;
}

/** 单文件 ffprobe 时长（秒）；单进程调用，8s 超时 */
function probeDuration(absPath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", absPath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 128 * 1024) stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
        const n = Number(parsed.format?.duration);
        resolve(Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** 图片宽高（loadImage；失败/缺图 → undefined） */
async function imageDimensions(absPath: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const image = await loadImage(absPath);
    if (image.width > 0 && image.height > 0) return { width: image.width, height: image.height };
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// sfnt 字体 name 表解析（ttf/otf/ttc；woff/woff2 压缩容器不解析 → 省略 fontFamily）
// ---------------------------------------------------------------------------

/** 按 name 表记录优先级解码（Win Unicode > 平台0 Unicode > Mac Roman） */
function decodeNameRecord(buf: Buffer, platformID: number, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  if (platformID === 0 || platformID === 3) {
    const even = slice.length - (slice.length % 2); // swap16 要求偶数长度
    const swapped = Buffer.from(slice.subarray(0, even)); // UTF-16BE → swap16 后按 utf16le 解
    swapped.swap16();
    return swapped.toString("utf16le").replace(/\0+$/, "");
  }
  return slice.toString("latin1").replace(/\0+$/, "");
}

/** 读 name 表 → nameID=1（family）；格式损坏返回 undefined */
function readNameTable(buf: Buffer): string | undefined {
  if (buf.length < 6) return undefined;
  const count = buf.readUInt16BE(2);
  const stringOffset = buf.readUInt16BE(4);
  let best: { priority: number; value: string } | undefined;
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const offset = buf.readUInt16BE(rec + 10);
    if (nameID !== 1) continue;
    const start = stringOffset + offset;
    if (start + length > buf.length) continue;
    const priority = platformID === 3 ? (encodingID === 1 ? 3 : 2) : platformID === 0 ? 2 : 1;
    if (best !== undefined && priority <= best.priority) continue;
    const value = decodeNameRecord(buf, platformID, start, length).trim();
    if (value.length > 0) best = { priority, value };
  }
  return best?.value;
}

/** 从字体文件解析 family（只读头部表目录 + name 表片段，最大 64KB name 数据） */
async function readFontFamily(absPath: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(absPath, "r");
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    if (bytesRead < 12) return undefined;
    const tag = head.readUInt32BE(0);
    let base = 0;
    if (tag === 0x7474_6366) {
      // 'ttcf' 集合字体 → 取第一个字体偏移
      const ttc = Buffer.alloc(8);
      await handle.read(ttc, 0, 8, 8); // numFonts(8) + firstOffset(12)
      base = ttc.readUInt32BE(4);
    } else if (tag !== 0x0001_0000 && tag !== 0x4f54_544f && tag !== 0x7472_7565) {
      return undefined; // woff/woff2/未知 → 不解析
    }
    const dirHeader = Buffer.alloc(12);
    const dirRead = await handle.read(dirHeader, 0, 12, base);
    if (dirRead.bytesRead < 12) return undefined;
    const numTables = dirHeader.readUInt16BE(4);
    const records = Buffer.alloc(numTables * 16);
    const recRead = await handle.read(records, 0, records.length, base + 12);
    if (recRead.bytesRead < records.length) return undefined;
    for (let i = 0; i < numTables; i++) {
      const rec = i * 16;
      if (records.toString("latin1", rec, rec + 4) !== "name") continue;
      const tableOffset = records.readUInt32BE(rec + 8);
      const tableLength = Math.min(records.readUInt32BE(rec + 12), 64 * 1024);
      const nameBuf = Buffer.alloc(tableLength);
      const nameRead = await handle.read(nameBuf, 0, tableLength, tableOffset);
      if (nameRead.bytesRead < 6) return undefined;
      return readNameTable(nameBuf.subarray(0, nameRead.bytesRead));
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 索引缓存（模块级 Map + 磁盘 .assets-index.json）
// ---------------------------------------------------------------------------

const INDEX_FILENAME = ".assets-index.json";
const indexCache = new Map<string, IndexFile>();

/** 磁盘索引载入（损坏 → null） */
async function loadDiskIndex(absRoot: string): Promise<IndexFile | null> {
  try {
    const raw = await readFile(join(absRoot, INDEX_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as IndexFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.assets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 全量扫描 + 探测构建索引 */
async function buildIndex(absRoot: string): Promise<IndexFile> {
  const rootStat = await stat(absRoot).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    throw new ToolError("E_NOT_FOUND", `root ${JSON.stringify(absRoot)} is not an existing directory`);
  }
  const files: string[] = [];
  await scanFiles(absRoot, absRoot, 0, files);
  files.sort();
  const canProbe = hasBinary("ffprobe"); // 二进制缺失 → 音视频只报 size（不逐文件白跑 spawn）
  const assets: AssetEntry[] = [];
  let probed = 0;
  for (const file of files) {
    const size = (await stat(file)).size;
    const type = assetTypeOf(file)!;
    const entry: AssetEntry = { path: relative(absRoot, file).split("\\").join("/"), type, sizeBytes: size };
    if ((type === "audio" || type === "video") && canProbe && probed < MAX_PROBE_FILES) {
      probed++;
      entry.durationSec = await probeDuration(file);
    } else if (type === "image") {
      const dims = await imageDimensions(file);
      if (dims !== undefined) {
        entry.width = dims.width;
        entry.height = dims.height;
      }
    }
    assets.push(entry);
  }
  const index: IndexFile = { version: 1, root: absRoot, indexedAt: Date.now(), assets };
  indexCache.set(absRoot, index);
  try {
    await writeFile(join(absRoot, INDEX_FILENAME), JSON.stringify(index, null, 2), "utf8");
  } catch {
    // 索引落盘失败不影响内存结果
  }
  return index;
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

const MAX_INDEX_RETURN = 500;
const MAX_SEARCH_RESULTS = 50;

const tools = [
  defineTool(
    "assets.index",
    "Scan a directory (inside jail roots) for images/audio/video/fonts and build an asset index (size, duration, image dimensions); cached in memory and <root>/.assets-index.json.",
    z.object({
      root: z.string().describe("directory to index, relative to jail root or absolute inside roots"),
      refresh: z.boolean().describe("true = force a full rescan, ignoring cached index").default(false),
    }),
    async ({ root, refresh }) => {
      const absRoot = await jail.resolve(root);
      if (!refresh) {
        const memory = indexCache.get(absRoot);
        if (memory !== undefined) {
          return ok({
            assets: memory.assets.slice(0, MAX_INDEX_RETURN),
            total: memory.assets.length,
            truncated: memory.assets.length > MAX_INDEX_RETURN,
            cached: true,
          });
        }
        const disk = await loadDiskIndex(absRoot);
        if (disk !== null) {
          indexCache.set(absRoot, disk);
          return ok({
            assets: disk.assets.slice(0, MAX_INDEX_RETURN),
            total: disk.assets.length,
            truncated: disk.assets.length > MAX_INDEX_RETURN,
            cached: true,
          });
        }
      }
      const index = await buildIndex(absRoot);
      return ok({
        assets: index.assets.slice(0, MAX_INDEX_RETURN),
        total: index.assets.length,
        truncated: index.assets.length > MAX_INDEX_RETURN,
        cached: false,
      });
    },
  ),
  defineTool(
    "assets.search",
    "Search indexed assets by case-insensitive name substring with an optional type filter (image/audio/video/font); returns up to 50 hits across all cached indexes.",
    z.object({
      query: z.string().describe("case-insensitive substring of the asset file name/path"),
      type: z.enum(["image", "audio", "video", "font"]).describe("filter by asset type").optional(),
    }),
    async ({ query, type }) => {
      // 无内存索引时尝试载入各监狱根的 .assets-index.json
      for (const jailRoot of jail.roots) {
        if (!indexCache.has(jailRoot)) {
          const disk = await loadDiskIndex(jailRoot);
          if (disk !== null) indexCache.set(jailRoot, disk);
        }
      }
      if (indexCache.size === 0) {
        return err("E_INDEX: no assets index available; call assets.index on a root first");
      }
      const needle = query.toLowerCase();
      const hits: Array<AssetEntry & { root: string }> = [];
      let total = 0;
      for (const index of indexCache.values()) {
        for (const asset of index.assets) {
          if (!asset.path.toLowerCase().includes(needle)) continue;
          if (type !== undefined && asset.type !== type) continue;
          total++;
          if (hits.length < MAX_SEARCH_RESULTS) hits.push({ ...asset, root: index.root });
        }
      }
      return ok({ assets: hits, total, truncated: total > hits.length, indexedRoots: [...indexCache.keys()].length });
    },
  ),
  defineTool(
    "assets.info",
    "Inspect a single asset file: type, size, image dimensions, media duration, font family (parsed from the sfnt name table).",
    z.object({
      path: z.string().describe("asset file path, relative to jail root or absolute inside roots"),
    }),
    async ({ path }) => {
      const abs = await jail.resolve(path);
      const fileStat = await stat(abs).catch(() => undefined);
      if (fileStat === undefined || !fileStat.isFile()) {
        return err(`E_NOT_FOUND: ${JSON.stringify(path)} is not an existing file`);
      }
      const type = assetTypeOf(abs);
      const info: {
        path: string;
        type: string;
        sizeBytes: number;
        width?: number;
        height?: number;
        durationSec?: number;
        fontFamily?: string;
      } = { path: abs, type: type ?? "other", sizeBytes: fileStat.size };
      if (type === "image") {
        const dims = await imageDimensions(abs);
        if (dims !== undefined) {
          info.width = dims.width;
          info.height = dims.height;
        }
      } else if (type === "audio" || type === "video") {
        if (hasBinary("ffprobe")) info.durationSec = await probeDuration(abs);
      } else if (type === "font") {
        info.fontFamily = await readFontFamily(abs);
      }
      return ok(info);
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-assets", serverVersion: "0.1.0" });
