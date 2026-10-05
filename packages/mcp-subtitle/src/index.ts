// @videoos/mcp-subtitle —— SRT/WebVTT 字幕工具服务器（stdio MCP）：解析/生成/时间平移/缩放/合并/CPS 质检。
// 纯 TS 文本处理，零依赖；自动识别 srt（逗号毫秒）与 vtt（WEBVTT 头 + 点毫秒）。
// 时间线用途：subtitle-burn 字幕烧制对齐、accessible-captions 的 CPS 阅读速度与超长检查。
import { defineTool, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

type Format = "srt" | "vtt";

interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const TS_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
const CUE_LINE_RE = /^(\S+)\s*-->\s*(\S+)(?:\s.*)?$/;

/** 单个时间码 → 毫秒（支持可选小时位；毫秒 1-3 位右补零） */
function parseTimestamp(token: string): number | null {
  const m = TS_RE.exec(token.trim());
  if (m === null) return null;
  const hours = m[1] === undefined ? 0 : Number.parseInt(m[1], 10);
  const minutes = Number.parseInt(m[2]!, 10);
  const seconds = Number.parseInt(m[3]!, 10);
  const millis = Number.parseInt(m[4]!.padEnd(3, "0").slice(0, 3), 10);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** 毫秒 → srt/vtt 时间码（HH:MM:SS,mmm / HH:MM:SS.mmm） */
function formatTimestamp(ms: number, format: Format): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const mil = t % 1000;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}${format === "srt" ? "," : "."}${String(mil).padStart(3, "0")}`;
}

/** 解析 srt/vtt 文本：自动识别格式；格式坏 → E_FORMAT */
function parseSubtitles(text: string): { format: Format; cues: Cue[] } {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") throw new ToolError("E_FORMAT", "subtitle text is empty");
  const lines = normalized.split("\n");
  let format: Format;
  if (/^WEBVTT/i.test((lines[0] ?? "").trim())) {
    format = "vtt";
  } else {
    const tsLine = lines.find((l) => l.includes("-->"));
    if (tsLine === undefined) {
      throw new ToolError(
        "E_FORMAT",
        'no cue timestamps found (expected srt "00:00:01,000 --> 00:00:03,000" or a WEBVTT header)',
      );
    }
    format = tsLine.includes(".") ? "vtt" : "srt";
  }

  const cues: Cue[] = [];
  let auto = 0;
  for (const block of normalized.split(/\n[ \t]*\n+/)) {
    const blockLines = block.split("\n").map((l) => l.trimEnd());
    while (blockLines.length > 0 && blockLines[0]!.trim() === "") blockLines.shift();
    if (blockLines.length === 0) continue;
    const tsIdx = blockLines.findIndex((l) => CUE_LINE_RE.test(l.trim()));
    if (tsIdx < 0) continue; // NOTE/STYLE/REGION 等非 cue 块
    const m = CUE_LINE_RE.exec(blockLines[tsIdx]!.trim());
    if (m === null) continue;
    const startMs = parseTimestamp(m[1]!);
    const endMs = parseTimestamp(m[2]!);
    if (startMs === null || endMs === null) {
      throw new ToolError("E_FORMAT", `bad cue timestamp line: ${JSON.stringify(blockLines[tsIdx])}`);
    }
    const idLine = tsIdx > 0 ? blockLines[0]!.trim() : "";
    const index = /^\d+$/.test(idLine) ? Number.parseInt(idLine, 10) : ++auto;
    const body = blockLines.slice(tsIdx + 1).join("\n");
    cues.push({ index, startMs, endMs, text: body });
  }
  if (cues.length === 0) throw new ToolError("E_FORMAT", "no cues found (need at least one 'start --> end' block)");
  return { format, cues };
}

/** cue 列表 → 规范文本（vtt 加 WEBVTT 头；按 startMs 排序；end<start → E_DATA） */
function stringifySubtitles(cues: Cue[], format: Format, title?: string): string {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const c of sorted) {
    if (c.endMs < c.startMs) {
      throw new ToolError("E_DATA", `cue ${c.index} ends (${c.endMs}ms) before it starts (${c.startMs}ms)`);
    }
  }
  const blocks = sorted.map(
    (c, i) => `${c.index ?? i + 1}\n${formatTimestamp(c.startMs, format)} --> ${formatTimestamp(c.endMs, format)}\n${c.text}`,
  );
  const head =
    format === "vtt" ? `WEBVTT${title !== undefined && title !== "" ? ` ${title}` : ""}\n\n` : "";
  return head + blocks.join("\n\n") + "\n";
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** cue 可见字符数（去掉所有空白，CJK 友好） */
function charsOf(text: string): number {
  return text.replace(/\s/g, "").length;
}

const cueSchema = z.object({
  index: z.number().int().min(1).describe("cue number (default: position)").optional(),
  startMs: z.number().int().min(0).describe("start time in milliseconds"),
  endMs: z.number().int().min(0).describe("end time in milliseconds"),
  text: z.string().describe("cue text (newlines preserved)"),
});

const tools = [
  defineTool(
    "subtitle.parse",
    "Parse SRT or WebVTT text (format auto-detected) into cues with millisecond times.",
    z.object({ text: z.string().describe("subtitle file content (srt or vtt)") }),
    ({ text }) => {
      const { format, cues } = parseSubtitles(text);
      return ok({ format, cues, count: cues.length });
    },
  ),
  defineTool(
    "subtitle.stringify",
    "Render cues as canonical SRT or WebVTT text (vtt gets a WEBVTT header; cues sorted by start).",
    z.object({
      cues: z.array(cueSchema).min(1).max(2000).describe("cue list"),
      format: z.enum(["srt", "vtt"]).describe("output format"),
      title: z.string().max(200).describe("vtt title after the WEBVTT header").optional(),
    }),
    ({ cues, format, title }) => {
      const normalized: Cue[] = cues.map((c, i) => ({ ...c, index: c.index ?? i + 1 }));
      const text = stringifySubtitles(normalized, format, title);
      return ok({ text, format, count: normalized.length });
    },
  ),
  defineTool(
    "subtitle.shift",
    "Shift all cue times by offsetMs (negative values clamp to 0); format is preserved.",
    z.object({
      text: z.string().describe("subtitle file content (srt or vtt)"),
      offsetMs: z.number().int().describe("offset in milliseconds (negative shifts earlier)"),
    }),
    ({ text, offsetMs }) => {
      const { format, cues } = parseSubtitles(text);
      const shifted = cues.map((c) => ({
        ...c,
        startMs: Math.max(0, c.startMs + offsetMs),
        endMs: Math.max(0, c.endMs + offsetMs),
      }));
      return ok({ text: stringifySubtitles(shifted, format), shifted: shifted.length, format });
    },
  ),
  defineTool(
    "subtitle.info",
    "Subtitle QA stats: count, duration, chars-per-second reading speed, longest cue and warnings (fast >20 cps, long >84 chars).",
    z.object({ text: z.string().describe("subtitle file content (srt or vtt)") }),
    ({ text }) => {
      const { format, cues } = parseSubtitles(text);
      const warnings: string[] = [];
      let totalChars = 0;
      let speakMs = 0;
      let maxCps = 0;
      let longest: Cue = cues[0]!;
      let longestChars = 0;
      for (const cue of cues) {
        const chars = charsOf(cue.text);
        const dur = cue.endMs - cue.startMs;
        totalChars += chars;
        if (chars > longestChars) {
          longest = cue;
          longestChars = chars;
        }
        if (dur <= 0) {
          warnings.push(`cue ${cue.index} has zero or negative duration`);
          continue;
        }
        speakMs += dur;
        const cps = chars / (dur / 1000);
        maxCps = Math.max(maxCps, cps);
        if (cps > 20) {
          warnings.push(`cue ${cue.index} is fast: ${round(cps, 1)} chars/s (threshold 20) — shorten or extend the cue`);
        }
        if (chars > 84) {
          warnings.push(`cue ${cue.index} is long: ${chars} chars (threshold 84) — split into two cues`);
        }
      }
      const starts = cues.map((c) => c.startMs);
      const ends = cues.map((c) => c.endMs);
      return ok({
        format,
        count: cues.length,
        durationMs: Math.max(...ends) - Math.min(...starts),
        avgCps: speakMs > 0 ? round(totalChars / (speakMs / 1000), 2) : 0,
        maxCps: round(maxCps, 2),
        longest: { index: longest.index, chars: longestChars, ms: longest.endMs - longest.startMs },
        warnings,
      });
    },
  ),
  defineTool(
    "subtitle.scale",
    "Scale the timeline by a factor (1.2 = 20% slower, 0.5 = double speed); format is preserved.",
    z.object({
      text: z.string().describe("subtitle file content (srt or vtt)"),
      factor: z.number().min(0.1).max(10).describe("time multiplier (1.2 slows down by 20%)"),
    }),
    ({ text, factor }) => {
      const { format, cues } = parseSubtitles(text);
      const scaled = cues.map((c) => ({
        ...c,
        startMs: Math.max(0, Math.round(c.startMs * factor)),
        endMs: Math.max(0, Math.round(c.endMs * factor)),
      }));
      return ok({ text: stringifySubtitles(scaled, format), scaled: scaled.length, format, factor });
    },
  ),
  defineTool(
    "subtitle.merge",
    "Merge two subtitle texts: concat appends b after a ends; overlay stacks bilingual cues with identical times.",
    z.object({
      a: z.string().describe("first subtitle text (srt or vtt)"),
      b: z.string().describe("second subtitle text (srt or vtt)"),
      mode: z.enum(["concat", "overlay"]).describe("concat: play b after a; overlay: stack b on a's timeline"),
    }),
    ({ a, b, mode }) => {
      const pa = parseSubtitles(a);
      const pb = parseSubtitles(b);
      const format: Format = pa.format === pb.format ? pa.format : "vtt";
      let merged: Cue[];
      if (mode === "concat") {
        const offset = Math.max(0, ...pa.cues.map((c) => c.endMs));
        merged = [
          ...pa.cues,
          ...pb.cues.map((c) => ({ ...c, startMs: c.startMs + offset, endMs: c.endMs + offset })),
        ];
      } else {
        merged = [...pa.cues];
        for (const cue of pb.cues) {
          const match = merged.find((c) => c.startMs === cue.startMs && c.endMs === cue.endMs);
          if (match === undefined) {
            merged.push({ ...cue });
          } else {
            match.text = `${match.text}\n${cue.text}`;
          }
        }
      }
      return ok({ text: stringifySubtitles(merged, format), format, count: merged.length });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-subtitle", serverVersion: "0.1.0" });
