// 事务系统契约测试：begin/commit/rollback、单活动事务、快照清单、.video 排除、保留上限、resume
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectWorkspace, TransactionManager, WorkspaceError } from "./index";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  ws: ProjectWorkspace;
}

/** 受保护集：5 个文件（src×2、tests×1、assets×1、清单×1）；.video/cache 不在其中 */
const ORIGINAL_VIDEO_TS = "// original entry\nexport default null;\n";
const EXPECTED_FILES = [
  "assets/images/logo.txt",
  "src/scenes/helper.ts",
  "src/video.ts",
  "tests/video.test.ts",
  "video.project.json",
];

async function makeProject(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "videoos-tx-"));
  tmpRoots.push(root);
  const ws = await ProjectWorkspace.init(root, { name: "tx-fixture" });
  writeFileSync(join(root, "src", "video.ts"), ORIGINAL_VIDEO_TS);
  writeFileSync(join(root, "src", "scenes", "helper.ts"), "// helper module\n");
  writeFileSync(join(root, "tests", "video.test.ts"), "// placeholder test\n");
  writeFileSync(join(root, "assets", "images", "logo.txt"), "fake-asset-bytes\n");
  writeFileSync(join(root, ".video", "cache", "frame_abc.png"), "cached-frame\n");
  return { root, ws };
}

function readTxJson(ws: ProjectWorkspace, id: string): { id: string; description?: string; createdAt: string; status: string; files: string[] } {
  return JSON.parse(readFileSync(join(ws.paths.snapshots, id, "tx.json"), "utf8"));
}

function snapshotDirs(ws: ProjectWorkspace): string[] {
  return readdirSync(ws.paths.snapshots).filter((name) => name.startsWith("tx_")).sort();
}

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

describe("TransactionManager.begin", () => {
  test("snapshots the protected file set into payload/ and writes tx.json", async () => {
    const { root, ws } = await makeProject();
    const tx = await ws.transactions.begin("edit title");
    // id 格式：tx_ + 8 位序号 + _ + 6 位 hex
    expect(tx.id).toMatch(/^tx_\d{8}_[0-9a-f]{6}$/);
    expect(tx.description).toBe("edit title");
    expect(tx.status).toBe("active");
    // payload 复制了受保护集
    const payload = join(ws.paths.snapshots, tx.id, "payload");
    for (const file of EXPECTED_FILES) {
      expect(existsSync(join(payload, ...file.split("/")))).toBe(true);
    }
    expect(existsSync(join(payload, "src", "video.ts"))).toBe(true);
    // 快照不包含 .video（快照自身不会递归）
    expect(existsSync(join(payload, ".video"))).toBe(false);
    // tx.json 清单
    const record = readTxJson(ws, tx.id);
    expect(record.id).toBe(tx.id);
    expect(record.status).toBe("active");
    expect(record.description).toBe("edit title");
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(record.files).toEqual(EXPECTED_FILES); // 相对路径、字典序、不含 .video/**
    // info() 摘要
    const info = await ws.transactions.info(tx.id);
    expect(info).toEqual({ id: tx.id, description: "edit title", status: "active", createdAt: record.createdAt, files: 5 });
    await tx.commit();
    void root;
  });

  test("tx.json omits description when not provided", async () => {
    const { ws } = await makeProject();
    const tx = await ws.transactions.begin();
    const record = readTxJson(ws, tx.id);
    expect(Object.hasOwn(record, "description")).toBe(false);
    expect((await ws.transactions.info(tx.id))?.description).toBeUndefined();
    await tx.rollback();
  });

  test("second begin while active throws TX_ALREADY_ACTIVE; allowed again after commit", async () => {
    const { ws } = await makeProject();
    const tx = await ws.transactions.begin("first");
    await expectWorkspaceError(ws.transactions.begin("second"), "TX_ALREADY_ACTIVE");
    await tx.commit();
    const next = await ws.transactions.begin("after-commit");
    expect(next.id).not.toBe(tx.id);
    await next.rollback();
  });

  test("works when optional protected dirs (assets/tests) are missing", async () => {
    const { root, ws } = await makeProject();
    rmSync(join(root, "assets"), { recursive: true, force: true });
    rmSync(join(root, "tests"), { recursive: true, force: true });
    const tx = await ws.transactions.begin("sparse");
    const record = readTxJson(ws, tx.id);
    expect(record.files).toEqual(["src/scenes/helper.ts", "src/video.ts", "video.project.json"]);
    await tx.rollback();
    // 回滚后恢复的是 begin 时刻状态：assets/tests 仍不存在
    expect(existsSync(join(root, "assets"))).toBe(false);
    expect(existsSync(join(root, "tests"))).toBe(false);
  });

  test("empty description string is rejected (TX_INVALID_DESCRIPTION)", async () => {
    const { ws } = await makeProject();
    await expectWorkspaceError(ws.transactions.begin(""), "TX_INVALID_DESCRIPTION");
  });
});

