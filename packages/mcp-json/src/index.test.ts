// mcp-json 协议级 E2E：spawn 真子进程走完整 JSON-RPC 握手。纯文本工具，全部确定性输入输出。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const DOC = '{"a":{"b":[{"c":1},{"c":2}]},"n":null,"s":"txt"}';

describe("mcp-json (E2E)", () => {
  it(
    "exposes 5 json tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "json.format",
          "json.query",
          "json.set",
          "json.stats",
          "json.validate",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.validate accepts valid text with stats",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("json.validate", { text: '{"a":{"b":1},"c":[1,2,null,"s"]}' });
        expect(result.ok).toBe(true);
        const data = result.data as {
          valid: boolean;
          stats: { keys: number; maxDepth: number; sizeBytes: number; typeCounts: Record<string, number> };
        };
        expect(data.valid).toBe(true);
        expect(data.stats.keys).toBe(3);
        expect(data.stats.maxDepth).toBe(2);
        expect(data.stats.typeCounts).toEqual({ object: 2, array: 1, string: 1, number: 3, boolean: 0, null: 1 });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.validate pinpoints syntax errors with line/column",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const missingValue = await server.call("json.validate", { text: '{\n  "a": 1,\n  "b": }' });
        expect(missingValue.ok).toBe(true);
        const mv = missingValue.data as { valid: boolean; errors: Array<{ path: string; message: string }> };
        expect(mv.valid).toBe(false);
        expect(mv.errors).toHaveLength(1);
        expect(mv.errors[0]?.path).toBe("$");
        expect(mv.errors[0]?.message).toMatch(/line 3, column 8/);

        const badLiteral = await server.call("json.validate", { text: '{"a": tru}' });
        const bl = badLiteral.data as { valid: boolean; errors: Array<{ message: string }> };
        expect(bl.valid).toBe(false);
        expect(bl.errors[0]?.message).toMatch(/line 1, column 7/);

        const trailing = await server.call("json.validate", { text: '{"a":1} extra' });
        const tr = trailing.data as { valid: boolean; errors: Array<{ message: string }> };
        expect(tr.valid).toBe(false);
        expect(tr.errors[0]?.message).toContain("after JSON value");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.format pretty-prints and compacts",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const pretty = await server.call("json.format", { text: '{"b":1,"a":[1,2]}', indent: 2 });
        expect(pretty.ok).toBe(true);
        const p = pretty.data as { text: string };
        expect(p.text).toContain('\n  "b": 1,');
        expect(p.text).toContain('\n    1,');
        expect(JSON.parse(p.text)).toEqual({ b: 1, a: [1, 2] });

        const compact = await server.call("json.format", { text: '{\n  "b": 1,\n  "a": [1, 2]\n}', indent: 0 });
        const c = compact.data as { text: string };
        expect(c.text).not.toContain("\n");
        expect(JSON.parse(c.text)).toEqual({ b: 1, a: [1, 2] });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.format rejects oversized input with E_SIZE and bad input with E_PARSE",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const big = `{"pad":"${"x".repeat(1_048_580)}"}`;
        const size = await server.call("json.format", { text: big });
        expect(size.ok).toBe(false);
        expect(size.error).toContain("E_SIZE");

        const bad = await server.call("json.format", { text: '{"a": }' });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_PARSE");
        expect(bad.error).toContain("line 1");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.query walks paths ($.a.b[0].c, bare keys, quoted keys) and reports found:false when absent",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const deep = await server.call("json.query", { text: DOC, path: "$.a.b[1].c" });
        expect(deep.data).toMatchObject({ found: true, value: 2 });

        const bare = await server.call("json.query", { text: DOC, path: "a.b[0].c" });
        expect(bare.data).toMatchObject({ found: true, value: 1 });

        const quoted = await server.call("json.query", { text: DOC, path: '$.a["b"][0]["c"]' });
        expect(quoted.data).toMatchObject({ found: true, value: 1 });

        const whole = await server.call("json.query", { text: DOC, path: "$" });
        expect(whole.data).toMatchObject({ found: true, value: JSON.parse(DOC) });

        const nullValue = await server.call("json.query", { text: DOC, path: "$.n" });
        expect(nullValue.data).toMatchObject({ found: true, value: null });

        const outOfRange = await server.call("json.query", { text: DOC, path: "$.a.b[9]" });
        expect(outOfRange.data).toMatchObject({ found: false });

        const missing = await server.call("json.query", { text: DOC, path: "$.missing" });
        expect(missing.data).toMatchObject({ found: false });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.set overwrites existing values and preserves the rest",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("json.set", { text: '{"a":1,"keep":{"x":true}}', path: "$.a", value: "42" });
        expect(result.ok).toBe(true);
        const out = (result.data as { text: string }).text;
        expect(JSON.parse(out)).toEqual({ a: 42, keep: { x: true } });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.set creates missing containers along the path (objects and arrays)",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("json.set", { text: '{"a":1}', path: "$.b.c[2].d", value: "true" });
        expect(result.ok).toBe(true);
        const out = JSON.parse((result.data as { text: string }).text) as unknown;
        expect(out).toEqual({ a: 1, b: { c: [null, null, { d: true }] } });

        // 字符串值必须 JSON 编码（"\"hi\""），对象值传 JSON 文本
        const str = await server.call("json.set", { text: "{}", path: "$.msg", value: '"hi"' });
        expect(JSON.parse((str.data as { text: string }).text)).toEqual({ msg: "hi" });

        const obj = await server.call("json.set", { text: "{}", path: "$.conf", value: '{"size":1080,"tags":["a","b"]}' });
        expect(JSON.parse((obj.data as { text: string }).text)).toEqual({ conf: { size: 1080, tags: ["a", "b"] } });

        // 整根替换
        const root = await server.call("json.set", { text: '{"old":1}', path: "$", value: "[1,2]" });
        expect(JSON.parse((root.data as { text: string }).text)).toEqual([1, 2]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.set error paths: E_VALUE (bad value JSON), E_PATH (bad path / type conflicts)",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const badValue = await server.call("json.set", { text: "{}", path: "$.a", value: "{bad" });
        expect(badValue.ok).toBe(false);
        expect(badValue.error).toContain("E_VALUE");

        const badPath = await server.call("json.set", { text: "{}", path: "$.a[", value: "1" });
        expect(badPath.ok).toBe(false);
        expect(badPath.error).toContain("E_PATH");

        const conflict = await server.call("json.set", { text: '{"a":5}', path: "$.a.b", value: "1" });
        expect(conflict.ok).toBe(false);
        expect(conflict.error).toContain("E_PATH");

        const badDoc = await server.call("json.set", { text: "{oops}", path: "$.a", value: "1" });
        expect(badDoc.ok).toBe(false);
        expect(badDoc.error).toContain("E_PARSE");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "json.stats counts keys/depth/types/bytes",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const text = '{"a":{"b":1},"c":[1,2,null,"s"]}';
        const result = await server.call("json.stats", { text });
        expect(result.ok).toBe(true);
        const stats = result.data as { keys: number; maxDepth: number; sizeBytes: number; typeCounts: Record<string, number> };
        expect(stats.keys).toBe(3);
        expect(stats.maxDepth).toBe(2);
        expect(stats.sizeBytes).toBe(Buffer.byteLength(text, "utf8"));
        expect(stats.typeCounts).toEqual({ object: 2, array: 1, string: 1, number: 3, boolean: 0, null: 1 });

        const scalar = await server.call("json.stats", { text: "42" });
        const s = scalar.data as { keys: number; maxDepth: number; typeCounts: Record<string, number> };
        expect(s.keys).toBe(0);
        expect(s.maxDepth).toBe(0);
        expect(s.typeCounts).toEqual({ object: 0, array: 0, string: 0, number: 1, boolean: 0, null: 0 });
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
        const missing = await server.call("json.validate", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const indent = await server.call("json.format", { text: "1", indent: 99 });
        expect(indent.ok).toBe(false);
        expect(indent.error).toContain("-32602");

        const opType = await server.call("json.query", { text: "1", path: 42 });
        expect(opType.ok).toBe(false);
        expect(opType.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
