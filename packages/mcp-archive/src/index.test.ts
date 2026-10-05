// mcp-archive 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
// 覆盖：pack→list→extract 内容级 roundtrip、>500 条目截断、手工构造 tar-slip 攻击样本（E_JAIL）、
// 非 tar 文件（E_TAR）、越狱（E_JAIL）、符号链接拒绝（E_SYMLINK）。
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

/** 手工构造 ustar 头（测试夹具：与实现同规格，用于攻击样本） */
function buildTarHeader(name: string, size: number, typeflag: "0" | "5" | "3"): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, "utf8");
  const oct = (value: number, offset: number, length: number): void => {
    buf.write(Math.max(0, value).toString(8).padStart(length - 1, "0"), offset, "utf8");
  };
  oct(0o644, 100, 8);
  oct(0, 108, 8);
  oct(0, 116, 8);
  oct(size, 124, 12);
  oct(Math.floor(Date.now() / 1000), 136, 12);
  buf.write("        ", 148, "utf8");
  buf.write(typeflag, 156, "utf8");
  buf.write("ustar\0", 257, "utf8");
  buf.write("00", 263, "utf8");
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0"), 148, "utf8");
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

function tarFileEntry(name: string, content: string): Buffer[] {
  const data = Buffer.from(content, "utf8");
  const pad = (512 - (data.length % 512)) % 512;
  return [buildTarHeader(name, data.length, "0"), data, Buffer.alloc(pad)];
}

function buildTar(entryBufs: Buffer[]): Buffer {
  return Buffer.concat([...entryBufs, Buffer.alloc(1024)]); // end 标记两块
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "mcp-archive-"));
}

