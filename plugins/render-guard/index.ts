// render-guard —— 渲染前检查清单：src/video.ts（或 video.project.json 的 entry）存在、
// tests/ 存在且含 *.test.ts、entry 源码正则抽出 title/fps → {pass, items:[{check, ok, detail}]}。
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginContext, PluginFs } from "@videoos/plugin-kit";

const TITLE_RE = /title\s*:\s*["'`]([^"'`]+)["'`]/;
const FPS_RE = /fps\s*:\s*([0-9]+)/;

export default async function activate(ctx: PluginContext): Promise<void> {
  const fs: PluginFs | undefined = ctx.fs;
  if (fs === undefined) {
    throw new Error("render-guard requires the fs:read permission (ctx.fs is unavailable)");
  }

  ctx.registerTool({
    name: "render-guard.guard.checklist",
    description: "Run the pre-render checklist on a video project directory: entry exists, tests/ contains *.test.ts, and title/fps are declared in the entry source.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute project root (contains video.project.json / src / tests)"),
    }),
    run: ({ path }) => {
      if (!fs.exists(path)) {
        return { ok: false, error: `E_NOT_FOUND: no such directory: ${path}` };
      }
      const items: Array<{ check: string; ok: boolean; detail: string }> = [];

      // entry 解析顺序：video.project.json 的 entry 字段 → 缺省 src/video.ts
      let entryRel = "src/video.ts";
      let projectName: string | undefined;
      const projectFile = join(path, "video.project.json");
      if (fs.exists(projectFile)) {
        try {
          const project = JSON.parse(fs.readFile(projectFile)) as { entry?: unknown; name?: unknown };
          if (typeof project.entry === "string" && project.entry.length > 0) entryRel = project.entry;
          if (typeof project.name === "string") projectName = project.name;
        } catch {
          // 坏 project json → 走缺省 entry，后续 items 如实反映
        }
      }
      const entryAbs = join(path, entryRel);
      const entryExists = fs.exists(entryAbs);
      items.push({
        check: `entry file (${entryRel}) exists`,
        ok: entryExists,
        detail: entryExists ? `found: ${entryAbs}` : `missing: ${entryAbs}`,
      });

      // tests/ 目录 + *.test.ts
      const testsDir = join(path, "tests");
      let testsOk = false;
      let testsDetail = `missing directory: ${testsDir}`;
      if (fs.exists(testsDir)) {
        try {
          const testFiles = readdirSync(testsDir).filter((name) => name.endsWith(".test.ts"));
          testsOk = testFiles.length > 0;
          testsDetail = testsOk
            ? `${testFiles.length} test file(s): ${testFiles.slice(0, 3).join(", ")}`
            : "tests/ exists but contains no *.test.ts";
        } catch (error) {
          testsDetail = `unreadable: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      items.push({ check: "tests/ contains *.test.ts", ok: testsOk, detail: testsDetail });

      // entry 源码正则抽 title / fps
      let title: string | undefined;
      let fps: number | undefined;
      if (entryExists) {
        try {
          const source = fs.readFile(entryAbs);
          const titleMatch = TITLE_RE.exec(source);
          if (titleMatch !== null) title = titleMatch[1];
          const fpsMatch = FPS_RE.exec(source);
          if (fpsMatch !== null) fps = Number.parseInt(fpsMatch[1], 10);
        } catch {
          // 不可读 → 两项如实 fail
        }
      }
      items.push({
        check: "title declared in entry source",
        ok: title !== undefined,
        detail: title !== undefined ? `title: ${JSON.stringify(title)}` : 'no `title: "..."` literal found in the entry source',
      });
      items.push({
        check: "fps declared in entry source",
        ok: fps !== undefined,
        detail: fps !== undefined ? `fps: ${fps}` : "no `fps: N` literal found in the entry source",
      });

      return {
        ok: true,
        data: {
          pass: items.every((item) => item.ok),
          items,
          entry: entryRel,
          ...(projectName !== undefined ? { project: projectName } : {}),
        },
      };
    },
  });
}
