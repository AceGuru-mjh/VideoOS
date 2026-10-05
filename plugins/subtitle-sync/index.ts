// subtitle-sync —— 字幕同步：subtitle.fromBeats 把 [{name, atSeconds, text}] 节拍转 SRT
// （每 cue 2.2s，时间码 00:00:01,000 格式）；subtitle.cps 解析回 cues 做每秒字符数审计；
// subtitle.validate 做 SRT 结构校验（时长倒置/空文本/重叠）。纯文本处理，零依赖。
import type { PluginContext } from "@videoos/plugin-kit";

const CUE_SECONDS = 2.2; // 每 cue 固定 2.2s（默认阅读节奏）
const CPS_BUDGET = 20; // 常用字幕阅读速度预算（字符/秒）
const TIME_RE =
  /(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})/;

interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const pad2 = (n: number): string => String(Math.floor(n)).padStart(2, "0");

/** 毫秒 → SRT 时间码 HH:MM:SS,mmm */
function msToSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  return `${pad2(safe / 3_600_000)}:${pad2((safe % 3_600_000) / 60_000)}:${pad2((safe % 60_000) / 1000)},${String(safe % 1000).padStart(3, "0")}`;
}

function hmsToMs(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
}

/** 解析 SRT 文本 → cues（无法解析的时间块直接跳过） */
function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    const timeLine = lines.find((line) => TIME_RE.test(line));
    if (timeLine === undefined) continue;
    const match = TIME_RE.exec(timeLine);
    if (match === null) continue;
    const startMs = hmsToMs(match[1], match[2], match[3], match[4]);
    const endMs = hmsToMs(match[5], match[6], match[7], match[8]);
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    cues.push({ startMs, endMs, text: textLines.join("\n") });
  }
  return cues;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "subtitle-sync.subtitle.fromBeats",
    description: "Render an ordered beat list [{name, atSeconds, text}] as SRT text; each cue starts at its beat and lasts 2.2s (00:00:01,000 style timecodes).",
    schema: ctx.z.object({
      beats: ctx.z
        .array(
          ctx.z.object({
            name: ctx.z.string().describe("beat/cue identifier"),
            atSeconds: ctx.z.number().min(0).describe("cue start time in seconds"),
            text: ctx.z.string().describe("subtitle text"),
          }),
        )
        .min(1)
        .max(200)
        .describe("ordered beat list (keep it chronological)"),
    }),
    run: ({ beats }) => {
      const blocks = beats.map((beat, index) => {
        const startMs = Math.max(0, Math.round(beat.atSeconds * 1000));
        const lines = [
          String(index + 1),
          `${msToSrtTime(startMs)} --> ${msToSrtTime(startMs + CUE_SECONDS * 1000)}`,
          beat.text,
        ];
        return lines.join("\n");
      });
      return { ok: true, data: { srt: `${blocks.join("\n\n")}\n`, cues: beats.length, cueSeconds: CUE_SECONDS } };
    },
  });

  ctx.registerTool({
    name: "subtitle-sync.subtitle.cps",
    description: "Parse SRT text back into cues and audit reading speed: max/avg characters-per-second plus warnings over a 20 cps budget.",
    schema: ctx.z.object({
      srt: ctx.z.string().describe("SRT subtitle text"),
    }),
    run: ({ srt }) => {
      const cues = parseSrt(srt);
      if (cues.length === 0) {
        return {
          ok: true,
          data: {
            count: 0,
            maxCps: 0,
            avgCps: 0,
            warnings: ['no cues parsed: expected blocks with "00:00:01,000 --> 00:00:03,200" timings'],
          },
        };
      }
      const warnings: string[] = [];
      let totalChars = 0;
      let totalSeconds = 0;
      let maxCps = 0;
      cues.forEach((cue, index) => {
        const chars = cue.text.length;
        const seconds = (cue.endMs - cue.startMs) / 1000;
        if (seconds <= 0) {
          warnings.push(`cue ${index + 1}: non-positive duration (${cue.endMs - cue.startMs}ms)`);
          return;
        }
        const cps = chars / seconds;
        totalChars += chars;
        totalSeconds += seconds;
        if (cps > maxCps) maxCps = cps;
        if (cps > CPS_BUDGET) {
          warnings.push(`cue ${index + 1}: ${round2(cps)} cps exceeds the ${CPS_BUDGET} cps reading budget`);
        }
      });
      return {
        ok: true,
        data: {
          count: cues.length,
          maxCps: round2(maxCps),
          avgCps: totalSeconds > 0 ? round2(totalChars / totalSeconds) : 0,
          warnings,
        },
      };
    },
  });

  ctx.registerTool({
    name: "subtitle-sync.subtitle.validate",
    description: "Structural SRT validation: end-before-start, empty text, and cue overlaps; returns a issues list (empty when valid).",
    schema: ctx.z.object({
      srt: ctx.z.string().describe("SRT subtitle text"),
    }),
    run: ({ srt }) => {
      const cues = parseSrt(srt);
      const issues: string[] = [];
      cues.forEach((cue, index) => {
        if (cue.endMs < cue.startMs) {
          issues.push(`cue ${index + 1}: ends before it starts`);
        }
        if (cue.text.trim().length === 0) {
          issues.push(`cue ${index + 1}: empty text`);
        }
        const next = cues[index + 1];
        if (next !== undefined && next.startMs < cue.endMs) {
          issues.push(`cue ${index + 1}: overlaps cue ${index + 2}`);
        }
      });
      return { ok: true, data: { cues: cues.length, valid: issues.length === 0, issues } };
    },
  });
}
