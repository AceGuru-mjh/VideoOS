// mcp-subtitle 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "Hello world",
  "",
  "2",
  "00:00:03,500 --> 00:00:06,000",
  "Second line",
  "continues",
  "",
].join("\n");

const VTT = [
  "WEBVTT",
  "",
  "intro",
  "00:00:01.000 --> 00:00:03.000 align:start",
  "Hi there",
  "",
  "00:04.000 --> 00:06.500",
  "Bye",
  "",
].join("\n");

describe("mcp-subtitle (E2E)", () => {
  it(
    "exposes 6 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "subtitle.info",
          "subtitle.merge",
          "subtitle.parse",
          "subtitle.scale",
          "subtitle.shift",
          "subtitle.stringify",
        ]);
        expect(server.serverInfo.name).toBe("mcp-subtitle");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.parse auto-detects srt and vtt with exact cue times",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const srt = await server.call("subtitle.parse", { text: SRT });
        expect(srt.ok).toBe(true);
        expect(srt.data).toMatchObject({ format: "srt", count: 2 });
        const srtCues = (srt.data as { cues: unknown[] }).cues as Array<{ index: number; startMs: number; endMs: number; text: string }>;
        expect(srtCues[0]).toMatchObject({ index: 1, startMs: 1000, endMs: 3000, text: "Hello world" });
        expect(srtCues[1]).toMatchObject({ index: 2, startMs: 3500, endMs: 6000, text: "Second line\ncontinues" });

        const vtt = await server.call("subtitle.parse", { text: VTT });
        expect(vtt.data).toMatchObject({ format: "vtt", count: 2 });
        const vttCues = (vtt.data as { cues: unknown[] }).cues as Array<{ index: number; startMs: number; endMs: number; text: string }>;
        expect(vttCues[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: "Hi there" }); // 非数字 id → 顺序编号，settings 已剥离
        expect(vttCues[1]).toMatchObject({ startMs: 4000, endMs: 6500 }); // 无小时位 "00:04.000"

        // 无时间戳 → E_FORMAT
        const bad = await server.call("subtitle.parse", { text: "just some text\nwithout timestamps" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_FORMAT");

        const empty = await server.call("subtitle.parse", { text: "   " });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain("E_FORMAT");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.stringify renders canonical srt/vtt and round-trips",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const vtt = await server.call("subtitle.stringify", {
          cues: [
            { startMs: 4000, endMs: 6500, text: "Bye" },
            { index: 7, startMs: 1000, endMs: 3000, text: "Hi" },
          ],
          format: "vtt",
          title: "demo captions",
        });
        expect(vtt.ok).toBe(true);
        const vttText = (vtt.data as { text: string }).text;
        expect(vttText.startsWith("WEBVTT demo captions\n\n")).toBe(true);
        expect(vttText).toContain("00:00:01.000 --> 00:00:03.000");
        expect(vttText).toContain("00:00:04.000 --> 00:00:06.500");
        expect(vttText.indexOf("00:00:01")).toBeLessThan(vttText.indexOf("00:00:04")); // 按 start 排序

        const srt = await server.call("subtitle.stringify", {
          cues: [{ startMs: 1000, endMs: 3000, text: "Hi" }],
          format: "srt",
        });
        const srtText = (srt.data as { text: string }).text;
        expect(srtText).not.toContain("WEBVTT");
        expect(srtText).toContain("00:00:01,000 --> 00:00:03,000"); // 逗号毫秒
        expect(srtText.startsWith("1\n")).toBe(true); // 缺省 index = 位置

        // roundtrip：stringify → parse 时间不变
        const roundTrip = await server.call("subtitle.parse", { text: vttText });
        const rtCues = (roundTrip.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number }>;
        expect(rtCues.map((c) => [c.startMs, c.endMs])).toEqual([
          [1000, 3000],
          [4000, 6500],
        ]);

        // end < start → E_DATA
        const inverted = await server.call("subtitle.stringify", {
          cues: [{ startMs: 3000, endMs: 1000, text: "bad" }],
          format: "srt",
        });
        expect(inverted.ok).toBe(false);
        expect(inverted.error).toContain("E_DATA");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.shift moves times and clamps negatives to zero",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const forward = await server.call("subtitle.shift", { text: SRT, offsetMs: 1000 });
        expect(forward.ok).toBe(true);
        expect(forward.data).toMatchObject({ shifted: 2, format: "srt" });
        const parsed = await server.call("subtitle.parse", { text: (forward.data as { text: string }).text });
        const cues = (parsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number }>;
        expect(cues[0]).toMatchObject({ startMs: 2000, endMs: 4000 });
        expect(cues[1]).toMatchObject({ startMs: 4500, endMs: 7000 });

        // 大幅负向 → clamp 到 0
        const backward = await server.call("subtitle.shift", { text: SRT, offsetMs: -99999 });
        const backParsed = await server.call("subtitle.parse", { text: (backward.data as { text: string }).text });
        const backCues = (backParsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number }>;
        expect(backCues.every((c) => c.startMs === 0 && c.endMs === 0)).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.info reports CPS stats, longest cue and fast/long warnings",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const fastText = [
          "1",
          "00:00:00,000 --> 00:00:02,000",
          "x".repeat(60), // 60 chars / 2s = 30 cps > 20 → fast
          "",
          "2",
          "00:00:03,000 --> 00:00:08,000",
          "y".repeat(90), // 90 chars > 84 → long（同时 18 cps 不算快）
          "",
        ].join("\n");
        const result = await server.call("subtitle.info", { text: fastText });
        expect(result.ok).toBe(true);
        const data = result.data as {
          count: number;
          durationMs: number;
          avgCps: number;
          maxCps: number;
          longest: { index: number; chars: number; ms: number };
          warnings: string[];
        };
        expect(data.count).toBe(2);
        expect(data.durationMs).toBe(8000);
        expect(data.maxCps).toBe(30);
        expect(data.avgCps).toBe(21.43); // (60+90) chars / (2+5) s
        expect(data.longest).toEqual({ index: 2, chars: 90, ms: 5000 });
        expect(data.warnings.some((w) => w.includes("fast"))).toBe(true);
        expect(data.warnings.some((w) => w.includes("long"))).toBe(true);

        // 干净字幕 → 无警告
        const clean = await server.call("subtitle.info", {
          text: "1\n00:00:00,000 --> 00:00:05,000\nHello there\n\n",
        });
        const cleanData = clean.data as { warnings: string[]; avgCps: number };
        expect(cleanData.warnings).toEqual([]);
        expect(cleanData.avgCps).toBe(2); // 10 chars / 5s
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.scale stretches and compresses the timeline",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const slow = await server.call("subtitle.scale", { text: SRT, factor: 2 });
        expect(slow.data).toMatchObject({ scaled: 2, factor: 2, format: "srt" });
        const slowParsed = await server.call("subtitle.parse", { text: (slow.data as { text: string }).text });
        const slowCues = (slowParsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number }>;
        expect(slowCues[0]).toMatchObject({ startMs: 2000, endMs: 6000 });
        expect(slowCues[1]).toMatchObject({ startMs: 7000, endMs: 12000 });

        const fast = await server.call("subtitle.scale", { text: SRT, factor: 0.5 });
        const fastParsed = await server.call("subtitle.parse", { text: (fast.data as { text: string }).text });
        const fastCues = (fastParsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number }>;
        expect(fastCues[0]).toMatchObject({ startMs: 500, endMs: 1500 });

        const zero = await server.call("subtitle.scale", { text: SRT, factor: 0 });
        expect(zero.ok).toBe(false);
        expect((zero.error ?? "").includes("-32602")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "subtitle.merge concatenates timelines or overlays bilingual cues",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const a = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nThanks\n\n";
        const b = "1\n00:00:01,000 --> 00:00:03,000\n你好\n\n";

        const concat = await server.call("subtitle.merge", { a, b, mode: "concat" });
        expect(concat.ok).toBe(true);
        expect(concat.data).toMatchObject({ format: "srt", count: 3 });
        const concatParsed = await server.call("subtitle.parse", { text: (concat.data as { text: string }).text });
        const concatCues = (concatParsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; endMs: number; text: string }>;
        expect(concatCues[2]).toMatchObject({ startMs: 7000, endMs: 9000, text: "你好" }); // b 平移到 a 结束（6000ms）之后

        const overlay = await server.call("subtitle.merge", { a, b, mode: "overlay" });
        expect(overlay.data).toMatchObject({ count: 2 });
        const overlayParsed = await server.call("subtitle.parse", { text: (overlay.data as { text: string }).text });
        const overlayCues = (overlayParsed.data as { cues: unknown[] }).cues as Array<{ startMs: number; text: string }>;
        expect(overlayCues[0]).toMatchObject({ startMs: 1000, text: "Hello\n你好" }); // 同时间码 → 双语叠加

        // 混合格式 → vtt
        const mixed = await server.call("subtitle.merge", { a, b: VTT, mode: "concat" });
        expect(mixed.data).toMatchObject({ format: "vtt" });
        expect((mixed.data as { text: string }).text.startsWith("WEBVTT")).toBe(true);

        const bad = await server.call("subtitle.merge", { a: "no cues", b, mode: "concat" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_FORMAT");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
