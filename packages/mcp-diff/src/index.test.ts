// mcp-diff 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-diff (E2E)", () => {
  it(
    "exposes 3 diff.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["diff.files", "diff.similarity", "diff.texts"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.texts line mode returns patch, stats and unified",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("diff.texts", {
          a: "line1\nline2\nline3",
          b: "line1\nchanged\nline3\nline4",
        });
        expect(r.ok).toBe(true);
        const data = r.data as {
          unified: string;
          stats: { added: number; removed: number; changed: number };
          patch: Array<{ type: string; text: string }>;
        };
        expect(data.stats).toEqual({ added: 2, removed: 1, changed: 1 });
        expect(data.patch).toEqual([
          { type: "ctx", text: "line1" },
          { type: "del", text: "line2" },
          { type: "add", text: "changed" },
          { type: "ctx", text: "line3" },
          { type: "add", text: "line4" },
        ]);
        expect(data.unified).toBe(
          "--- a\n+++ b\n@@ -1,3 +1,4 @@\n line1\n-line2\n+changed\n line3\n+line4",
        );
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.texts reports identical texts with empty unified diff",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("diff.texts", { a: "same\ncontent", b: "same\ncontent" });
        expect(r.ok).toBe(true);
        const data = r.data as {
          unified: string;
          stats: { added: number; removed: number; changed: number };
          patch: Array<{ type: string }>;
        };
        expect(data.stats).toEqual({ added: 0, removed: 0, changed: 0 });
        expect(data.unified).toBe("");
        expect(data.patch.every((p) => p.type === "ctx")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.texts word mode diffs whitespace-split tokens",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("diff.texts", { a: "the quick fox", b: "the quick brown fox", mode: "word" });
        expect(r.ok).toBe(true);
        const data = r.data as {
          unified: string;
          stats: { added: number; removed: number; changed: number };
          patch: Array<{ type: string; text: string }>;
        };
        expect(data.stats).toEqual({ added: 1, removed: 0, changed: 0 });
        expect(data.patch).toEqual([
          { type: "ctx", text: "the" },
          { type: "ctx", text: "quick" },
          { type: "add", text: "brown" },
          { type: "ctx", text: "fox" },
        ]);
        expect(data.unified).toBe("--- a\n+++ b\n@@ -1,3 +1,4 @@\n the quick\n+brown\n fox");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.files diffs jailed files with labels and rejects missing/binary/escaping paths",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-diff-"));
      writeFileSync(join(root, "a.txt"), "alpha\nbeta\n");
      writeFileSync(join(root, "b.txt"), "alpha\nBETA\n");
      writeFileSync(join(root, "bin.dat"), "ok\0binary");
      const server = await spawnLiteServer(SERVER, { env: { MCP_DIFF_ROOTS: root } });
      try {
        const r = await server.call("diff.files", { pathA: "a.txt", pathB: "b.txt" });
        expect(r.ok).toBe(true);
        const data = r.data as { unified: string; stats: { removed: number; added: number; changed: number } };
        expect(data.stats).toEqual({ added: 1, removed: 1, changed: 1 });
        expect(data.unified).toContain("--- a.txt");
        expect(data.unified).toContain("-beta");
        expect(data.unified).toContain("+BETA");

        const missing = await server.call("diff.files", { pathA: "a.txt", pathB: "missing.txt" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const binary = await server.call("diff.files", { pathA: "a.txt", pathB: "bin.dat" });
        expect(binary.ok).toBe(false);
        expect(binary.error).toContain("E_BINARY");

        const escape = await server.call("diff.files", { pathA: "../outside.txt", pathB: "a.txt" });
        expect(escape.ok).toBe(false);
        expect(escape.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.similarity scores 100 / 0 / partial",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const same = await server.call("diff.similarity", { a: "abc\ndef", b: "abc\ndef" });
        expect((same.data as { similarity: number }).similarity).toBe(100);

        const disjoint = await server.call("diff.similarity", { a: "aaaa", b: "bbbb" });
        expect((disjoint.data as { similarity: number }).similarity).toBe(0);

        const partial = await server.call("diff.similarity", { a: "hello world", b: "hello there" });
        expect(partial.data).toMatchObject({ similarity: 63.6, lcsLength: 7, units: "chars" });

        const lines = await server.call("diff.similarity", { a: "x\ny\nz", b: "x\nz" });
        expect(lines.data).toMatchObject({ similarity: 66.7, units: "lines" });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "diff.texts rejects oversized inputs with E_TOO_LARGE",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const big = (prefix: string): string =>
          Array.from({ length: 2100 }, (_, i) => `${prefix}${i}`).join("\n");
        const r = await server.call("diff.texts", { a: big("a"), b: big("b") });
        expect(r.ok).toBe(false);
        expect(r.error).toContain("E_TOO_LARGE");
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
        const missing = await server.call("diff.texts", { a: "x" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const badMode = await server.call("diff.texts", { a: "x", b: "y", mode: "char" });
        expect(badMode.ok).toBe(false);
        expect(badMode.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
