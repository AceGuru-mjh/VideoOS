// ProjectWorkspace init/open/isProject/paths 契约测试
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { MemoryStore, PROJECT_FILE, ProjectWorkspace, TransactionManager, WorkspaceError } from "./index";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "videoos-ws-"));
  tmpRoots.push(dir);
  return dir;
}

/** SPEC §9 目录树（init 必须全部创建） */
const EXPECTED_DIRS = [
  "src",
  "src/scenes",
  "assets/images",
  "assets/audio",
  "assets/fonts",
  "tests",
  "tests/golden",
  ".video/cache",
  ".video/renders",
  ".video/snapshots",
  ".video/diagnostics",
  ".video/memory",
];

function expectWorkspaceError(promise: Promise<unknown>, code: string): Promise<void> {
  return promise.then(
    () => {
      throw new Error(`expected rejection with ${code}`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(WorkspaceError);
      expect((err as WorkspaceError).code).toBe(code);
      expect((err as Error).message).toContain(code);
    },
  );
}

describe("ProjectWorkspace.init", () => {
  test("creates the full SPEC §9 directory tree + video.project.json", async () => {
    const root = newDir();
    const ws = await ProjectWorkspace.init(root);
    for (const dir of EXPECTED_DIRS) {
      expect(existsSync(join(root, dir))).toBe(true);
    }
    expect(existsSync(join(root, PROJECT_FILE))).toBe(true);
    expect(ws.root).toBe(resolve(root));
  });

  test("manifest defaults: name from basename + SPEC §9 example values", async () => {
    const root = newDir();
    const ws = await ProjectWorkspace.init(root);
    expect(ws.manifest.name).toBe(basename(resolve(root)));
    expect(ws.manifest.entry).toBe("src/video.ts");
    expect(ws.manifest.engines).toEqual({ videoos: "^0.1" });
    expect(ws.manifest.render).toEqual({ defaultBackend: "canvas", encoder: "ffmpeg" });
    expect(ws.manifest.agent).toEqual({ autonomous: true, maxRepairLoops: 3 });
  });

  test("partial manifest deep-merges over defaults (nested per-key)", async () => {
    const root = newDir();
    const ws = await ProjectWorkspace.init(root, {
      name: "my-video",
      render: { encoder: "custom-encoder" },
      agent: { maxRepairLoops: 7 },
    });
    expect(ws.manifest.name).toBe("my-video");
    expect(ws.manifest.render).toEqual({ defaultBackend: "canvas", encoder: "custom-encoder" });
    expect(ws.manifest.agent).toEqual({ autonomous: true, maxRepairLoops: 7 });
  });

  test("creates deeply nested, nonexistent root paths recursively", async () => {
    const base = newDir();
    const root = join(base, "a", "b", "c", "proj");
    const ws = await ProjectWorkspace.init(root, { name: "deep" });
    expect(existsSync(join(root, ".video", "memory"))).toBe(true);
    expect(ws.manifest.name).toBe("deep");
  });

  test("double init on the same root throws WORKSPACE_ALREADY_INITIALIZED", async () => {
    const root = newDir();
    await ProjectWorkspace.init(root);
    await expectWorkspaceError(ProjectWorkspace.init(root), "WORKSPACE_ALREADY_INITIALIZED");
  });

  test("invalid manifest input fails with WORKSPACE_MANIFEST_INVALID (no project file written)", async () => {
    const root = newDir();
    await expectWorkspaceError(ProjectWorkspace.init(root, { name: "" }), "WORKSPACE_MANIFEST_INVALID");
    expect(existsSync(join(root, PROJECT_FILE))).toBe(false);
  });

  test("init writes a JSON file that open() can read back verbatim", async () => {
    const root = newDir();
    const ws = await ProjectWorkspace.init(root, { name: "roundtrip", render: { defaultBackend: "svg" } });
    const raw: unknown = JSON.parse(JSON.stringify(ws.manifest)); // manifest 已是解析后的对象
    const reopened = await ProjectWorkspace.open(root);
    expect(raw).toEqual(reopened.manifest);
    expect(reopened.manifest.render).toEqual({ defaultBackend: "svg", encoder: "ffmpeg" });
  });
});

describe("ProjectWorkspace.open / isProject", () => {
  test("open on a non-project directory throws WORKSPACE_NOT_FOUND", async () => {
    const root = newDir();
    await expectWorkspaceError(ProjectWorkspace.open(root), "WORKSPACE_NOT_FOUND");
  });

  test("open on a missing path throws WORKSPACE_NOT_FOUND", async () => {
    await expectWorkspaceError(ProjectWorkspace.open(join(newDir(), "does-not-exist")), "WORKSPACE_NOT_FOUND");
  });

  test("open with corrupted project JSON throws WORKSPACE_MANIFEST_INVALID", async () => {
    const root = newDir();
    await ProjectWorkspace.init(root);
    writeFileSync(join(root, PROJECT_FILE), "{ not valid json !!");
    await expectWorkspaceError(ProjectWorkspace.open(root), "WORKSPACE_MANIFEST_INVALID");
  });

  test("open with schema-invalid manifest throws WORKSPACE_MANIFEST_INVALID", async () => {
    const root = newDir();
    await ProjectWorkspace.init(root);
    writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ entry: "src/video.ts" })); // 缺 name
    await expectWorkspaceError(ProjectWorkspace.open(root), "WORKSPACE_MANIFEST_INVALID");
  });

  test("isProject: false before init, true after, false for missing path", async () => {
    const root = newDir();
    expect(ProjectWorkspace.isProject(root)).toBe(false);
    expect(ProjectWorkspace.isProject(join(root, "missing"))).toBe(false);
    await ProjectWorkspace.init(root);
    expect(ProjectWorkspace.isProject(root)).toBe(true);
    // 相对路径 / 尾斜杠也应正确解析
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(ProjectWorkspace.isProject(".")).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("ProjectWorkspace instance", () => {
  test("paths expose the SPEC §9 layout", async () => {
    const root = newDir();
    const ws = await ProjectWorkspace.init(root);
    const r = resolve(root);
    expect(ws.paths).toEqual({
      root: r,
      src: join(r, "src"),
      assets: join(r, "assets"),
      tests: join(r, "tests"),
      dotVideo: join(r, ".video"),
      projectFile: join(r, PROJECT_FILE),
      vir: join(r, ".video", "vir.json"),
      graph: join(r, ".video", "graph.json"),
      diagnostics: join(r, ".video", "diagnostics"),
      cache: join(r, ".video", "cache"),
      renders: join(r, ".video", "renders"),
      snapshots: join(r, ".video", "snapshots"),
      memory: join(r, ".video", "memory"),
    });
  });

  test("memory and transactions are wired and usable", async () => {
    const ws = await ProjectWorkspace.init(newDir());
    expect(ws.memory).toBeInstanceOf(MemoryStore);
    expect(ws.transactions).toBeInstanceOf(TransactionManager);
    await ws.memory.write("project", { style: "tech" });
    expect(await ws.memory.read<{ style: string }>("project")).toEqual({ style: "tech" });
    const tx = await ws.transactions.begin("smoke");
    await tx.commit();
    expect((await ws.transactions.info(tx.id))?.status).toBe("committed");
  });
});
