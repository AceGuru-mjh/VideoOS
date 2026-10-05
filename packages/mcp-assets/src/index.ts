// @videoos/mcp-assets — 素材库服务器（Issue #36，SPEC §3.5 mcp-assets 表）。
// 工具：assets.index（递归扫描 → 内存缓存 + <root>/.assets-index.json 镜像）、
//       assets.search（跨已索引根的名称/路径子串搜索，≤ 50 条）、
//       assets.info（单文件详情：图片尺寸 / 音视频时长+编码 / 字体名称表）。
// 安全基线：root 与 path 均经路径监狱（env MCP_ASSETS_ROOTS）校验。
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";
import { basename, extname, join, relative, sep } from "node:path";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";
import { parseRoots, createJail } from "./jail";
import type { PathJail } from "./jail";
import { parseFontName } from "./font";

type AssetType = "image" | "audio" | "video" | "font";

/** 扩展名 → 素材类型（其余扩展名不入索引） */
const EXT_TYPE: Record<string, AssetType> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", bmp: "image",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
};

/** 按扩展名分类；未知扩展返回 null */
function classifyByName(name: string): AssetType | null {
  const ext = extname(name).slice(1).toLowerCase();
  return EXT_TYPE[ext] ?? null;
}

/** 索引条目（path 相对 root，统一 "/" 分隔，跨平台可移植） */
interface AssetEntry {
  name: string;
  path: string;
  type: AssetType;
  sizeBytes: number;
  mtimeMs: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

/** 内存缓存：resolvedRoot → 索引结果（assets.search 跨全部已索引根检索） */
const INDEX_CACHE = new Map<string, { entries: AssetEntry[]; scannedAt: number }>();

/** 路径监狱：多根 = env MCP_ASSETS_ROOTS（缺省回落 cwd） */
const jail: PathJail = createJail(parseRoots(process.env.MCP_ASSETS_ROOTS, process.cwd()));

/** 统一的越狱/异常 → ToolResult 转换（业务失败不抛错） */
function toError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** ffprobe 时长探测（-show_entries format=duration）；缺失/失败返回 null（跳过时长） */
async function probeDuration(absPath: string): Promise<number | null> {
  const bin = Bun.which("ffprobe");
  if (bin === null) return null;
  try {
    const proc = Bun.spawn([bin, "-v", "error", "-show_entries", "format=duration", "-of", "json", absPath], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const stdoutText = new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const json = JSON.parse(await stdoutText) as { format?: { duration?: string } };
    const duration = Number(json.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null;
  } catch {
    return null;
  }
}

/** ffprobe 详情（时长 + 首流编码，assets.info 用）；缺失/失败返回 null */
async function probeMediaDetail(absPath: string): Promise<{ durationSeconds?: number; codec?: string } | null> {
  const bin = Bun.which("ffprobe");
  if (bin === null) return null;
  try {
    const proc = Bun.spawn([bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const stdoutText = new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const json = JSON.parse(await stdoutText) as {
      format?: { duration?: string };
      streams?: Array<{ codec_name?: string }>;
    };
    const duration = Number(json.format?.duration);
    const firstStream = json.streams?.[0];
    return {
      ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: Math.round(duration * 100) / 100 } : {}),
      ...(firstStream?.codec_name !== undefined ? { codec: firstStream.codec_name } : {}),
    };
  } catch {
    return null;
  }
}

/** 递归扫描素材目录：深度 ≤ 6，跳过 node_modules 与 "." 开头项；按 maxEntries 截断 */
async function scanRoot(rootAbs: string, maxEntries: number): Promise<AssetEntry[]> {
  const entries: AssetEntry[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (entries.length >= maxEntries || depth > 6) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.length >= maxEntries) return;
      if (name.startsWith(".") || name === "node_modules") continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const type = classifyByName(name);
      if (type === null) continue;
      const entry: AssetEntry = {
        name,
        path: relative(rootAbs, abs).split(sep).join("/"),
        type,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
      };
      if (type === "image") {
        // @napi-rs/canvas 直接读文件取宽高（非图片数据/坏文件 → 跳过尺寸）
        try {
          const img = await loadImage(abs);
          entry.width = img.width;
          entry.height = img.height;
        } catch {
          /* 跳过尺寸 */
        }
      } else if (type === "audio" || type === "video") {
        const duration = await probeDuration(abs);
        if (duration !== null) entry.durationSeconds = duration;
      }
      // 字体不在索引期探测（名称表按需在 assets.info 里解析）
      entries.push(entry);
    }
  };
  await walk(rootAbs, 0);
  return entries;
}

const assetsIndex = defineTool({
  name: "assets.index",
  description: "索引素材目录（图片/音频/视频/字体 → 名称/类型/大小/尺寸/时长；内存缓存 + .assets-index.json 镜像）",
  schema: z.object({
    root: z.string().min(1),
    refresh: z.boolean().default(false),
    maxEntries: z.number().int().min(1).max(100_000).default(2000),
  }),
  call: async (args) => {
    let rootAbs: string;
    try {
      rootAbs = jail.resolveIn(args.root);
    } catch (err) {
      return toError(err);
    }
    let st;
    try {
      st = statSync(rootAbs);
    } catch {
      return { ok: false, error: `root not found: ${args.root}` };
    }
    if (!st.isDirectory()) return { ok: false, error: `root is not a directory: ${args.root}` };

    let cached = INDEX_CACHE.get(rootAbs);
    if (args.refresh || cached === undefined) {
      const entries = await scanRoot(rootAbs, args.maxEntries);
      cached = { entries, scannedAt: Date.now() };
      INDEX_CACHE.set(rootAbs, cached);
      // 镜像文件总是随扫描写盘（本身以 "." 开头，不会被索引）
      try {
        writeFileSync(
          join(rootAbs, ".assets-index.json"),
          JSON.stringify({ version: 1, scannedAt: cached.scannedAt, count: entries.length, entries }, null, 2),
          "utf8",
        );
      } catch {
        /* 镜像写失败不致命 */
      }
    }
    return { ok: true, data: { root: rootAbs, entries: cached.entries, scannedAt: cached.scannedAt, count: cached.entries.length } };
  },
});

const assetsSearch = defineTool({
  name: "assets.search",
  description: "跨已索引根搜索素材（名称/相对路径子串，大小写不敏感；type 可选过滤；结果 ≤ 50 条）",
  schema: z.object({
    query: z.string().min(1),
    type: z.enum(["image", "audio", "video", "font"]).optional(),
  }),
  call: (args) => {
    if (INDEX_CACHE.size === 0) {
      return { ok: false, error: "no index yet — call assets.index first" };
    }
    const q = args.query.toLowerCase();
    const all: AssetEntry[] = [];
    for (const { entries } of INDEX_CACHE.values()) {
      all.push(...entries);
    }
    const matched = all.filter(
      (e) =>
        (e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)) &&
        (args.type === undefined || e.type === args.type),
    );
    return { ok: true, data: { results: matched.slice(0, 50), total: matched.length } };
  },
});