describe("mcp-archive (E2E)", () => {
  it(
    "exposes 3 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["archive.extract", "archive.list", "archive.pack"]);
        expect(server.serverInfo.name).toBe("mcp-archive");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "pack → list → extract roundtrip preserves file contents",
    async () => {
      const root = makeRoot();
      const srcDir = join(root, "src");
      mkdirSync(join(srcDir, "sub"), { recursive: true });
      const files: Array<[string, string]> = [
        ["a.txt", "alpha-content"],
        ["b.txt", "beta content with spaces"],
        ["c.txt", "gamma"],
        ["sub/nested.txt", "nested content: 你好世界"],
      ];
      for (const [rel, content] of files) writeFileSync(join(srcDir, rel), content);

      const server = await spawnLiteServer(SERVER, { env: { MCP_ARCHIVE_ROOTS: root } });
      try {
        const pack = await server.call("archive.pack", { dir: "src", output: "out.tar.gz" });
        expect(pack.ok).toBe(true);
        const packData = pack.data as { output: string; files: number; entries: number; bytes: number };
        expect(packData.files).toBe(4);
        expect(packData.entries).toBe(5); // 4 文件 + sub/ 目录条目
        expect(packData.bytes).toBeGreaterThan(0);
        expect(existsSync(join(root, "out.tar.gz"))).toBe(true);

        const list = await server.call("archive.list", { path: "out.tar.gz" });
        expect(list.ok).toBe(true);
        const listData = list.data as {
          format: string;
          count: number;
          truncated: boolean;
          entries: Array<{ path: string; size: number; mode: string; type: string }>;
        };
        expect(listData.format).toBe("tar.gz");
        expect(listData.count).toBe(5);
        expect(listData.truncated).toBe(false);
        const paths = listData.entries.map((e) => e.path);
        expect(paths).toContain("sub/");
        expect(paths).toContain("sub/nested.txt");
        const nested = listData.entries.find((e) => e.path === "sub/nested.txt")!;
        expect(nested.size).toBe(Buffer.byteLength("nested content: 你好世界", "utf8"));
        expect(nested.type).toBe("file");
        expect(nested.mode).toMatch(/^[0-7]{3,4}$/); // 具体值取决于 umask，只断言八进制形状

        const extract = await server.call("archive.extract", { path: "out.tar.gz", destDir: "restored" });
        expect(extract.ok).toBe(true);
        expect(extract.data).toMatchObject({ files: 4, entries: 5 });
        for (const [rel, content] of files) {
          expect(readFileSync(join(root, "restored", rel), "utf8")).toBe(content);
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "archive.list paginates beyond 500 entries",
    async () => {
      const root = makeRoot();
      const manyDir = join(root, "many");
      mkdirSync(manyDir);
      for (let i = 0; i < 505; i++) {
        writeFileSync(join(manyDir, `f${String(i).padStart(3, "0")}.txt`), String(i));
      }
      const server = await spawnLiteServer(SERVER, { env: { MCP_ARCHIVE_ROOTS: root } });
      try {
        const pack = await server.call("archive.pack", { dir: "many", output: "many.tar.gz" });
        expect((pack.data as { files: number }).files).toBe(505);
        const list = await server.call("archive.list", { path: "many.tar.gz" });
        const listData = list.data as { count: number; truncated: boolean; entries: unknown[] };
        expect(listData.count).toBe(505);
        expect(listData.truncated).toBe(true);
        expect(listData.entries).toHaveLength(500);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "rejects tar-slip attacks (../, absolute paths, device entries) without writing anything",
    async () => {
      const root = makeRoot();
      // 手工构造攻击 tar：正常条目 + ../ 穿越 + 绝对路径 + 设备文件
      const attack = buildTar([
        ...tarFileEntry("good.txt", "hello"),
        ...tarFileEntry("../evil.txt", "pwned"),
        ...tarFileEntry("/abs/evil.txt", "abs"),
        buildTarHeader("devnode", 0, "3"), // char device
      ]);
      writeFileSync(join(root, "slip.tar"), attack);

      const server = await spawnLiteServer(SERVER, { env: { MCP_ARCHIVE_ROOTS: root } });
      try {
        // list 不做路径安全检查（只读），应能列出 4 条
        const list = await server.call("archive.list", { path: "slip.tar" });
        expect(list.ok).toBe(true);
        expect((list.data as { format: string; count: number }).format).toBe("tar"); // 非 gz 的纯 tar 解析
        expect((list.data as { count: number }).count).toBe(4);

        const extract = await server.call("archive.extract", { path: "slip.tar", destDir: "out" });
        expect(extract.ok).toBe(false);
        expect(extract.error).toContain("E_JAIL");

        // 两遍扫描：攻击条目导致全量拒绝 —— 目标目录与监狱外都不应有任何文件
        expect(existsSync(join(root, "out"))).toBe(false);
        expect(existsSync(join(root, "evil.txt"))).toBe(false);
        expect(existsSync(join(root, "..", "evil.txt"))).toBe(false);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "rejects non-tar files and missing paths",
    async () => {
      const root = makeRoot();
      writeFileSync(join(root, "bogus.tar"), "this is definitely not a tar archive");
      const server = await spawnLiteServer(SERVER, { env: { MCP_ARCHIVE_ROOTS: root } });
      try {
        const list = await server.call("archive.list", { path: "bogus.tar" });
        expect(list.ok).toBe(false);
        expect(list.error).toContain("E_TAR");

        const extract = await server.call("archive.extract", { path: "bogus.tar", destDir: "x" });
        expect(extract.ok).toBe(false);
        expect(extract.error).toContain("E_TAR");

        const missing = await server.call("archive.list", { path: "nope.tar.gz" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const packMissing = await server.call("archive.pack", { dir: "no-such-dir", output: "x.tar.gz" });
        expect(packMissing.ok).toBe(false);
        expect(packMissing.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "enforces the jail and refuses symlinks when packing",
    async () => {
      const root = makeRoot();
      mkdirSync(join(root, "data"));
      writeFileSync(join(root, "data", "a.txt"), "A");
      mkdirSync(join(root, "linkdir"));
      symlinkSync(join(root, "data", "a.txt"), join(root, "linkdir", "link.txt"));

      const server = await spawnLiteServer(SERVER, { env: { MCP_ARCHIVE_ROOTS: root } });
      try {
        const escape = await server.call("archive.pack", { dir: "../outside", output: "x.tar.gz" });
        expect(escape.ok).toBe(false);
        expect(escape.error).toContain("E_JAIL");

        const outEscape = await server.call("archive.pack", { dir: "data", output: "../escape.tar.gz" });
        expect(outEscape.ok).toBe(false);
        expect(outEscape.error).toContain("E_JAIL");

        const symlink = await server.call("archive.pack", { dir: "linkdir", output: "link.tar.gz" });
        expect(symlink.ok).toBe(false);
        expect(symlink.error).toContain("E_SYMLINK");

        const fileAsDir = await server.call("archive.pack", { dir: "data/a.txt", output: "x.tar.gz" });
        expect(fileAsDir.ok).toBe(false);
        expect(fileAsDir.error).toContain("E_NOT_DIR");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
