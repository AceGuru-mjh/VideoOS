// mcp-time 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-time (E2E)", () => {
  it(
    "exposes 6 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "time.convert",
          "time.duration",
          "time.format",
          "time.now",
          "time.parse",
          "time.zones",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.now returns ISO + epoch for a zone",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.now", { timeZone: "Asia/Shanghai" });
        expect(result.ok).toBe(true);
        const data = result.data as { iso: string; epochMs: number; timeZone: string; offsetMinutes: number };
        expect(data.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
        expect(data.timeZone).toBe("Asia/Shanghai");
        expect(data.offsetMinutes).toBe(480);
        expect(Math.abs(data.epochMs - Date.now())).toBeLessThan(60_000);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.now rejects an invalid zone with a structured error",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.now", { timeZone: "Mars/Olympus_Mons" });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("E_ZONE");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.convert shifts zones (UTC → Tokyo +09:00)",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.convert", {
          time: "2025-06-01T12:00:00Z",
          toTimeZone: "Asia/Tokyo",
        });
        expect(result.ok).toBe(true);
        const data = result.data as { iso: string; offsetMinutes: number; epochMs: number };
        expect(data.iso.startsWith("2025-06-01T21:00:00")).toBe(true);
        expect(data.offsetMinutes).toBe(540);
        expect(data.epochMs).toBe(Date.UTC(2025, 5, 1, 12, 0, 0));
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.format localizes (zh-CN long date)",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.format", {
          time: "2025-06-01T00:00:00Z",
          locale: "zh-CN",
          timeZone: "UTC",
          dateStyle: "long",
        });
        expect(result.ok).toBe(true);
        const data = result.data as { formatted: string };
        expect(data.formatted).toContain("2025");
        expect(data.formatted).toContain("6");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.duration humanizes ms and timestamp ranges",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const short = await server.call("time.duration", { ms: 5_400_000 });
        expect(short.data).toMatchObject({ ms: 5_400_000, human: "1h 30m" });

        const long = await server.call("time.duration", { ms: 65_000, style: "long" });
        expect((long.data as { human: string }).human).toBe("1 minute 5 seconds");

        const range = await server.call("time.duration", {
          from: "2025-06-01T00:00:00Z",
          to: 1_748_736_000_000 + 90_000, // +90s
        });
        expect((range.data as { human: string }).human).toBe("1m 30s");

        const bad = await server.call("time.duration", { from: "2025-06-01T00:00:00Z" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.parse validates ISO 8601 and returns components",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.parse", { text: "2025-06-01T12:00:00+08:00" });
        expect(result.ok).toBe(true);
        const data = result.data as { iso: string; components: { hour: number; day: number } };
        expect(data.iso).toBe("2025-06-01T04:00:00.000Z");
        expect(data.components.hour).toBe(4);
        expect(data.components.day).toBe(1);

        const epoch = await server.call("time.parse", { text: "1748750400000" });
        expect((epoch.data as { iso: string }).iso).toBe("2025-06-01T04:00:00.000Z");

        const bad = await server.call("time.parse", { text: "not a date" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_TIME");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "time.zones lists IANA zones with a filter",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("time.zones", { query: "Shanghai" });
        expect(result.ok).toBe(true);
        const data = result.data as { zones: string[]; defaultZone: string; total: number };
        expect(data.zones).toContain("Asia/Shanghai");
        expect(data.total).toBeGreaterThan(100);
        expect(typeof data.defaultZone).toBe("string");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
