// MemoryStore 契约测试（读写/列表/删除/原子写/名称白名单）
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, WorkspaceError } from "./index";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function newStoreDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "videoos-mem-"));
  tmpRoots.push(dir);
  return join(dir, "memory"); // 刻意不存在：store 应按需创建/优雅处理
}

async function expectInvalidName(action: () => unknown): Promise<void> {
  try {
    await action();
    throw new Error("expected invalid memory name to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(WorkspaceError);
    expect((err as WorkspaceError).code).toBe("WORKSPACE_INVALID_MEMORY_NAME");
  }
}

describe("MemoryStore", () => {
  test("read on missing file/dir returns null", async () => {
    const store = new MemoryStore(newStoreDir());
    expect(await store.read("project")).toBe(null);
    expect(await store.list()).toEqual([]);
  });

  test("write → read roundtrip with pretty JSON on disk", async () => {
    const dir = newStoreDir();
    const store = new MemoryStore(dir);
    const data = { resolution: "1920x1080", brand: ["#0a0a12", "#6d28d9"], retries: 3 };
    await store.write("project", data);
    // 注意：内联 expect(await read(...)).toEqual(obj) 会触发 bun-types 把 T 上下文推断为 null 的怪癖，
    // 先落变量（或显式 read<T>）再断言
    const loaded = await store.read("project");
    expect(loaded).toEqual(data);
    const onDisk = readFileSync(join(dir, "project.json"), "utf8");
    expect(onDisk).toBe(`${JSON.stringify(data, null, 2)}\n`);
    // 泛型读取
    const typed = await store.read<{ resolution: string }>("project");
    expect(typed?.resolution).toBe("1920x1080");
  });

  test("write is atomic: no .tmp leftovers, list ignores tmp files", async () => {
    const dir = newStoreDir();
    const store = new MemoryStore(dir);
    await store.write("a", { v: 1 });
    await store.write("b", { v: 2 });
    const files = readdirSync(dir);
    expect(files.sort()).toEqual(["a.json", "b.json"]);
    expect(await store.list()).toEqual(["a", "b"]);
  });

  test("write overwrites previous content", async () => {
    const store = new MemoryStore(newStoreDir());
    await store.write("state", { v: 1 });
    await store.write("state", { v: 2 });
    const state = await store.read("state");
    expect(state).toEqual({ v: 2 });
  });

  test("list is sorted and strips the .json extension", async () => {
    const store = new MemoryStore(newStoreDir());
    await store.write("zeta", 1);
    await store.write("alpha", 1);
    await store.write("mid-123", 1);
    expect(await store.list()).toEqual(["alpha", "mid-123", "zeta"]);
  });

  test("read of corrupted JSON returns null and warns on console", async () => {
    const dir = newStoreDir();
    const store = new MemoryStore(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "corrupt.json"), "{ this is not json");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown, ...rest: unknown[]) => {
      warnings.push(String(message));
      originalWarn(message, ...rest);
    };
    try {
      expect(await store.read("corrupt")).toBe(null);
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("corrupt");
    expect(warnings[0]).toContain("invalid JSON");
  });

  test("remove deletes the file and is idempotent for missing names", async () => {
    const dir = newStoreDir();
    const store = new MemoryStore(dir);
    await store.write("gone", { v: 1 });
    await store.remove("gone");
    expect(existsSync(join(dir, "gone.json"))).toBe(false);
    expect(await store.read("gone")).toBe(null);
    expect(await store.list()).toEqual([]);
    await store.remove("gone"); // 不存在 → 静默
  });

  test("name whitelist blocks traversal and illegal characters (read/write/remove)", async () => {
    const store = new MemoryStore(newStoreDir());
    const bad = ["", "UPPER", "with space", "a/b", "a\\b", "..", "../escape", "a.b", "a_b", "中文", "a b", "node_modules"];
    for (const name of bad) {
      await expectInvalidName(() => store.read(name));
      await expectInvalidName(() => store.write(name, {}));
      await expectInvalidName(() => store.remove(name));
    }
    // 合法名：小写字母/数字/连字符
    await store.write("project-facts-2", { ok: true });
    const ok = await store.read("project-facts-2");
    expect(ok).toEqual({ ok: true });
  });
});
