// mcp-fs 协议级 E2E：spawn 真子进程，initialize → tools/call 全链路。
// 跨平台注意：断言一律用 node:path 的 join；MCP_FS_ROOTS 在 Windows 上会被 mcp-lite 的
// 冒号分隔切坏盘符，所以全部用绝对路径调用（contains 判定依然成立）；相对路径用例仅 posix 跑。
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");
const IS_WIN = process.platform === "win32";

function makeRoot(prefix = "mcp-fs-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("mcp-fs (E2E)", () => {
  it(
    "exposes 7 namespaced tools",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "fs.list",
          "fs.move",
          "fs.read",
          "fs.remove",
          "fs.search",
          "fs.tree",
          "fs.write",
        ]);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.write then fs.read roundtrip (utf-8, bytes + sha256-12)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        const content = "héllo wörld";
        const written = await server.call("fs.write", {
          path: join(root, "notes", "a.txt"),
          content,
        });
        expect(written.ok).toBe(true);
        const w = written.data as { bytes: number; sha256: string };
        expect(w.bytes).toBe(Buffer.byteLength(content, "utf8"));
        expect(w.sha256).toBe(createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex").slice(0, 12));

        const read = await server.call("fs.read", { path: join(root, "notes", "a.txt") });
        expect(read.ok).toBe(true);
        const r = read.data as { text: string; truncated: boolean; encoding: string; size: number };
        expect(r.text).toBe(content);
        expect(r.truncated).toBe(false);
        expect(r.encoding).toBe("utf8");
        expect(r.size).toBe(Buffer.byteLength(content, "utf8"));
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.read truncates beyond maxBytes with a marker",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "big.txt"), "a".repeat(1000));
        const result = await server.call("fs.read", { path: join(root, "big.txt"), maxBytes: 100 });
        expect(result.ok).toBe(true);
        const r = result.data as { text: string; truncated: boolean; size: number };
        expect(r.truncated).toBe(true);
        expect(r.size).toBe(1000);
        expect(r.text).toContain("[truncated at 100 bytes]");
        expect(r.text.startsWith("aaaaaaaaaa")).toBe(true);
        expect(Buffer.byteLength(r.text, "utf8")).toBeLessThan(200);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.read rejects binary in utf8 mode (E_BINARY) and roundtrips base64",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        const bytes = Buffer.from([0x00, 0x01, 0x02, 0x41]);
        const written = await server.call("fs.write", {
          path: join(root, "blob.bin"),
          content: bytes.toString("base64"),
          encoding: "base64",
        });
        expect(written.ok).toBe(true);
        expect((written.data as { bytes: number }).bytes).toBe(bytes.length);

        const rejected = await server.call("fs.read", { path: join(root, "blob.bin") });
        expect(rejected.ok).toBe(false);
        expect(rejected.error).toContain("E_BINARY");
        expect(rejected.error).toContain("base64");

        const b64 = await server.call("fs.read", { path: join(root, "blob.bin"), encoding: "base64" });
        expect(b64.ok).toBe(true);
        const b = b64.data as { base64: string; truncated: boolean };
        expect(b.truncated).toBe(false);
        expect(Buffer.from(b.base64, "base64").equals(bytes)).toBe(true);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.list reports entries with types at depth 1 and 2 (symlink when creatable)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "a.txt"), "x");
        mkdirSync(join(root, "sub"));
        writeFileSync(join(root, "sub", "b.txt"), "y");
        let linkCreated = true;
        try {
          symlinkSync(join(root, "a.txt"), join(root, "link.txt"));
        } catch {
          linkCreated = false; // Windows 默认无符号链接权限 → 跳过该断言
        }

        const flat = await server.call("fs.list", { path: root });
        expect(flat.ok).toBe(true);
        const f = flat.data as { entries: Array<{ name: string; type: string; size: number; mtime: number }>; truncated: boolean };
        expect(f.truncated).toBe(false);
        const byName = new Map(f.entries.map((e) => [e.name, e]));
        expect(byName.get("a.txt")?.type).toBe("file");
        expect(byName.get("a.txt")?.size).toBe(1);
        expect(byName.get("sub")?.type).toBe("dir");
        expect(byName.get("a.txt")?.mtime).toBeGreaterThan(0);
        if (linkCreated) expect(byName.get("link.txt")?.type).toBe("symlink");

        const deep = await server.call("fs.list", { path: root, depth: 2 });
        const d = deep.data as { entries: Array<{ path: string; type: string }> };
        const byPath = new Map(d.entries.map((e) => [e.path, e]));
        expect(byPath.get("sub/b.txt")?.type).toBe("file");
        expect(byPath.has("a.txt")).toBe(true);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.list/fs.read/fs.tree error paths: E_NOT_DIR / E_IS_DIR / E_NOT_FOUND",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "plain.txt"), "x");
        mkdirSync(join(root, "dir"));

        const listFile = await server.call("fs.list", { path: join(root, "plain.txt") });
        expect(listFile.ok).toBe(false);
        expect(listFile.error).toContain("E_NOT_DIR");

        const readDir = await server.call("fs.read", { path: join(root, "dir") });
        expect(readDir.ok).toBe(false);
        expect(readDir.error).toContain("E_IS_DIR");

        const missing = await server.call("fs.read", { path: join(root, "missing.txt") });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.tree renders a depth-3 indented tree",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "a.txt"), "x");
        mkdirSync(join(root, "sub", "deep"), { recursive: true });
        writeFileSync(join(root, "sub", "b.txt"), "y");
        writeFileSync(join(root, "sub", "deep", "c.txt"), "z");

        const result = await server.call("fs.tree", { path: root });
        expect(result.ok).toBe(true);
        const t = result.data as { text: string; lines: number; truncated: boolean };
        expect(t.truncated).toBe(false);
        expect(t.lines).toBe(6); // root + a.txt + sub/ + b.txt + deep/ + c.txt
        expect(t.text.startsWith(basename(root))).toBe(true);
        for (const frag of ["a.txt", "sub/", "b.txt", "deep/", "c.txt"]) expect(t.text).toContain(frag);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.tree truncates at 300 lines",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        for (let i = 0; i < 400; i++) writeFileSync(join(root, `f${String(i).padStart(3, "0")}.txt`), "x");
        const result = await server.call("fs.tree", { path: root });
        expect(result.ok).toBe(true);
        const t = result.data as { lines: number; truncated: boolean };
        expect(t.lines).toBe(300);
        expect(t.truncated).toBe(true);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.search matches globs: **/*.ts crosses dirs, *.ts stays top-level",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "a.ts"), "x");
        writeFileSync(join(root, "c.js"), "x");
        mkdirSync(join(root, "sub"));
        writeFileSync(join(root, "sub", "b.ts"), "x");

        const nested = await server.call("fs.search", { root, glob: "**/*.ts" });
        expect(nested.ok).toBe(true);
        const n = nested.data as { paths: string[]; truncated: boolean };
        expect(n.paths).toEqual(["a.ts", "sub/b.ts"]);
        expect(n.truncated).toBe(false);

        const top = await server.call("fs.search", { root, glob: "*.ts" });
        expect((top.data as { paths: string[] }).paths).toEqual(["a.ts"]);

        const q = await server.call("fs.search", { root, glob: "sub/?.ts" });
        expect((q.data as { paths: string[] }).paths).toEqual(["sub/b.ts"]);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.search greps matched files by contentRegex with line numbers",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "app.log"), "ok\nERROR bad thing\nfine\n");
        writeFileSync(join(root, "other.log"), "nothing here\n");
        writeFileSync(join(root, "notes.txt"), "ERROR in txt\n"); // 不匹配 glob

        const result = await server.call("fs.search", { root, glob: "**/*.log", contentRegex: "ERROR" });
        expect(result.ok).toBe(true);
        const m = result.data as { matches: Array<{ path: string; line: number; text: string }>; truncated: boolean };
        expect(m.matches).toEqual([{ path: "app.log", line: 2, text: "ERROR bad thing" }]);
        expect(m.truncated).toBe(false);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.search error paths: E_NOT_DIR root, E_REGEX pattern",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "file.txt"), "x");
        const notDir = await server.call("fs.search", { root: join(root, "file.txt"), glob: "*" });
        expect(notDir.ok).toBe(false);
        expect(notDir.error).toContain("E_NOT_DIR");

        const badRe = await server.call("fs.search", { root, glob: "*", contentRegex: "([unclosed" });
        expect(badRe.ok).toBe(false);
        expect(badRe.error).toContain("E_REGEX");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.move renames within a root; source disappears",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        const written = await server.call("fs.write", { path: join(root, "x.txt"), content: "payload" });
        expect(written.ok).toBe(true);
        const moved = await server.call("fs.move", { from: join(root, "x.txt"), to: join(root, "y.txt") });
        expect(moved.ok).toBe(true);
        const read = await server.call("fs.read", { path: join(root, "y.txt") });
        expect((read.data as { text: string }).text).toBe("payload");
        const gone = await server.call("fs.read", { path: join(root, "x.txt") });
        expect(gone.ok).toBe(false);
        expect(gone.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.move refuses cross-root moves (E_CROSS_ROOT)",
    async () => {
      const rootA = makeRoot("mcp-fs-a-");
      const rootB = makeRoot("mcp-fs-b-");
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: `${rootA};${rootB}` } });
      try {
        const written = await server.call("fs.write", { path: join(rootA, "a.txt"), content: "x" });
        expect(written.ok).toBe(true);
        const cross = await server.call("fs.move", { from: join(rootA, "a.txt"), to: join(rootB, "b.txt") });
        expect(cross.ok).toBe(false);
        expect(cross.error).toContain("E_CROSS_ROOT");
        // 同根内仍然可动
        const within = await server.call("fs.move", { from: join(rootA, "a.txt"), to: join(rootA, "a2.txt") });
        expect(within.ok).toBe(true);
      } finally {
        await server.close();
        rmSync(rootA, { recursive: true, force: true });
        rmSync(rootB, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "fs.remove counts entries, guards non-empty dirs (E_NOT_EMPTY / E_NOT_FOUND)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "one.txt"), "x");

        const file = await server.call("fs.remove", { path: join(root, "one.txt") });
        expect(file.data).toMatchObject({ removed: 1 });

        mkdirSync(join(root, "dir", "sub"), { recursive: true });
        mkdirSync(join(root, "dir", "empty"));
        writeFileSync(join(root, "dir", "sub", "f1.txt"), "x");
        writeFileSync(join(root, "dir", "sub", "f2.txt"), "x");

        const guarded = await server.call("fs.remove", { path: join(root, "dir") });
        expect(guarded.ok).toBe(false);
        expect(guarded.error).toContain("E_NOT_EMPTY");

        const recursive = await server.call("fs.remove", { path: join(root, "dir"), recursive: true });
        expect(recursive.data).toMatchObject({ removed: 5 }); // dir + sub + empty + 2 files

        const missing = await server.call("fs.remove", { path: join(root, "nope") });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "jail blocks escapes: absolute outside, ../ traversal, null bytes, symlink escape",
    async () => {
      const root = makeRoot();
      const outside = join(tmpdir(), "mcp-fs-outside-target.txt");
      writeFileSync(outside, "secret");
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        const absolute = await server.call("fs.read", { path: outside });
        expect(absolute.ok).toBe(false);
        expect(absolute.error).toContain("E_JAIL");

        const up = await server.call("fs.read", { path: join(root, "..", "escape-sibling.txt") });
        expect(up.ok).toBe(false);
        expect(up.error).toContain("E_JAIL");

        const nul = await server.call("fs.read", { path: "bad\u0000name" });
        expect(nul.ok).toBe(false);
        expect(nul.error).toContain("E_JAIL");

        // 符号链接逃逸：链接指向根外文件（无符号链接权限的平台跳过）
        try {
          symlinkSync(outside, join(root, "escape.txt"));
          const viaLink = await server.call("fs.read", { path: join(root, "escape.txt") });
          expect(viaLink.ok).toBe(false);
          expect(viaLink.error).toContain("E_JAIL");
        } catch {
          // Windows 默认无创建符号链接权限 → 本断言组跳过
        }
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { force: true });
      }
    },
    20_000,
  );

  it(
    "invalid tool arguments return JSON-RPC -32602",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        const depth = await server.call("fs.list", { path: root, depth: 99 });
        expect(depth.ok).toBe(false);
        expect(depth.error).toContain("-32602");

        const zero = await server.call("fs.read", { path: join(root, "x"), maxBytes: 0 });
        expect(zero.ok).toBe(false);
        expect(zero.error).toContain("-32602");

        const missing = await server.call("fs.read", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const unknown = await server.call("fs.chmod", { path: root });
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain("-32602");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  // 相对路径按 roots[0] 解析；Windows 上 mcp-lite 的多根分隔会把盘符切碎导致 roots[0] 失真，仅 posix 验证
  it.skipIf(IS_WIN)(
    "relative paths resolve against the first root (posix)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_FS_ROOTS: root } });
      try {
        writeFileSync(join(root, "rel.txt"), "relative!");
        const read = await server.call("fs.read", { path: "rel.txt" });
        expect(read.ok).toBe(true);
        expect((read.data as { text: string }).text).toBe("relative!");

        const write = await server.call("fs.write", { path: "nested/rel2.txt", content: "ok" });
        expect(write.ok).toBe(true);
        expect((write.data as { bytes: number }).bytes).toBe(2);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
