// mcp-regex 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-regex (E2E)", () => {
  it(
    "exposes 4 regex.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "regex.build",
          "regex.cheatsheet",
          "regex.escape",
          "regex.test",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.build validates and explains a named-group pattern",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("regex.build", {
          source: "^(?<year>\\d{4})-(?<month>\\d{2})$",
        });
        expect(r.ok).toBe(true);
        const data = r.data as {
          valid: boolean;
          pattern: string;
          explanation: {
            anchors: string[];
            groups: string[];
            captures: number;
            classes: number;
            quantifiers: number;
            literalsCount: number;
          };
        };
        expect(data.valid).toBe(true);
        expect(data.pattern).toBe("^(?<year>\\d{4})-(?<month>\\d{2})$");
        expect(data.explanation.groups).toEqual(["year", "month"]);
        expect(data.explanation.anchors.some((a) => a.startsWith("^"))).toBe(true);
        expect(data.explanation.anchors.some((a) => a.startsWith("$"))).toBe(true);
        expect(data.explanation.classes).toBe(2);
        expect(data.explanation.quantifiers).toBe(2);
        expect(data.explanation.literalsCount).toBe(1);

        const plain = await server.call("regex.build", { source: "a(b)c" });
        const plainData = plain.data as { valid: boolean; explanation: { captures: number; literalsCount: number } };
        expect(plainData.valid).toBe(true);
        expect(plainData.explanation.captures).toBe(1);
        expect(plainData.explanation.literalsCount).toBe(3);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.build reports invalid patterns and flags without failing",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const bad = await server.call("regex.build", { source: "(unclosed" });
        expect(bad.ok).toBe(true);
        const badData = bad.data as { valid: boolean; error?: string };
        expect(badData.valid).toBe(false);
        expect(typeof badData.error).toBe("string");

        const badFlags = await server.call("regex.build", { source: "a", flags: "x" });
        expect(badFlags.ok).toBe(false);
        expect(badFlags.error).toContain("E_FLAGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.test returns matches with groups and named groups",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const digits = await server.call("regex.test", { pattern: "\\d+", text: "a1 bb22 ccc333" });
        expect(digits.ok).toBe(true);
        const digitsData = digits.data as {
          matches: Array<{ text: string; index: number }>;
          count: number;
          truncated: boolean;
        };
        expect(digitsData.count).toBe(3);
        expect(digitsData.truncated).toBe(false);
        expect(digitsData.matches[0]).toMatchObject({ text: "1", index: 1 });
        expect(digitsData.matches[2]).toMatchObject({ text: "333", index: 11 });

        const named = await server.call("regex.test", {
          pattern: "(?<y>\\d{4})-(?<m>\\d{2})",
          text: "2025-06 and 2024-01",
        });
        const namedData = named.data as {
          matches: Array<{ text: string; namedGroups: Record<string, string> }>;
        };
        expect(namedData.matches.length).toBe(2);
        expect(namedData.matches[0].namedGroups).toEqual({ y: "2025", m: "06" });
        expect(namedData.matches[1].namedGroups).toEqual({ y: "2024", m: "01" });

        const groups = await server.call("regex.test", { pattern: "(\\w+)@(\\w+)", text: "bob@host" });
        const groupsData = groups.data as { matches: Array<{ groups: unknown[] }> };
        expect(groupsData.matches[0].groups).toEqual(["bob", "host"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.test honors the i flag and truncates at 50 matches",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const insensitive = await server.call("regex.test", { pattern: "abc", flags: "i", text: "abc ABC abC" });
        expect((insensitive.data as { count: number }).count).toBe(3);

        const many = await server.call("regex.test", { pattern: "a", text: "a".repeat(60) });
        const manyData = many.data as { matches: unknown[]; count: number; truncated: boolean };
        expect(manyData.matches.length).toBe(50);
        expect(manyData.count).toBe(60);
        expect(manyData.truncated).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.test rejects invalid patterns and flags",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const badPattern = await server.call("regex.test", { pattern: "[nope", text: "x" });
        expect(badPattern.ok).toBe(false);
        expect(badPattern.error).toContain("E_REGEX");

        const badFlags = await server.call("regex.test", { pattern: "a", flags: "q", text: "a" });
        expect(badFlags.ok).toBe(false);
        expect(badFlags.error).toContain("E_FLAGS");

        const dupFlags = await server.call("regex.test", { pattern: "a", flags: "ii", text: "a" });
        expect(dupFlags.ok).toBe(false);
        expect(dupFlags.error).toContain("E_REGEX");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.escape escapes metacharacters only",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("regex.escape", { text: "a.b*c (d) [e] f$g^h?i|j+k" });
        expect(r.ok).toBe(true);
        expect((r.data as { escaped: string }).escaped).toBe("a\\.b\\*c \\(d\\) \\[e\\] f\\$g\\^h\\?i\\|j\\+k");

        const plain = await server.call("regex.escape", { text: "plain-words_1" });
        expect((plain.data as { escaped: string }).escaped).toBe("plain-words_1");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "regex.cheatsheet returns the static quick reference",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("regex.cheatsheet", {});
        expect(r.ok).toBe(true);
        const data = r.data as {
          categories: Array<{ name: string; items: Array<{ syntax: string; meaning: string }> }>;
          examples: Array<{ task: string; pattern: string }>;
        };
        expect(data.categories.length).toBeGreaterThanOrEqual(5);
        const anchors = data.categories.find((c) => c.name === "anchors");
        expect(anchors?.items.some((i) => i.syntax === "^")).toBe(true);
        expect(data.examples.length).toBeGreaterThanOrEqual(5);
        expect(data.examples.some((e) => e.task.includes("email"))).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "invalid args return -32602",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const missing = await server.call("regex.build", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const badType = await server.call("regex.escape", { text: 42 });
        expect(badType.ok).toBe(false);
        expect(badType.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
