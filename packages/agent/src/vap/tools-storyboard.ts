// Storyboard 工具：storyboard.plan（intent → shots）/ storyboard.toScenes（shots → DSL 代码）
// storyboard.plan 默认是【确定性模板】（按时长切 4-6 镜头，零 LLM 依赖、可测试）；
// LLM 生成路径通过注入 storyboardGenerator 实现（MCP/CLI 可接 router.route("default")）。
import { z } from "zod";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

/** SPEC §2.7 Storyboard IR 的镜头 */
export interface Shot {
  id: string;
  name: string;
  start: number;
  duration: number;
  purpose: string;
  keyElement: string;
}

export const ShotSchema = z.object({
  id: z.string(),
  name: z.string(),
  start: z.number(),
  duration: z.number().positive(),
  purpose: z.string(),
  keyElement: z.string(),
});

/** 可注入的 LLM 生成器（默认用确定性模板） */
export type StoryboardGenerator = (intent: string, durationSeconds: number, style?: string) => Promise<Shot[]>;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 确定性镜头模板（按总时长选 4/5/6 镜头结构） */
const SHOT_TEMPLATES: Array<{ name: string; purpose: string; key: (intent: string) => string }[]> = [
  // 4 镜头（< 8s）
  [
    { name: "hook", purpose: "开场吸引注意力，建立主题", key: (i) => `${i} · 开场` },
    { name: "problem", purpose: "呈现痛点，引发共鸣", key: (i) => `${i} · 痛点` },
    { name: "solution", purpose: "展示方案与产品能力", key: (i) => `${i} · 方案` },
    { name: "cta", purpose: "收束主旨，行动号召", key: (i) => `${i} · 行动` },
  ],
  // 5 镜头（8-20s）
  [
    { name: "hook", purpose: "开场吸引注意力，建立主题", key: (i) => `${i} · 开场` },
    { name: "problem", purpose: "呈现痛点，引发共鸣", key: (i) => `${i} · 痛点` },
    { name: "solution", purpose: "展示方案与产品能力", key: (i) => `${i} · 方案` },
    { name: "proof", purpose: "证据与细节（数据/案例/演示）", key: (i) => `${i} · 证据` },
    { name: "cta", purpose: "收束主旨，行动号召", key: (i) => `${i} · 行动` },
  ],
  // 6 镜头（> 20s）
  [
    { name: "hook", purpose: "开场吸引注意力，建立主题", key: (i) => `${i} · 开场` },
    { name: "problem", purpose: "呈现痛点，引发共鸣", key: (i) => `${i} · 痛点` },
    { name: "insight", purpose: "给出关键洞察，完成叙事转折", key: (i) => `${i} · 洞察` },
    { name: "solution", purpose: "展示方案与产品能力", key: (i) => `${i} · 方案` },
    { name: "proof", purpose: "证据与细节（数据/案例/演示）", key: (i) => `${i} · 证据` },
    { name: "cta", purpose: "收束主旨，行动号召", key: (i) => `${i} · 行动` },
  ],
];

/** 确定性模板生成：时长 → 镜头数（<8s:4 / <20s:5 / else:6），均匀切分（末镜头吃余数），start 累计 */
export function templateShots(intent: string, durationSeconds: number): Shot[] {
  const templateIndex = durationSeconds < 8 ? 0 : durationSeconds < 20 ? 1 : 2;
  const template = SHOT_TEMPLATES[templateIndex] as NonNullable<typeof SHOT_TEMPLATES[number]>;
  const count = template.length;
  const even = durationSeconds / count;
  const shots: Shot[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const duration = isLast ? round1(durationSeconds - start) : round1(even);
    const t = template[i]!;
    shots.push({
      id: `shot_${String(i + 1).padStart(2, "0")}`,
      name: t.name,
      start: round1(start),
      duration,
      purpose: t.purpose,
      keyElement: t.key(intent),
    });
    start = round1(start + duration);
  }
  return shots;
}

/** 场景名安全化（DSL 标识符：Unicode 字母/数字开头，允许 字母/数字/_/-；空名回退 shot） */
function safeSceneName(index: number, raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N}_-]/gu, "");
  const base = cleaned.length === 0 ? "shot" : cleaned;
  const name = `${base}-${index + 1}`;
  return /^[\p{L}\p{N}]/u.test(name) ? name : `shot-${name}`;
}