describe("Transaction.rollback", () => {
  test("restores modified, deleted and newly created files to the snapshot state", async () => {
    const { root, ws } = await makeProject();
    const tx = await ws.transactions.begin("risky edit");
    // 修改
    writeFileSync(join(root, "src", "video.ts"), "GARBAGE !!! broken syntax ((((");
    writeFileSync(join(root, "video.project.json"), "{ tampered");
    // 删除
    rmSync(join(root, "src", "scenes", "helper.ts"));
    // 新建（受保护路径内 + 事务期间不应存活到回滚后）
    writeFileSync(join(root, "src", "scenes", "new-scene.ts"), "// created during tx\n");
    writeFileSync(join(root, "tests", "extra.test.ts"), "// created during tx\n");
    // .video 内的改动不受事务影响（回滚不触碰）
    writeFileSync(join(root, ".video", "cache", "frame_abc.png"), "modified-during-tx\n");

    await tx.rollback();

    expect(readFileSync(join(root, "src", "video.ts"), "utf8")).toBe(ORIGINAL_VIDEO_TS);
    expect(readFileSync(join(root, "src", "scenes", "helper.ts"), "utf8")).toBe("// helper module\n");
    expect(existsSync(join(root, "src", "scenes", "new-scene.ts"))).toBe(false);
    expect(existsSync(join(root, "tests", "extra.test.ts"))).toBe(false);
    // 清单恢复为合法 JSON
    const reopened = await ProjectWorkspace.open(root);
    expect(reopened.manifest.name).toBe("tx-fixture");
    // .video 不在保护集：事务期间的改动保留
    expect(readFileSync(join(root, ".video", "cache", "frame_abc.png"), "utf8")).toBe("modified-during-tx\n");
    // 快照保留 + 状态
    expect(existsSync(join(ws.paths.snapshots, tx.id, "payload"))).toBe(true);
    expect((await ws.transactions.info(tx.id))?.status).toBe("rolled-back");
    expect(tx.status).toBe("rolled-back");
  });

  test("rollback of a finished transaction throws TX_NOT_ACTIVE", async () => {
    const { ws } = await makeProject();
    const tx = await ws.transactions.begin();
    await tx.rollback();
    await expectWorkspaceError(tx.rollback(), "TX_NOT_ACTIVE");
    await expectWorkspaceError(tx.commit(), "TX_NOT_ACTIVE");
  });
});

describe("Transaction.commit", () => {
  test("keeps the modified files; payload retains pre-tx content for diff", async () => {
    const { root, ws } = await makeProject();
    const tx = await ws.transactions.begin("safe edit");
    writeFileSync(join(root, "src", "video.ts"), "// modified entry\n");
    await tx.commit();
    expect(readFileSync(join(root, "src", "video.ts"), "utf8")).toBe("// modified entry\n");
    // 快照保留：payload 里仍是 begin 时刻内容（COMMIT → 保留 snapshot 可 diff）
    expect(readFileSync(join(ws.paths.snapshots, tx.id, "payload", "src", "video.ts"), "utf8")).toBe(ORIGINAL_VIDEO_TS);
    expect((await ws.transactions.info(tx.id))?.status).toBe("committed");
    expect(tx.status).toBe("committed");
  });

  test("commit of a finished transaction throws TX_NOT_ACTIVE", async () => {
    const { ws } = await makeProject();
    const tx = await ws.transactions.begin();
    await tx.commit();
    await expectWorkspaceError(tx.commit(), "TX_NOT_ACTIVE");
    await expectWorkspaceError(tx.rollback(), "TX_NOT_ACTIVE");
  });
});

