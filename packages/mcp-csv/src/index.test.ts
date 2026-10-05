// mcp-csv 协议级 E2E：spawn 真子进程，覆盖引号转义/过滤/tojson/错误路径。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const SAMPLE = `name,score,note
alice,90,"she said ""hi"""
bob,72,"multi
line note"
carol,85,plain
`;

describe("mcp-csv (E2E)", () => {
  it(
    "exposes 4 csv tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "csv.filter",
          "csv.parse",
          "csv.stringify",
          "csv.tojson",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.parse handles quote escaping and newlines inside quoted fields",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("csv.parse", { text: SAMPLE });
        expect(result.ok).toBe(true);
        const data = result.data as { columns: string[]; rows: string[][]; rowCount: number; truncated: boolean };
        expect(data.columns).toEqual(["name", "score", "note"]);
        expect(data.rowCount).toBe(3);
        expect(data.truncated).toBe(false);
        expect(data.rows[0]).toEqual(["alice", "90", 'she said "hi"']);
        expect(data.rows[1]).toEqual(["bob", "72", "multi\nline note"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.parse supports custom delimiter and headerless input",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("csv.parse", { text: "a;b;c\n1;2;3\n", delimiter: ";", hasHeader: false });
        expect(result.ok).toBe(true);
        const data = result.data as { rows: string[][]; rowCount: number };
        expect(data.rows).toEqual([
          ["a", "b", "c"],
          ["1", "2", "3"],
        ]);
        expect(data.rowCount).toBe(2);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.stringify quotes fields containing delimiters, quotes and newlines",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("csv.stringify", {
          rows: [
            ["plain", "10"],
            ['has "quotes"', "line1\nline2"],
            ["with,comma", "x"],
          ],
          columns: ["name", "value"],
        });
        expect(result.ok).toBe(true);
        const data = result.data as { text: string; rowCount: number };
        expect(data.text).toContain('"has ""quotes""","line1\nline2"');
        expect(data.text).toContain('"with,comma",x');
        expect(data.text.startsWith("name,value\n")).toBe(true);
        expect(data.rowCount).toBe(3);

        // round-trip: parse what we just produced
        const parsed = await server.call("csv.parse", { text: data.text });
        expect((parsed.data as { rows: string[][] }).rows).toEqual([
          ["plain", "10"],
          ['has "quotes"', "line1\nline2"],
          ["with,comma", "x"],
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.filter filters by equals/contains and numeric gt",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const equals = await server.call("csv.filter", { text: SAMPLE, column: "name", op: "equals", value: "bob" });
        expect((equals.data as { rows: string[][] }).rows).toEqual([["bob", "72", "multi\nline note"]]);

        const contains = await server.call("csv.filter", { text: SAMPLE, column: "name", op: "contains", value: "l" });
        expect(((contains.data as { rows: string[][] }).rows).length).toBe(2); // alice, carol

        const gt = await server.call("csv.filter", { text: SAMPLE, column: "score", op: "gt", value: "80" });
        expect(((gt.data as { rows: string[][] }).rows).length).toBe(2); // alice 90, carol 85
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.filter reports unknown columns and non-numeric comparisons",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const unknown = await server.call("csv.filter", { text: SAMPLE, column: "nope", op: "equals", value: "x" });
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain("E_COLUMN");

        const nonNumeric = await server.call("csv.filter", { text: SAMPLE, column: "score", op: "gt", value: "abc" });
        expect(nonNumeric.ok).toBe(false);
        expect(nonNumeric.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "csv.tojson returns row objects keyed by header",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("csv.tojson", { text: SAMPLE });
        expect(result.ok).toBe(true);
        const data = result.data as { rows: Array<Record<string, string>>; rowCount: number };
        expect(data.rows[0]).toEqual({ name: "alice", score: "90", note: 'she said "hi"' });
        expect(data.rowCount).toBe(3);

        const headerless = await server.call("csv.tojson", { text: "a,b\n1,2\n", hasHeader: false });
        expect((headerless.data as { rows: Array<Record<string, string>> }).rows).toEqual([
          { "0": "a", "1": "b" },
          { "0": "1", "1": "2" },
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "invalid tool arguments return JSON-RPC -32602",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("csv.parse", { text: 42 });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
