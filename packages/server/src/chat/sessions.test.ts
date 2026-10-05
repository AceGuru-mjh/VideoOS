// SessionStore 单元 + /api/sessions E2E（issue #50）。
// 全部离线：真实本地端口 E2E（模式同 settings/providers.test.ts）+ 临时目录单元测试。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { ServerError } from "../errors";
import { startStudioServer, type StudioServerHandle } from "../index";
import { SessionStore, newId, type ChatToolCallRecord, type SessionRecord } from "./sessions";

// ================================================================= SessionStore 单元

describe("SessionStore（<dataDir>/sessions/<id>.json）", () => {
  const root = mkdtempSync(join(tmpdir(), "vos-sessions-"));
  const store = new SessionStore(root);
  const sessionsDir = join(root, "sessions");

  const expectNotFoundError = (fn: () => unknown, id: string): void => {
    try {
      fn();
      throw new Error("expected ServerError");
    } catch (err) {
      expect(err).toBeInstanceOf(ServerError);
      expect((err as ServerError).status).toBe(404);
      expect((err as ServerError).message).toContain("SESSION_NOT_FOUND");
      expect((err as ServerError).message).toContain(id);
    }
  };

  test("newId：前缀 + url-safe + 唯一", () => {
    expect(newId("s")).toMatch(/^s_[A-Za-z0-9_-]{16}$/);
    expect(newId("r")).toMatch(/^r_[A-Za-z0-9_-]{16}$/);
    const ids = new Set(Array.from({ length: 100 }, () => newId("m")));
    expect(ids.size).toBe(100);
  });

  test("create：默认形状 + 落盘 0o600 + 原子无 tmp 残留", () => {
    const record = store.create();
    expect(record.id).toMatch(/^s_/);
    expect(record.title).toBe("新对话");
    expect(record.projectRoot).toBeNull();
    expect(record.messages).toEqual([]);
    expect(record.createdAt).toBe(record.updatedAt);
    const file = join(sessionsDir, `${record.id}.json`);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(sessionsDir).filter((f) => f.includes(".tmp-"))).toEqual([]);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
    expect(onDisk.id).toBe(record.id);
  });

  test("create：自定义 title / projectRoot；title 空白回落默认", () => {
    const a = store.create({ title: "  产品介绍  ", projectRoot: "/tmp/some-project" });
    expect(a.title).toBe("产品介绍");
    expect(a.projectRoot).toBe("/tmp/some-project");
    const b = store.create({ title: "   " });
    expect(b.title).toBe("新对话");
  });

  test("get：读回一致；未知/非法 id → 404 SESSION_NOT_FOUND", () => {
    const record = store.create({ title: "读取" });
    const back = store.get(record.id);
    expect(back).toEqual(record);
    expectNotFoundError(() => store.get("s_nope"), "s_nope");
    expectNotFoundError(() => store.get("../../settings"), "../../settings"); // 路径穿越按不存在处理
  });

  test("list：updatedAt 降序 + 列表形状（无 messages 正文）", async () => {
    const first = store.create({ title: "早" });
    await new Promise((r) => setTimeout(r, 5));
    const second = store.create({ title: "晚" });
    store.appendMessage(second.id, { id: newId("m"), role: "user", content: "你好", createdAt: Date.now() });
    const list = store.list();
    expect(list[0]).toEqual({
      id: second.id,
      title: "晚",
      projectRoot: null,
      updatedAt: expect.any(Number),
      messageCount: 1,
    });
    const firstItem = list.find((x) => x.id === first.id);
    expect(firstItem?.messageCount).toBe(0);
    expect(firstItem).not.toHaveProperty("messages");
    expect(list[0].id).toBe(second.id); // 最新在前
    expect(list[list.length - 1]?.id).not.toBe(second.id);
  });

  test("appendMessage + patchMessage：轨迹 / 内容 / 用量回填", () => {
    const record = store.create({ title: "运行" });
    const userId = newId("m");
    store.appendMessage(record.id, { id: userId, role: "user", content: "做视频", createdAt: Date.now() });
    const assistantId = newId("m");
    store.appendMessage(record.id, {
      id: assistantId,
      role: "assistant",
      content: "规划中",
      createdAt: Date.now(),
      runId: "r_demo",
      toolCalls: [],
    });
    const trail: ChatToolCallRecord[] = [
      { name: "compile.run", args: {}, status: "ok", durationMs: 12, resultSummary: `{"tool":"compile.run","ok":true}` },
    ];
    store.patchMessage(record.id, assistantId, { toolCalls: trail });
    store.patchMessage(record.id, assistantId, { content: "完成", usage: { promptTokens: 10, completionTokens: 5 } });
    const back = store.get(record.id);
    expect(back.messages).toHaveLength(2);
    const assistant = back.messages[1];
    expect(assistant?.content).toBe("完成");
    expect(assistant?.toolCalls).toEqual(trail);
    expect(assistant?.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    // 消息不存在 → 404
    try {
      store.patchMessage(record.id, "m_nope", { content: "x" });
      throw new Error("expected ServerError");
    } catch (err) {
      expect((err as ServerError).status).toBe(404);
      expect((err as ServerError).message).toContain("SESSION_MESSAGE_NOT_FOUND");
    }
    expectNotFoundError(() => store.appendMessage("s_ghost", { id: "m", role: "user", content: "x", createdAt: 1 }), "s_ghost");
  });

  test("rename：改名 + updatedAt 推进；空 title → 400；未知 → 404", async () => {
    const record = store.create({ title: "旧名" });
    await new Promise((r) => setTimeout(r, 5));
    const renamed = store.rename(record.id, "  新名  ");
    expect(renamed.title).toBe("新名");
    expect(renamed.updatedAt).toBeGreaterThan(record.updatedAt);
    try {
      store.rename(record.id, "   ");
      throw new Error("expected ServerError");
    } catch (err) {
      expect((err as ServerError).status).toBe(400);
    }
    expectNotFoundError(() => store.rename("s_ghost", "x"), "s_ghost");
  });

  test("delete：文件移除；未知 → 404；list 收缩", () => {
    const record = store.create({ title: "待删" });
    expect(existsSync(join(sessionsDir, `${record.id}.json`))).toBe(true);
    store.delete(record.id);
    expect(existsSync(join(sessionsDir, `${record.id}.json`))).toBe(false);
    expectNotFoundError(() => store.delete(record.id), record.id);
    expect(store.list().some((x) => x.id === record.id)).toBe(false);
  });

  test("跨实例持久化：新 SessionStore 同目录读回", () => {
    const record = store.create({ title: "跨实例", projectRoot: "/tmp/p" });
    store.appendMessage(record.id, { id: newId("m"), role: "user", content: "hello", createdAt: Date.now() });
    const second = new SessionStore(root);
    expect(second.get(record.id).messages[0]?.content).toBe("hello");
    expect(second.list().some((x) => x.id === record.id)).toBe(true);
  });

  test("损坏恢复：非法 JSON → .bad 备份保留 + list 跳过 + get 404；其余会话不受影响", () => {
    const good = store.create({ title: "好会话" });
    const bad = store.create({ title: "坏会话" });
    const badFile = join(sessionsDir, `${bad.id}.json`);
    writeFileSync(badFile, "{ not valid json !!!", "utf8");
    // list 触发备份
    const list = store.list();
    expect(list.some((x) => x.id === bad.id)).toBe(false);
    expect(list.some((x) => x.id === good.id)).toBe(true);
    expect(readFileSync(`${badFile}.bad`, "utf8")).toBe("{ not valid json !!!");
    expect(existsSync(badFile)).toBe(false);
    expectNotFoundError(() => store.get(bad.id), bad.id);
    // 形状损坏（messages 非数组）同样走备份
    const shapeless = store.create({ title: "形状坏" });
    const shapeFile = join(sessionsDir, `${shapeless.id}.json`);
    writeFileSync(shapeFile, JSON.stringify({ id: shapeless.id, title: "x", projectRoot: null, createdAt: 1, updatedAt: 1, messages: "oops" }), "utf8");
    expect(store.list().some((x) => x.id === shapeless.id)).toBe(false);
    expect(readFileSync(`${shapeFile}.bad`, "utf8")).toContain("oops");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
});

// ================================================================= /api/sessions E2E（真实端口）

describe("/api/sessions E2E", () => {
  const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
  const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-demo`, `sessions-e2e-${process.pid}`);
  const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");
  const dataDir = mkdtempSync(join(tmpdir(), "vos-sessions-api-"));

  let handle: StudioServerHandle;
  let base: string;

  beforeAll(async () => {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
    await createProjectTemplate(PROJECT_ROOT, "demo");
    handle = await startStudioServer({ port: 0, dataDir, projectRoot: PROJECT_ROOT });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const send = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const sendJson = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await send(method, path, body);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

  test("POST 缺省 → 绑定当前打开项目 + 默认标题", async () => {
    const record = await sendJson<SessionRecord>("POST", "/api/sessions", {});
    expect(record.id).toMatch(/^s_/);
    expect(record.title).toBe("新对话");
    expect(record.projectRoot).toBe(PROJECT_ROOT);
    expect(record.messages).toEqual([]);
  });

  test("POST 显式 title/projectRoot 与显式 null（不绑定）", async () => {
    const record = await sendJson<SessionRecord>("POST", "/api/sessions", { title: "指定", projectRoot: "/tmp/other" });
    expect(record.title).toBe("指定");
    expect(record.projectRoot).toBe("/tmp/other");
    const unbound = await sendJson<SessionRecord>("POST", "/api/sessions", { projectRoot: null });
    expect(unbound.projectRoot).toBeNull();
  });

  test("GET 列表：裸数组 + 形状 + updatedAt 降序", async () => {
    const list = await sendJson<Array<{ id: string; title: string; projectRoot: string | null; updatedAt: number; messageCount: number }>>("GET", "/api/sessions");
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const item of list) {
      expect(item).not.toHaveProperty("messages");
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.messageCount).toBe("number");
    }
    const updatedAt = list.map((x) => x.updatedAt);
    expect([...updatedAt].sort((a, b) => b - a)).toEqual(updatedAt);
  });

  test("GET /:id 全量 + 消息追加后的 messageCount 变化", async () => {
    const created = await sendJson<SessionRecord>("POST", "/api/sessions", { title: "计数" });
    const before = await sendJson<SessionRecord>("GET", `/api/sessions/${created.id}`);
    expect(before.messages).toEqual([]);
    // 追加一条消息（经 SessionStore 直写，orchestrator 的写入通道同一实现）
    handle.state.sessions.appendMessage(created.id, { id: newId("m"), role: "user", content: "hi", createdAt: Date.now() });
    const after = await sendJson<SessionRecord>("GET", `/api/sessions/${created.id}`);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]).toMatchObject({ role: "user", content: "hi" });
    const list = await sendJson<Array<{ id: string; messageCount: number }>>("GET", "/api/sessions");
    expect(list.find((x) => x.id === created.id)?.messageCount).toBe(1);
  });

  test("PATCH 重命名；DELETE 204 + 后续 404", async () => {
    const created = await sendJson<SessionRecord>("POST", "/api/sessions", { title: "改名前" });
    const renamed = await sendJson<SessionRecord>("PATCH", `/api/sessions/${created.id}`, { title: "改名后" });
    expect(renamed.title).toBe("改名后");
    const del = await send("DELETE", `/api/sessions/${created.id}`);
    expect(del.status).toBe(204);
    expect(del.headers.get("content-length") ?? "0").toBe("0");
    const missing = await send("GET", `/api/sessions/${created.id}`);
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toContain("SESSION_NOT_FOUND");
    const delAgain = await fetch(`${base}/api/sessions/${created.id}`, { method: "DELETE" });
    expect(delAgain.status).toBe(404);
  });

  test("错误输入：未知 id 404 / 缺 title 400 / 非法 title 400 / 非 JSON 400", async () => {
    const missing = await send("GET", "/api/sessions/s_ghost");
    expect(missing.status).toBe(404);
    const noTitle = await send("PATCH", "/api/sessions/s_ghost", {});
    expect(noTitle.status).toBe(400);
    const badTitle = await send("POST", "/api/sessions", { title: 42 });
    expect(badTitle.status).toBe(400);
    const notJson = await fetch(`${base}/api/sessions`, { method: "POST", body: "not-json{{" });
    expect(notJson.status).toBe(400);
    expect(await errorOf(notJson)).toContain("SERVER_INVALID_PARAMS");
  });

  test("服务重启（新实例同数据目录）会话保留", async () => {
    const created = await sendJson<SessionRecord>("POST", "/api/sessions", { title: "重启存活" });
    const second = await startStudioServer({ port: 0, dataDir });
    try {
      const res = await fetch(`http://127.0.0.1:${second.port}/api/sessions/${created.id}`);
      expect(res.status).toBe(200);
      const record = (await res.json()) as SessionRecord;
      expect(record.title).toBe("重启存活");
      const list = (await (await fetch(`http://127.0.0.1:${second.port}/api/sessions`)).json()) as SessionRecord[];
      expect(list.some((x) => x.id === created.id)).toBe(true);
    } finally {
      await second.close();
    }
  });
});
