// startStudioServer 项目打开失败路径：拒绝 + 端口释放（句柄泄漏回归测试）。
// 修复前行为：state.open() 抛错但 HTTP/WS 已监听 —— 调用方拿到异常，
// 进程却挂着无法关闭的监听句柄（僵尸 server）；修复后先关句柄再抛。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { startStudioServer, ServerError, type StudioServerHandle } from "./index";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-serve-leak-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");
/** 固定端口做「僵尸监听」探针：失败后必须能重新绑定同一端口 */
const PROBE_PORT = 4790 + (process.pid % 200);

let normal: StudioServerHandle | null = null;

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
  await createProjectTemplate(PROJECT_ROOT, "demo");
});

afterAll(async () => {
  if (normal !== null) await normal.close();
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("startStudioServer 失败路径（无僵尸监听）", () => {
  test("无效 projectRoot → 抛 WORKSPACE_NOT_FOUND", async () => {
    let caught: unknown = null;
    try {
      await startStudioServer({ port: PROBE_PORT, projectRoot: join(FIXTURE_ROOT, "no-such-project") });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ServerError);
    // ServerError 包装内层 WORKSPACE_NOT_FOUND（code=SERVER_OPEN_FAILED，message 内嵌原因）
    expect((caught as ServerError).code).toBe("SERVER_OPEN_FAILED");
    expect((caught as ServerError).message).toContain("WORKSPACE_NOT_FOUND");
  });

  test("失败后端口已释放（同端口可立即重新绑定）", async () => {
    await new Promise((r) => setTimeout(r, 300)); // 等 close 完成
    normal = await startStudioServer({ port: PROBE_PORT }); // 无 projectRoot → 无项目模式
    expect(normal.port).toBe(PROBE_PORT);
    expect(normal.state.projectSession).toBeNull();
  });

  test("有效 projectRoot → 正常打开项目", async () => {
    const h = await startStudioServer({ port: 0, projectRoot: PROJECT_ROOT });
    expect(h.state.projectSession?.project.root).toBe(PROJECT_ROOT);
    await h.close();
  });
});