/** shots → DSL 代码（每 shot 一个 scene：keyElement/purpose 变 text 层 + enter 节拍；相邻场景 crossfade） */
export function shotsToScenesCode(shots: Shot[], opts: { title?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`import { defineVideo } from "@videoos/dsl";`);
  lines.push("");
  lines.push(`// 由 storyboard.toScenes 生成（${shots.length} 个镜头）——Engineer 可继续精修`);
  lines.push(`export default defineVideo(`);
  lines.push(`  { title: ${JSON.stringify(opts.title ?? "VideoOS Storyboard")}, width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },`);
  lines.push(`  (v) => {`);
  const sceneNames: string[] = [];
  shots.forEach((shot, i) => {
    const sceneName = safeSceneName(i, shot.name);
    sceneNames.push(sceneName);
    lines.push(`    v.scene(${JSON.stringify(sceneName)}, { duration: ${String(shot.duration)} }, (s) => {`);
    lines.push(`      s.beat("enter", { at: 0.2, description: ${JSON.stringify(`${shot.name} 节拍`)} });`);
    lines.push(`      s.text("key", ${JSON.stringify(shot.keyElement)}, {`);
    lines.push(`        size: 84, weight: 800, color: "#ffffff",`);
    lines.push(`        at: { x: "50%", y: "42%" },`);
    lines.push(`        enter: { effect: "blur-up", duration: 0.8 },`);
    lines.push(`      });`);
    lines.push(`      s.text("sub", ${JSON.stringify(shot.purpose)}, {`);
    lines.push(`        size: 40, color: "#8b8ba7",`);
    lines.push(`        at: { x: "50%", y: "58%" },`);
    lines.push(`        enter: { effect: "fade", duration: 0.6, delay: 0.3 },`);
    lines.push(`      });`);
    lines.push(`    });`);
    if (i > 0) {
      lines.push(`    v.transition("crossfade", { duration: 0.4, between: [${JSON.stringify(sceneNames[i - 1]!)}, ${JSON.stringify(sceneName)}] });`);
    }
  });
  lines.push(`  },`);
  lines.push(`);`);
  lines.push("");
  return lines.join("\n");
}

export interface StoryboardToolOptions {
  /** 注入后 storyboard.plan 使用它生成镜头（默认确定性模板） */
  storyboardGenerator?: StoryboardGenerator;
}

export function createStoryboardTools(options: StoryboardToolOptions = {}): VapTool[] {
  const plan: VapTool = {
    name: "storyboard.plan",
    description:
      "创意意图 → 镜头列表（Shot：id/name/start/duration/purpose/keyElement）。默认确定性模板（<8s:4 镜头 / <20s:5 / 其余 6，均匀切分）；配置 storyboardGenerator 时走 LLM 生成",
    schema: z.object({
      intent: z.string().describe("创意意图，如「60 秒科技感产品宣传」"),
      durationSeconds: z.number().positive().describe("总时长（秒）"),
      style: z.string().optional().describe("风格描述，如 high-energy tech launch"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const intent = String(args.intent ?? "");
      const duration = Number(args.durationSeconds);
      const style = args.style !== undefined ? String(args.style) : undefined;
      let shots: Shot[];
      let generator = "template";
      if (options.storyboardGenerator !== undefined) {
        try {
          shots = await options.storyboardGenerator(intent, duration, style);
          generator = "llm";
        } catch (err) {
          return { ok: false, error: `STORYBOARD_GENERATOR_FAILED: ${(err as Error).message}` };
        }
      } else {
        shots = templateShots(intent, duration);
      }
      const parsed = z.array(ShotSchema).safeParse(shots);
      if (!parsed.success) {
        return { ok: false, error: `STORYBOARD_INVALID_SHOTS: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
      }
      const total = shots.reduce((acc, s) => acc + s.duration, 0);
      return {
        ok: true,
        data: {
          intent,
          durationSeconds: duration,
          ...(style !== undefined ? { style } : {}),
          generator,
          shots,
          totalDuration: round1(total),
          next: "用 storyboard.toScenes 把 shots 变成 DSL 代码，再交给 Engineer 精修",
        },
      };
    },
  };

  const toScenes: VapTool = {
    name: "storyboard.toScenes",
    description: "镜头列表 → DSL 代码字符串（每 shot 一个 scene：keyElement/purpose 为 text 层 + enter 节拍 + 相邻 crossfade）。只返回代码不写文件（由 Agent/Engineer 决定落盘）",
    schema: z.object({
      shots: z.array(ShotSchema).describe("storyboard.plan 产出的镜头数组"),
    }),
    async execute(args: VapToolArgs): Promise<VapToolResult> {
      const shots = args.shots as Shot[];
      const code = shotsToScenesCode(shots);
      return {
        ok: true,
        data: {
          code,
          scenes: shots.map((s, i) => ({ name: safeSceneName(i, s.name), duration: s.duration })),
          note: "未写入文件；确认后写入 src/video.ts 并 compile.run",
        },
      };
    },
  };

  return [plan, toScenes];
}