describe("TransactionManager.list / info", () => {
  test("list is newest-first with correct statuses and descriptions", async () => {
    const { ws } = await makeProject();
    const t1 = await ws.transactions.begin("first");
    await t1.commit();
    const t2 = await ws.transactions.begin(); // 无描述
    await t2.rollback();
    const t3 = await ws.transactions.begin("third");

    const list = await ws.transactions.list();
    expect(list.map((info) => info.id)).toEqual([t3.id, t2.id, t1.id]);
    expect(list.map((info) => info.status)).toEqual(["active", "rolled-back", "committed"]);
    expect(list.map((info) => info.description)).toEqual(["third", undefined, "first"]);
    expect(list.every((info) => info.files === 5)).toBe(true);
    expect((await ws.transactions.info(t1.id))?.files).toBe(5);

    await t3.rollback();
  });

  test("info returns null for unknown or malformed ids (no traversal)", async () => {
    const { ws } = await makeProject();
    expect(await ws.transactions.info("nope")).toBe(null);
    expect(await ws.transactions.info("")).toBe(null);
    expect(await ws.transactions.info("../evil")).toBe(null);
    expect(await ws.transactions.info("tx_00000001_zzzzzz")).toBe(null); // 非法 hex
    expect(await ws.transactions.info("tx_99999999_abcdef")).toBe(null); // 格式合法但不存在
    const tx = await ws.transactions.begin();
    await tx.rollback();
  });

  test("sequential ids are monotonically increasing", async () => {
    const { ws } = await makeProject();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const tx = await ws.transactions.begin(`t${i}`);
      ids.push(tx.id);
      await tx.commit();
    }
    const seqs = ids.map((id) => Number.parseInt(id.slice(3, 11), 10));
    expect(seqs).toEqual([seqs[0]!, seqs[0]! + 1, seqs[0]! + 2]);
  });
});

describe("snapshot retention", () => {
  test("only the 20 most recent finished snapshots are kept", async () => {
    const { ws } = await makeProject();
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const tx = await ws.transactions.begin(`tx ${i}`);
      await tx.commit();
      created.push(tx.id);
    }
    const list = await ws.transactions.list();
    expect(list.length).toBe(20);
    // 最旧 5 个被删除，最新 20 个保留（新→旧）
    expect(list.map((info) => info.id)).toEqual([...created].slice(5).reverse());
    for (const id of created.slice(0, 5)) {
      expect(snapshotDirs(ws)).not.toContain(id);
      expect(await ws.transactions.info(id)).toBe(null);
    }
    expect(snapshotDirs(ws).length).toBe(20);
  });

  test("active snapshot survives; finished cap re-enforced after it completes", async () => {
    const { ws } = await makeProject();
    for (let i = 0; i < 21; i++) {
      const tx = await ws.transactions.begin(`filler ${i}`);
      await tx.commit();
    }
    // 21 个终态 → 每次 commit 裁剪，稳定在 20
    expect(snapshotDirs(ws).length).toBe(20);
    // 开启 active：20 finished + 1 active = 21（active 不参与终态裁剪）
    const active = await ws.transactions.begin("long running");
    expect(snapshotDirs(ws).length).toBe(21);
    expect((await ws.transactions.info(active.id))?.status).toBe("active");
    const list = await ws.transactions.list();
    expect(list.length).toBe(21);
    expect(list[0]?.id).toBe(active.id); // 最新
    // active 终态化 → 裁剪回到 20；active（最新终态）保留，最旧 filler 被删
    await active.rollback();
    expect(snapshotDirs(ws).length).toBe(20);
    expect(snapshotDirs(ws)).toContain(active.id);
    expect((await ws.transactions.info(active.id))?.status).toBe("rolled-back");
  });
});

describe("TransactionManager.resume / active", () => {
  test("resume recovers an active transaction handle by id (crash recovery)", async () => {
    const { root, ws } = await makeProject();
    const tx = await ws.transactions.begin("crash simulation");
    writeFileSync(join(root, "src", "video.ts"), "half-written garbage");
    // 模拟进程重启：用全新 manager 实例按 id 恢复
    const fresh = new TransactionManager(root, ws.paths.snapshots);
    const resumed = await fresh.resume(tx.id);
    expect(resumed.id).toBe(tx.id);
    expect(resumed.status).toBe("active");
    const info = await fresh.active();
    expect(info?.id).toBe(tx.id);
    await resumed.rollback();
    expect(readFileSync(join(root, "src", "video.ts"), "utf8")).toBe(ORIGINAL_VIDEO_TS);
    expect((await fresh.active()) ?? null).toBe(null);
  });

  test("resume rejects unknown or non-active transactions", async () => {
    const { ws } = await makeProject();
    const tx = await ws.transactions.begin();
    await tx.commit();
    await expectWorkspaceError(ws.transactions.resume(tx.id), "TX_NOT_ACTIVE");
    await expectWorkspaceError(ws.transactions.resume("tx_99999999_abcdef"), "TX_NOT_FOUND");
    await expectWorkspaceError(ws.transactions.resume("../evil"), "TX_NOT_FOUND");
  });
});
