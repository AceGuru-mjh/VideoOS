// Project 工具（资产/音频）：asset.list / asset.add / audio.list / audio.set
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";
import { applyAudioSet } from "./tools-scene";

const ASSET_DIRS = { image: "images", audio: "audio", font: "fonts" } as const;
type AssetKind = keyof typeof ASSET_DIRS;

/** 递归列出目录下文件（相对 root 的路径，排序；目录不存在返回 []） */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  await visit(root, "");
  return out;
}

export function createProjectTools(): VapTool[] {
  const assetList: VapTool = {
    name: "asset.list",
    description: "扫描 assets/{images,audio,fonts} 文件列表 + VIR 资产注册表（id/type/src）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const assetsRoot = join(session.workspace.root, "assets");
      const files: Record<string, string[]> = { images: [], audio: [], fonts: [] };
      for (const dir of ["images", "audio", "fonts"] as const) {
        files[dir] = await listFiles(join(assetsRoot, dir));
      }
      return {
        ok: true,
        data: {
          files,
          virAssets: session.lastCompile?.vir.assets ?? [],
          ...(session.lastCompile === null ? { note: "尚未编译，virAssets 为空；先 compile.run" } : {}),
        },
      };
    },
  };

  const assetAdd: VapTool = {
    name: "asset.add",
    description: "写入资产文件（contentBase64 → assets/<kind 目录>/<path>）；不提供内容时校验文件已存在。返回绝对路径",
    schema: z.object({
      path: z.string().describe("相对 assets/ 的路径，如 images/logo.png（禁止 .. 与绝对路径）"),
      contentBase64: z.string().optional().describe("文件内容 base64（缺省表示文件已存在，仅校验）"),
      kind: z.enum(["image", "audio", "font"]).describe("资产类别（决定目标目录 images/audio/fonts）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const rel = String(args.path ?? "");
      const kind = String(args.kind ?? "") as AssetKind;
      if (!(kind in ASSET_DIRS)) return { ok: false, error: `INVALID_VALUE: kind 必须是 image/audio/font` };
      if (rel.length === 0 || isAbsolute(rel) || rel.split("/").some((seg) => seg === ".." || seg.length === 0)) {
        return { ok: false, error: `INVALID_VALUE: path 必须是 assets/ 下的相对路径（无 ..、无绝对路径），got ${JSON.stringify(rel)}` };
      }
      const kindDir = ASSET_DIRS[kind];
      // path 已含类别目录时直接使用，否则补前缀
      const relInAssets = rel.startsWith(`${kindDir}/`) ? rel : `${kindDir}/${rel}`;
      const target = join(session.workspace.root, "assets", relInAssets);
      if (args.contentBase64 !== undefined) {
        await mkdir(join(target, ".."), { recursive: true });
        const buf = Buffer.from(String(args.contentBase64), "base64");
        await writeFile(target, buf);
        return { ok: true, data: { path: target, kind, bytes: buf.length, written: true } };
      }
      if (!existsSync(target)) {
        return { ok: false, error: `ASSET_NOT_FOUND: ${target} 不存在，且未提供 contentBase64` };
      }
      return { ok: true, data: { path: target, kind, written: false, note: "文件已存在" } };
    },
  };

  const audioList: VapTool = {
    name: "audio.list",
    description: "VIR 音频剪辑（name/src/volume/fadeIn…）+ assets/audio 文件列表",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const files = await listFiles(join(session.workspace.root, "assets", "audio"));
      return {
        ok: true,
        data: { clips: session.lastCompile?.vir.audio ?? [], files },
        ...(session.lastCompile === null ? { note: "尚未编译，clips 为空；先 compile.run" } : {}),
      };
    },
  };

  const audioSet: VapTool = {
    name: "audio.set",
    description: "锚点编辑 v.audio(\"<clip>\", …) 的 volume/fadeIn → 写回 entry → 自动重编译",
    schema: z.object({
      clip: z.string().describe("音频剪辑名（v.audio 首参）"),
      volume: z.number().min(0).optional().describe("音量 0-1+"),
      fadeIn: z.number().min(0).optional().describe("淡入秒数"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.ensureCompiled();
      const clip = String(args.clip ?? "");
      const known = session.lastCompile?.vir.audio.find((a) => a.name === clip);
      if (known === undefined) {
        return {
          ok: false,
          error: `CLIP_NOT_FOUND: ${JSON.stringify(clip)} (available: ${session.lastCompile?.vir.audio.map((a) => a.name).join(", ") || "<none>"})`,
        };
      }
      const source = await readFile(session.entryPath, "utf8");
      const outcome = applyAudioSet(source, {
        clip,
        ...(args.volume !== undefined ? { volume: Number(args.volume) } : {}),
        ...(args.fadeIn !== undefined ? { fadeIn: Number(args.fadeIn) } : {}),
      });
      if (!outcome.ok) return { ok: false, error: outcome.reason };
      await writeFile(session.entryPath, outcome.source as string, "utf8");
      try {
        const result = await session.compile();
        return {
          ok: true,
          data: { edits: outcome.edits, diagnostics: result.diagnostics, virPath: session.virPath },
        };
      } catch (err) {
        return { ok: false, error: `COMPILE_REJECTED: ${(err as Error).message}（源码已写入；可 transaction.rollback）` };
      }
    },
  };

  return [assetList, assetAdd, audioList, audioSet];
}

/** 相对路径工具（导出供测试） */
export function relativeToRoot(root: string, path: string): string {
  return relative(root, path);
}
