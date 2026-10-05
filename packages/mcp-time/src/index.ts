// @videoos/mcp-time —— 时间/时区/时长工具服务器（stdio MCP）。
// 全部基于标准 Date + Intl：零网络、零原生依赖、跨平台。
// 时间线用途：视频项目的时间码换算、跨时区排期、字幕时间轴计算、QA 时间预算。
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { ok } from "@videoos/mcp-lite";
import { z } from "zod";

const LATEST_PROTOCOL_VERSION = "2025-03-26";

/** 时区有效性检查（IANA 名；undefined → 系统时区） */
function zoneInfo(timeZone: string | undefined): { timeZone: string; valid: boolean; reason?: string } {
  if (timeZone === undefined) return { timeZone: "system", valid: true };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return { timeZone, valid: true };
  } catch (error) {
    return { timeZone, valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 解析时间入参：ISO 8601 字符串或 epoch 毫秒（数字或数字字符串） */
function parseTimeInput(value: string | number): { ok: true; epochMs: number } | { ok: false; reason: string } {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (/^-?\d{1,15}$/.test(text)) {
    const epoch = Number.parseInt(text, 10);
    if (Number.isFinite(epoch)) return { ok: true, epochMs: epoch };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: `not a valid ISO 8601 timestamp or epoch milliseconds: ${JSON.stringify(text)}` };
  }
  return { ok: true, epochMs: parsed.getTime() };
}

/** 某时区的偏移分钟与 ISO 串（用 Intl parts 反推，避免引入日期库） */
function zoneSnapshot(epochMs: number, timeZone: string | undefined): { iso: string; offsetMinutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const hour = Number.parseInt(parts.hour === "24" ? "00" : parts.hour, 10);
  const asUTC = Date.UTC(
    Number.parseInt(parts.year, 10),
    Number.parseInt(parts.month, 10) - 1,
    Number.parseInt(parts.day, 10),
    hour,
    Number.parseInt(parts.minute, 10),
    Number.parseInt(parts.second, 10),
  );
  const offsetMinutes = Math.round((asUTC - Math.floor(epochMs / 1000) * 1000) / 60_000);
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, "0");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const iso = `${parts.year}-${parts.month}-${parts.day}T${pad(hour)}:${parts.minute}:${parts.second}${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return { iso, offsetMinutes };
}

/** 毫秒 → 人类可读时长（不超过两级单位，如 "1h 30m"） */
function humanizeDuration(ms: number, style: "short" | "long" = "short"): string {
  const units: Array<[number, string, string]> = [
    [86_400_000, "d", "day"],
    [3_600_000, "h", "hour"],
    [60_000, "m", "minute"],
    [1_000, "s", "second"],
  ];
  const negative = ms < 0;
  let rest = Math.abs(Math.round(ms));
  const chunks: string[] = [];
  for (const [size, short, long] of units) {
    if (rest >= size) {
      const count = Math.floor(rest / size);
      rest -= count * size;
      chunks.push(style === "short" ? `${count}${short}` : `${count} ${long}${count === 1 ? "" : "s"}`);
    }
    if (chunks.length === 2) break;
  }
  if (chunks.length === 0) chunks.push(style === "short" ? "0s" : "0 seconds");
  return `${negative ? "-" : ""}${chunks.join(" ")}`;
}

const timeZoneSchema = z
  .string()
  .describe('IANA time zone, e.g. "Asia/Shanghai" (default: system zone)');

const tools = [
  defineTool(
    "time.now",
    "Current wall-clock time: ISO string, epoch ms, and offset for the requested time zone.",
    z.object({ timeZone: timeZoneSchema.optional() }),
    ({ timeZone }) => {
      const info = zoneInfo(timeZone);
      if (!info.valid) return { ok: false, error: `E_ZONE: ${info.reason}` };
      const epochMs = Date.now();
      const snap = zoneSnapshot(epochMs, timeZone);
      return ok({ iso: snap.iso, epochMs, timeZone: info.timeZone, offsetMinutes: snap.offsetMinutes });
    },
  ),
  defineTool(
    "time.convert",
    "Convert a timestamp (ISO 8601 or epoch ms) to another time zone; returns local ISO + offset.",
    z.object({
      time: z.union([z.string(), z.number()]).describe('ISO 8601 string or epoch milliseconds, e.g. "2025-06-01T12:00:00Z"'),
      toTimeZone: timeZoneSchema.describe("target time zone"),
    }),
    ({ time, toTimeZone }) => {
      const info = zoneInfo(toTimeZone);
      if (!info.valid) return { ok: false, error: `E_ZONE: ${info.reason}` };
      const parsed = parseTimeInput(time);
      if (!parsed.ok) return { ok: false, error: `E_TIME: ${parsed.reason}` };
      const snap = zoneSnapshot(parsed.epochMs, toTimeZone);
      return ok({ iso: snap.iso, epochMs: parsed.epochMs, timeZone: toTimeZone, offsetMinutes: snap.offsetMinutes });
    },
  ),
  defineTool(
    "time.format",
    "Format a timestamp with a locale and date/time style (Intl.DateTimeFormat presets).",
    z.object({
      time: z.union([z.string(), z.number()]).describe("ISO 8601 string or epoch milliseconds"),
      locale: z.string().describe('BCP 47 locale, e.g. "en-US", "zh-CN"').default("en-US"),
      timeZone: timeZoneSchema.optional(),
      dateStyle: z.enum(["full", "long", "medium", "short"]).optional(),
      timeStyle: z.enum(["full", "long", "medium", "short"]).optional(),
    }),
    ({ time, locale, timeZone, dateStyle, timeStyle }) => {
      const zone = zoneInfo(timeZone);
      if (!zone.valid) return { ok: false, error: `E_ZONE: ${zone.reason}` };
      const parsed = parseTimeInput(time);
      if (!parsed.ok) return { ok: false, error: `E_TIME: ${parsed.reason}` };
      try {
        const formatter = new Intl.DateTimeFormat(locale, {
          ...(timeZone !== undefined ? { timeZone } : {}),
          ...(dateStyle !== undefined ? { dateStyle } : {}),
          ...(timeStyle !== undefined ? { timeStyle } : {}),
        });
        return ok({ formatted: formatter.format(new Date(parsed.epochMs)), locale, epochMs: parsed.epochMs });
      } catch (error) {
        return { ok: false, error: `E_LOCALE: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  ),
  defineTool(
    "time.duration",
    "Humanize a duration given in ms (or between two timestamps), e.g. 5400000 → \"1h 30m\".",
    z.object({
      ms: z.number().describe("duration in milliseconds (omit when using from/to)").optional(),
      from: z.union([z.string(), z.number()]).describe("start timestamp (ISO 8601 or epoch ms)").optional(),
      to: z.union([z.string(), z.number()]).describe("end timestamp (ISO 8601 or epoch ms)").optional(),
      style: z.enum(["short", "long"]).describe("short: \"1h 30m\"; long: \"1 hour 30 minutes\"").default("short"),
    }),
    ({ ms, from, to, style }) => {
      let total = ms;
      if (from !== undefined && to !== undefined) {
        const a = parseTimeInput(from);
        if (!a.ok) return { ok: false, error: `E_TIME: ${a.reason}` };
        const b = parseTimeInput(to);
        if (!b.ok) return { ok: false, error: `E_TIME: ${b.reason}` };
        total = b.epochMs - a.epochMs;
      } else if (from !== undefined || to !== undefined) {
        return { ok: false, error: "E_ARGS: provide either ms, or both from and to" };
      }
      if (total === undefined) return { ok: false, error: "E_ARGS: provide ms, or both from and to" };
      return ok({ ms: total, human: humanizeDuration(total, style) });
    },
  ),
  defineTool(
    "time.parse",
    "Parse and validate an ISO 8601 timestamp (or epoch ms); returns ISO UTC + calendar components.",
    z.object({ text: z.string().describe('e.g. "2025-06-01T12:00:00+08:00"') }),
    ({ text }) => {
      const parsed = parseTimeInput(text);
      if (!parsed.ok) return { ok: false, error: `E_TIME: ${parsed.reason}` };
      const date = new Date(parsed.epochMs);
      return ok({
        iso: date.toISOString(),
        epochMs: parsed.epochMs,
        components: {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: date.getUTCHours(),
          minute: date.getUTCMinutes(),
          second: date.getUTCSeconds(),
          weekday: date.toUTCString().slice(0, 3),
        },
      });
    },
  ),
  defineTool(
    "time.zones",
    "List IANA time zones (optionally filtered by substring), with the system default zone.",
    z.object({ query: z.string().describe("case-insensitive substring filter, e.g. \"Asia\"").optional() }),
    ({ query }) => {
      const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
      const filter = query?.toLowerCase();
      const zones = supported.filter((zone) => filter === undefined || zone.toLowerCase().includes(filter));
      return ok({
        defaultZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        total: supported.length,
        zones: zones.slice(0, 100),
        truncated: zones.length > 100,
      });
    },
  ),
];

await runStdioServer(tools, {
  serverName: "mcp-time",
  serverVersion: "0.1.0",
  supportedProtocolVersions: [LATEST_PROTOCOL_VERSION, "2024-11-05"],
});