const assetsInfo = defineTool({
  name: "assets.info",
  description: "单文件素材详情（图片宽高 / 音视频时长+编码 / 字体名称表）",
  schema: z.object({ path: z.string().min(1) }),
  call: async (args) => {
    let abs: string;
    try {
      abs = jail.resolveIn(args.path);
    } catch (err) {
      return toError(err);
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      return { ok: false, error: `file not found: ${args.path}` };
    }
    if (!st.isFile()) return { ok: false, error: `not a file: ${args.path}` };
    const type = classifyByName(basename(abs));
    if (type === null) {
      return { ok: false, error: `unsupported file type: ${extname(abs) || "<none>"}` };
    }
    const data: Record<string, unknown> = {
      name: basename(abs),
      type,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
    };
    if (type === "image") {
      try {
        const img = await loadImage(abs);
        data.width = img.width;
        data.height = img.height;
      } catch {
        /* 跳过尺寸 */
      }
    } else if (type === "audio" || type === "video") {
      const detail = await probeMediaDetail(abs);
      if (detail !== null) {
        if (detail.durationSeconds !== undefined) data.durationSeconds = detail.durationSeconds;
        if (detail.codec !== undefined) data.codec = detail.codec;
      }
    } else {
      // 字体：读 name 表（解析失败/woff → 只报 format + 大小）
      const ext = extname(abs).slice(1).toLowerCase();
      try {
        const info = parseFontName(new Uint8Array(readFileSync(abs)));
        if (info !== null) {
          if (info.family !== undefined) data.family = info.family;
          if (info.fullName !== undefined) data.fullName = info.fullName;
          if (info.subfamily !== undefined) data.subfamily = info.subfamily;
          data.format = info.format;
        } else {
          data.format = ext;
        }
      } catch {
        data.format = ext;
      }
    }
    return { ok: true, data };
  },
});

await runStdioServer([assetsIndex, assetsSearch, assetsInfo], { serverName: "mcp-assets", serverVersion: "0.1.0" });
