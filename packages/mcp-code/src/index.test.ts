// mcp-code 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const TS_SRC = [
  'import { defineTool } from "@videoos/mcp-lite";', // 1
  'import path from "node:path";', // 2
  "export function alpha() {", // 3
  "  return 1;", // 4
  "}", // 5
  "const beta = (x) => x + 1;", // 6
  "export const gamma = async (a, b) => a + b;", // 7
  "class Dog extends Animal {", // 8
  "  bark() {}", // 9
  "}", // 10
  "export default class Tool {}", // 11
].join("\n");

const PY_SRC = [
  "import os", // 1
  "import sys, json", // 2
  "from typing import List", // 3
  "", // 4
  "def add(a, b):", // 5
  "    return a + b", // 6
  "", // 7
  "async def fetch(url):", // 8
  "    return url", // 9
  "", // 10
  "class Greeter(Base):", // 11
  "    pass", // 12
].join("\n");

describe("mcp-code (E2E)", () => {
  it(
    "exposes 4 code.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "code.languages",
          "code.stats",
          "code.symbols",
          "code.todos",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.stats classifies ts lines including block comments",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.stats", {
          text: ["// header comment", "const a = 1; // trailing counts as code", "", "/* block", "   comment */", "function foo() {", "  return 1;", "}"].join("\n"),
          language: "ts",
        });
        expect(r.ok).toBe(true);
        expect(r.data).toMatchObject({
          total: 8,
          code: 4,
          comment: 3,
          blank: 1,
          commentRatio: 0.4286,
          language: "ts",
        });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.stats classifies python # comments and auto-detects language",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.stats", {
          text: ["# comment header", "def foo():", "    # inner comment", "    return 1", "", "def bar():", "    return 2"].join("\n"),
        });
        expect(r.ok).toBe(true);
        expect(r.data).toMatchObject({
          total: 7,
          code: 4,
          comment: 2,
          blank: 1,
          commentRatio: 0.3333,
          language: "py",
        });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.symbols extracts ts functions, classes and imports with line numbers",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.symbols", { text: TS_SRC, language: "ts" });
        expect(r.ok).toBe(true);
        const data = r.data as {
          language: string;
          functions: Array<{ name: string; line: number; async?: true }>;
          classes: Array<{ name: string; line: number; extends?: string }>;
          imports: Array<{ module: string; line: number }>;
        };
        expect(data.language).toBe("ts");
        expect(data.functions).toEqual([
          { name: "alpha", line: 3 },
          { name: "beta", line: 6 },
          { name: "gamma", line: 7, async: true },
        ]);
        expect(data.classes).toEqual([
          { name: "Dog", line: 8, extends: "Animal" },
          { name: "Tool", line: 11 },
        ]);
        expect(data.imports).toEqual([
          { module: "@videoos/mcp-lite", line: 1 },
          { module: "node:path", line: 2 },
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.symbols extracts python def/class/import and auto-detects py",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.symbols", { text: PY_SRC });
        expect(r.ok).toBe(true);
        const data = r.data as {
          language: string;
          functions: Array<{ name: string; line: number; async?: true }>;
          classes: Array<{ name: string; line: number; extends?: string }>;
          imports: Array<{ module: string; line: number }>;
        };
        expect(data.language).toBe("py");
        expect(data.functions).toEqual([
          { name: "add", line: 5 },
          { name: "fetch", line: 8, async: true },
        ]);
        expect(data.classes).toEqual([{ name: "Greeter", line: 11, extends: "Base" }]);
        expect(data.imports).toEqual([
          { module: "os", line: 1 },
          { module: "sys", line: 2 },
          { module: "json", line: 2 },
          { module: "typing", line: 3 },
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.symbols handles go / json auto-detection",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const go = await server.call("code.symbols", {
          text: ['package main', "", 'import (', '\t"fmt"', ')', "", "func main() {", '\tfmt.Println("hi")', "}"].join("\n"),
        });
        const goData = go.data as {
          language: string;
          functions: Array<{ name: string; line: number }>;
          imports: Array<{ module: string; line: number }>;
        };
        expect(goData.language).toBe("go");
        expect(goData.functions).toEqual([{ name: "main", line: 7 }]);
        expect(goData.imports).toEqual([{ module: "fmt", line: 4 }]);

        const json = await server.call("code.symbols", { text: '{ "a": 1 }' });
        const jsonData = json.data as { language: string; functions: unknown[] };
        expect(jsonData.language).toBe("json");
        expect(jsonData.functions).toEqual([]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.todos finds markers with text and line numbers",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.todos", {
          text: ["// TODO: implement alpha", "// FIXME(a): broken beta", "const x = 1; // HACK swap later", "# NOTE python note", "nothing here"].join("\n"),
        });
        expect(r.ok).toBe(true);
        const data = r.data as { todos: Array<{ kind: string; text: string; line: number }>; count: number };
        expect(data.count).toBe(4);
        expect(data.todos).toEqual([
          { kind: "TODO", text: "implement alpha", line: 1 },
          { kind: "FIXME", text: "(a): broken beta", line: 2 },
          { kind: "HACK", text: "swap later", line: 3 },
          { kind: "NOTE", text: "python note", line: 4 },
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "code.languages lists the supported language table",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("code.languages", {});
        expect(r.ok).toBe(true);
        const data = r.data as {
          languages: Array<{ id: string; name: string; extensions: string[]; lineComment: string | null }>;
          count: number;
        };
        expect(data.count).toBe(9);
        const ts = data.languages.find((l) => l.id === "ts");
        expect(ts?.extensions).toContain(".ts");
        expect(ts?.lineComment).toBe("//");
        const py = data.languages.find((l) => l.id === "py");
        expect(py?.extensions).toContain(".py");
        expect(py?.lineComment).toBe("#");
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
        const missing = await server.call("code.stats", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const badLang = await server.call("code.stats", { text: "x", language: "ruby" });
        expect(badLang.ok).toBe(false);
        expect(badLang.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
