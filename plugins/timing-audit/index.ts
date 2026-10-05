// timing-audit —— 节奏审计：timing.report 正则抽取 v.scene("name",{duration:N}) 与 s.beat("name")
// 生成场景/节拍表；timing.estimate 按字数/wpm 估时并给 0.5s 节拍网格；timing.frames 秒→帧换算。
import type { PluginContext } from "@videoos/plugin-kit";

const SCENE_RE = /v\.scene\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{([^}]*)\}/g;
const BEAT_RE = /\bs\.beat\(\s*["'`]([^"'`]+)["'`]/g;
const DURATION_RE = /duration\s*:\s*([0-9]+(?:\.[0-9]+)?)/;

const round2 = (v: number): number => Math.round(v * 100) / 100;

export default async function activate(ctx: PluginContext): Promise<void> {
  const fs = ctx.fs;
  if (fs === undefined) {
    throw new Error("timing-audit requires the fs:read permission (ctx.fs is unavailable)");
  }

  ctx.registerTool({
    name: "timing-audit.timing.report",
    description: "Read a .ts video entry and extract the scene table: v.scene(name, {duration}) blocks with the s.beat names inside each, plus total duration.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute path to a .ts file containing v.scene(...) calls"),
    }),
    run: ({ path }) => {
      if (!fs.exists(path)) {
        return { ok: false, error: `E_NOT_FOUND: no such file: ${path}` };
      }
      if (!path.endsWith(".ts")) {
        return { ok: false, error: `E_ARG: timing.report expects a .ts file (got ${path})` };
      }
      let source: string;
      try {
        source = fs.readFile(path);
      } catch (error) {
        return { ok: false, error: `E_READ: ${error instanceof Error ? error.message : String(error)}` };
      }
      // 场景与节拍统一按源码位置排序：beat 归属其前方最近的 scene
      const marks: Array<{ at: number; kind: "scene" | "beat"; name: string; duration?: number }> = [];
      for (const match of source.matchAll(SCENE_RE)) {
        const durationMatch = DURATION_RE.exec(match[2]);
        marks.push({
          at: match.index ?? 0,
          kind: "scene",
          name: match[1],
          duration: durationMatch !== null ? Number.parseFloat(durationMatch[1]) : 0,
        });
      }
      for (const match of source.matchAll(BEAT_RE)) {
        marks.push({ at: match.index ?? 0, kind: "beat", name: match[1] });
      }
      marks.sort((a, b) => a.at - b.at);
      const scenes: Array<{ name: string; duration: number; beats: string[] }> = [];
      for (const mark of marks) {
        if (mark.kind === "scene") {
          scenes.push({ name: mark.name, duration: mark.duration ?? 0, beats: [] });
        } else if (scenes.length > 0) {
          scenes[scenes.length - 1].beats.push(mark.name);
        }
      }
      const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
      return { ok: true, data: { scenes, totalDuration: round2(totalDuration) } };
    },
  });

  ctx.registerTool({
    name: "timing-audit.timing.estimate",
    description: "Estimate narration seconds from a word count at a given reading pace (wpm) and lay out a 0.5s beat grid.",
    schema: ctx.z.object({
      words: ctx.z.number().int().min(1).max(10_000).describe("narration word count"),
      wpm: ctx.z.number().int().min(60).max(400).describe("words per minute").default(150),
    }),
    run: ({ words, wpm }) => {
      const seconds = round2((words / wpm) * 60);
      const beatGrid: number[] = [];
      for (let t = 0; t <= seconds + 1e-9 && beatGrid.length < 401; t += 0.5) {
        beatGrid.push(round2(t));
      }
      return {
        ok: true,
        data: { words, wpm, seconds, beatGrid, truncated: beatGrid.length >= 401 },
      };
    },
  });

  ctx.registerTool({
    name: "timing-audit.timing.frames",
    description: "Convert seconds to frames at a given fps (round nearest/up/down); the frame math needed when hand-writing s.beat at times.",
    schema: ctx.z.object({
      seconds: ctx.z.number().min(0).max(36_000).describe("duration in seconds"),
      fps: ctx.z.number().int().min(1).max(240).describe("frames per second").default(30),
      round: ctx.z.enum(["nearest", "up", "down"]).describe("rounding mode").default("nearest"),
    }),
    run: ({ seconds, fps, round }) => {
      const raw = seconds * fps;
      const frames = round === "up" ? Math.ceil(raw) : round === "down" ? Math.floor(raw) : Math.round(raw);
      return { ok: true, data: { frames, seconds, fps, round } };
    },
  });
}
