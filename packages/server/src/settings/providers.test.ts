// /api/providers E2E（issue #46）+ /api/providers/test 连通性测试（issue #47）+ SecureStore 单元。
// 全部离线：真实本地端口 E2E（模式同 settings/api.test.ts）+ node:http 桩服务器（零外网）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManualProvider } from "@videoos/agent";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { startStudioServer, type StudioServerHandle } from "../index";
import { SecureStore } from "./secure";
import { maskKey, testProviderConnection, type ProviderTestResult } from "./providers";
import type { SettingsValues } from "./schema";

const dataDir = mkdtempSync(join(tmpdir(), "vos-providers-"));

let handle: StudioServerHandle;
let base: string;

beforeAll(async () => {
  handle = await startStudioServer({ port: 0, dataDir });
  base = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
  await rm(dataDir, { recursive: true, force: true });
});

const req = (path: string, init?: RequestInit): Promise<Response> => fetch(`${base}${path}`, init);

/** JSON 请求（自动 stringify + content-type）；body 缺省 = 无请求体 */
const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  req(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** send + 断言 200 + 解析 JSON */
const sendJson = async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await send(method, path, body);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};

const errorOf = async (res: Response): Promise<string> => {
  const data = (await res.json()) as { error: string };
  return data.error;
};

/** 恢复 providers 节为默认（隔离用例间状态） */
const resetProviders = (): Promise<SettingsValues> => sendJson("POST", "/api/settings/reset", { sections: ["providers"] });

interface ListedEntry {
  id: string;
  type: "openai-compatible" | "anthropic" | "manual";
  baseUrl: string;
  model: string;
  enabled: boolean;
  tools: boolean;
  keyMask: string | null;
}

// ================================================================= SecureStore 单元
describe("SecureStore（settings.secure.json）", () => {
  const root = mkdtempSync(join(tmpdir(), "vos-secure-"));
  const file = join(root, "settings.secure.json");

  test("maskKey：首 3 + *** + 末 4；≤8 字符只显示 ***", () => {
    expect(maskKey("sk-test-12345678")).toBe("sk-***5678");
    expect(maskKey("sk-abcdefghij")).toBe("sk-***ghij");
    expect(maskKey("short")).toBe("***");
    expect(maskKey("12345678")).toBe("***");
  });

  test("get/set/delete：构造不落盘；写入 mode 0o600 + 原子无 tmp 残留", () => {
    const store = new SecureStore(root);
    expect(store.get("deepseek")).toBeUndefined();
    expect(existsSync(file)).toBe(false); // 只读构造不落盘
    store.set("deepseek", "sk-test-12345678");
    store.set("openai", "sk-openai-abcdef");
    expect(store.get("deepseek")).toBe("sk-test-12345678");
    expect(store.has("openai")).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      deepseek: "sk-test-12345678",
      openai: "sk-openai-abcdef",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(root).filter((f) => f.includes(".tmp-"))).toEqual([]); // 原子写无残留

    store.delete("deepseek");
    expect(store.get("deepseek")).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ openai: "sk-openai-abcdef" });
    store.delete("nope"); // 无该键 → 无操作不落盘
    expect(store.ids()).toEqual(["openai"]);
    store.set("openai", "sk-openai-abcdef"); // 值未变 → 不重写
  });

  test("损坏 JSON → 空库运行 + .bad 备份保留", () => {
    const corrupt = join(root, "corrupt");
    mkdirSync(corrupt, { recursive: true });
    writeFileSync(join(corrupt, "settings.secure.json"), "{ not valid json !!!", "utf8");
    const store = new SecureStore(corrupt);
    expect(store.get("x")).toBeUndefined();
    expect(readFileSync(join(corrupt, "settings.secure.json.bad"), "utf8")).toBe("{ not valid json !!!");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
});

// ================================================================= GET /api/providers（目录 + 掩码）
describe("GET /api/providers", () => {
  test("全新数据目录：9 家目录 + 空 entries + keyEnvHints", async () => {
    const data = await sendJson<{
      catalog: Array<{ id: string; baseUrl: string; local?: boolean; labelZh: string }>;
      entries: ListedEntry[];
      defaultProvider: string | null;
      defaultModel: string | null;
      keyEnvHints: Record<string, string>;
    }>("GET", "/api/providers");
    expect(data.catalog.map((c) => c.id)).toEqual([
      "openai", "anthropic", "deepseek", "zhipu", "qwen", "moonshot", "doubao", "ollama", "custom",
    ]);
    expect(data.catalog.find((c) => c.id === "zhipu")?.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(data.catalog.find((c) => c.id === "anthropic")?.baseUrl).toBe("https://api.anthropic.com");
    expect(data.catalog.find((c) => c.id === "ollama")?.local).toBe(true);
    expect(data.catalog.find((c) => c.id === "doubao")?.labelZh).toContain("接入点");
    expect(data.entries).toEqual([]);
    expect(data.defaultProvider).toBeNull();
    expect(data.defaultModel).toBeNull();
    expect(data.keyEnvHints).toEqual({
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      zhipu: "ZHIPU_API_KEY",
      qwen: "DASHSCOPE_API_KEY",
      moonshot: "MOONSHOT_API_KEY",
      doubao: "ARK_API_KEY",
    });
  });
});

// ================================================================= POST / PUT / DELETE /api/providers（CRUD + 安全存储）
describe("Provider CRUD", () => {
  test("POST 创建（带 apiKey）→ 掩码返回 + enabled/tools 归一化显式 true", async () => {
    const created = await sendJson<{ entry: ListedEntry; keyMask: string | null }>("POST", "/api/providers", {
      entry: { id: "deepseek", type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      apiKey: "sk-test-12345678",
    });
    expect(created.entry.id).toBe("deepseek");
    expect(created.entry.enabled).toBe(true);
    expect(created.entry.tools).toBe(true);
    expect(created.keyMask).toBe("sk-***5678");

    const listed = await sendJson<{ entries: ListedEntry[] }>("GET", "/api/providers");
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).toMatchObject({ id: "deepseek", keyMask: "sk-***5678", enabled: true, tools: true });
  });

  test("settings.json 永不包含 Key 材料；Key 只存 settings.secure.json（mode 0o600）", () => {
    const settingsRaw = readFileSync(join(dataDir, "settings.json"), "utf8");
    expect(settingsRaw).not.toContain("sk-test-12345678");
    expect(settingsRaw).not.toContain("apiKey");
    expect(settingsRaw).toContain("api.deepseek.com"); // 条目本体在 settings.json
    const secureRaw = readFileSync(join(dataDir, "settings.secure.json"), "utf8");
    expect(secureRaw).toContain("sk-test-12345678");
    expect(statSync(join(dataDir, "settings.secure.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dataDir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  test("entry 内走私 apiKey 字段 → zod 剥除，任何文件/响应都不含 Key", async () => {
    const data = await sendJson<SettingsValues>("PATCH", "/api/settings", {
      providers: {
        entries: [{ id: "smuggle", type: "manual", baseUrl: "", model: "m", apiKey: "sk-leak-secret", enabled: true }],
      },
    });
    expect(JSON.stringify(data.providers.entries)).not.toContain("sk-leak-secret");
    expect(readFileSync(join(dataDir, "settings.json"), "utf8")).not.toContain("sk-leak-secret");
    expect(readFileSync(join(dataDir, "settings.secure.json"), "utf8")).not.toContain("sk-leak-secret");
    // 清理走私条目，恢复 deepseek
    await resetProviders();
    await send("POST", "/api/providers", {
      entry: { id: "deepseek", type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      apiKey: "sk-test-12345678",
    });
  });

  test("POST 重复 id → 400 PROVIDER_EXISTS；现值不变", async () => {
    const res = await send("POST", "/api/providers", {
      entry: { id: "deepseek", type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "x" },
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("PROVIDER_EXISTS");
    const listed = await sendJson<{ entries: ListedEntry[] }>("GET", "/api/providers");
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].model).toBe("deepseek-chat");
  });

  test("POST 非法条目 → 400 SETTINGS_INVALID（坏 type / 空 baseUrl / 坏 id / 缺 model）", async () => {
    const cases: Array<{ entry: Record<string, unknown>; part: string }> = [
      { entry: { id: "bad", type: "nope", baseUrl: "https://x/v1", model: "m" }, part: "type" },
      { entry: { id: "bad", type: "openai-compatible", baseUrl: "", model: "m" }, part: "baseUrl" },
      { entry: { id: "bad", type: "anthropic", baseUrl: "  ", model: "m" }, part: "baseUrl" },
      { entry: { id: "Bad_ID", type: "manual", baseUrl: "", model: "m" }, part: "id" },
      { entry: { type: "manual", baseUrl: "" }, part: "model" },
    ];
    for (const { entry, part } of cases) {
      const res = await send("POST", "/api/providers", { entry });
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error).toContain("SETTINGS_INVALID");
      expect(error).toContain(part);
    }
  });

  test("POST 非 JSON 体 → 400 SETTINGS_INVALID", async () => {
    const res = await req("/api/providers", { method: "POST", body: "not-json" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("SETTINGS_INVALID");
  });

  test("POST 无 id：按 label 生成 slug；冲突自动 -2；无 label 按 type", async () => {
    const first = await sendJson<{ entry: ListedEntry }>("POST", "/api/providers", {
      entry: { type: "manual", baseUrl: "", model: "m", label: "My Cool Provider" },
    });
    expect(first.entry.id).toBe("my-cool-provider");
    const second = await sendJson<{ entry: ListedEntry }>("POST", "/api/providers", {
      entry: { type: "manual", baseUrl: "", model: "m", label: "My Cool Provider!" },
    });
    expect(second.entry.id).toBe("my-cool-provider-2");
    const noLabel = await sendJson<{ entry: ListedEntry }>("POST", "/api/providers", {
      entry: { type: "openai-compatible", baseUrl: "https://x.example/v1", model: "m" },
    });
    expect(noLabel.entry.id).toBe("openai-compatible");
    await resetProviders();
    await send("POST", "/api/providers", {
      entry: { id: "deepseek", type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      apiKey: "sk-test-12345678",
    });
  });

  test("PUT 局部更新（缺省 apiKey = 保持 Key）：仅改 model，baseUrl/Key 保留", async () => {
    const updated = await sendJson<{ entry: ListedEntry; keyMask: string | null }>("PUT", "/api/providers/deepseek", {
      entry: { model: "deepseek-reasoner" },
    });
    expect(updated.entry.model).toBe("deepseek-reasoner");
    expect(updated.entry.baseUrl).toBe("https://api.deepseek.com/v1"); // 缺席键保持
    expect(updated.entry.enabled).toBe(true);
    expect(updated.keyMask).toBe("sk-***5678"); // Key 保留
    expect(readFileSync(join(dataDir, "settings.secure.json"), "utf8")).toContain("sk-test-12345678");
  });

  test("PUT apiKey 替换 / 显式 null 删除 / 空串保持", async () => {
    const replaced = await sendJson<{ keyMask: string | null }>("PUT", "/api/providers/deepseek", {
      apiKey: "sk-second-key-9999",
    });
    expect(replaced.keyMask).toBe("sk-***9999");

    const kept = await sendJson<{ keyMask: string | null }>("PUT", "/api/providers/deepseek", {
      entry: { label: "DS" },
      apiKey: "",
    });
    expect(kept.keyMask).toBe("sk-***9999"); // 空串 = 保持

    const removed = await sendJson<{ keyMask: string | null }>("PUT", "/api/providers/deepseek", {
      apiKey: null,
    });
    expect(removed.keyMask).toBeNull();
    expect(readFileSync(join(dataDir, "settings.secure.json"), "utf8")).not.toContain("sk-second-key-9999");
    // 重新补回 Key 供后续用例
    await send("PUT", "/api/providers/deepseek", { apiKey: "sk-test-12345678" });
  });

  test("PUT 404（未知 id）/ id 不一致 400 / 非法补丁 400", async () => {
    const missing = await send("PUT", "/api/providers/nope", { entry: { model: "m" } });
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toContain("PROVIDER_NOT_FOUND");

    const mismatch = await send("PUT", "/api/providers/deepseek", { entry: { id: "other", model: "m" } });
    expect(mismatch.status).toBe(400);
    expect(await errorOf(mismatch)).toContain("SETTINGS_INVALID");

    const invalid = await send("PUT", "/api/providers/deepseek", { entry: { baseUrl: "" } });
    expect(invalid.status).toBe(400);
    expect(await errorOf(invalid)).toContain("baseUrl");
  });

  test("DELETE：条目 + Key 一起清除；defaultProvider/defaultModel 成对清空", async () => {
    await sendJson("PATCH", "/api/settings", { providers: { defaultProvider: "deepseek", defaultModel: "deepseek/deepseek-chat" } });
    const deleted = await sendJson<{ ok: boolean }>("DELETE", "/api/providers/deepseek");
    expect(deleted.ok).toBe(true);

    const settings = await sendJson<SettingsValues>("GET", "/api/settings");
    expect(settings.providers.entries).toEqual([]);
    expect(settings.providers.defaultProvider).toBeNull();
    expect(settings.providers.defaultModel).toBeNull(); // 成对清除
    expect(readFileSync(join(dataDir, "settings.secure.json"), "utf8")).not.toContain("sk-test-12345678"); // Key 同步清除
    expect(readFileSync(join(dataDir, "settings.json"), "utf8")).not.toContain("sk-test-12345678");

    const again = await send("DELETE", "/api/providers/deepseek");
    expect(again.status).toBe(404); // 重复删除 → 404
  });

  test("defaultModel 形如 <id>/<model> 且 defaultProvider 指向别家 → 仅清 defaultModel", async () => {
    await send("POST", "/api/providers", { entry: { id: "a-manual", type: "manual", baseUrl: "", model: "ma" } });
    await send("POST", "/api/providers", { entry: { id: "b-manual", type: "manual", baseUrl: "", model: "mb" } });
    await sendJson("PATCH", "/api/settings", { providers: { defaultProvider: "a-manual", defaultModel: "b-manual/mb" } });
    await sendJson("DELETE", "/api/providers/b-manual");
    const settings = await sendJson<SettingsValues>("GET", "/api/settings");
    expect(settings.providers.defaultProvider).toBe("a-manual"); // 未指向被删条目 → 保留
    expect(settings.providers.defaultModel).toBeNull(); // b-manual/mb 前缀命中 → 清除
    await resetProviders();
  });
});

// ================================================================= Agent 装配桥（source: settings/env/none）
describe("Agent 配置探测与装配桥", () => {
  test("无 settings 条目 + 无 env → none / configured false", async () => {
    await resetProviders();
    const prev = process.env.VIDEOOS_PROVIDERS;
    delete process.env.VIDEOOS_PROVIDERS;
    try {
      const config = await sendJson<{ configured: boolean; source: string; providers: string[] }>("GET", "/api/agent/config");
      expect(config).toEqual({ configured: false, source: "none", providers: [] });
    } finally {
      if (prev !== undefined) process.env.VIDEOOS_PROVIDERS = prev;
    }
  });

  test("settings enabled 条目 → source settings；ManualProvider 直通", async () => {
    await send("POST", "/api/providers", {
      entry: { id: "demo", type: "manual", baseUrl: "", model: "demo-model" },
    });
    const config = await sendJson<{ configured: boolean; source: string; providers: string[] }>("GET", "/api/agent/config");
    expect(config).toEqual({ configured: true, source: "settings", providers: ["demo"] });
    const providers = handle.state.resolveProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(ManualProvider);
    expect((providers[0] as ManualProvider).model).toBe("demo-model");
  });

  test("defaultProvider 排最前（多 entry 时路由首选默认）", async () => {
    await send("POST", "/api/providers", { entry: { id: "aaa", type: "manual", baseUrl: "", model: "ma" } });
    await sendJson("PATCH", "/api/settings", { providers: { defaultProvider: "demo", defaultModel: "demo/demo-model" } });
    const ids = handle.state.resolveProviders().map((p) => p.id);
    expect(ids[0]).toBe("demo"); // defaultProvider 提到最前
    expect(new Set(ids)).toEqual(new Set(["demo", "aaa"]));
  });

  test("条目全部 disabled → 回退 env（source env）；env 移除/损坏 → none", async () => {
    await send("PUT", "/api/providers/demo", { entry: { enabled: false } });
    await send("PUT", "/api/providers/aaa", { entry: { enabled: false } });
    const prev = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([{ id: "envdemo", type: "manual", model: "env-model" }]);
    try {
      let config = await sendJson<{ configured: boolean; source: string; providers: string[] }>("GET", "/api/agent/config");
      expect(config).toEqual({ configured: true, source: "env", providers: ["envdemo"] });

      delete process.env.VIDEOOS_PROVIDERS;
      config = await sendJson<{ configured: boolean; source: string; providers: string[] }>("GET", "/api/agent/config");
      expect(config).toEqual({ configured: false, source: "none", providers: [] }); // env 缺省 + settings 无 enabled → none

      // 坏 env JSON 不炸（v0.1 行为保持）
      process.env.VIDEOOS_PROVIDERS = "{broken json";
      config = await sendJson<{ configured: boolean; source: string; providers: string[] }>("GET", "/api/agent/config");
      expect(config).toEqual({ configured: false, source: "none", providers: [] });
    } finally {
      if (prev !== undefined) process.env.VIDEOOS_PROVIDERS = prev;
      else delete process.env.VIDEOOS_PROVIDERS;
    }
    await resetProviders();
  });

  test("Key 解析：secure.json 缺席时回退 env VIDEOOS_PROVIDER_<ID>_KEY（keyMask 同步反映）", async () => {
    await send("POST", "/api/providers", {
      entry: { id: "stubenv", type: "openai-compatible", baseUrl: "https://x.invalid/v1", model: "m" },
    }); // 不带 apiKey
    const envName = "VIDEOOS_PROVIDER_STUBENV_KEY";
    const prev = process.env[envName];
    process.env[envName] = "sk-env-fallback-999";
    try {
      const listed = await sendJson<{ entries: ListedEntry[] }>("GET", "/api/providers");
      const entry = listed.entries.find((e) => e.id === "stubenv");
      expect(entry?.keyMask).toBe("sk-***-999"); // env 回退可见
      expect(handle.state.secure.get("stubenv")).toBeUndefined(); // 但不落盘
      expect(handle.state.resolveProviders().some((p) => p.id === "stubenv")).toBe(true);
    } finally {
      if (prev !== undefined) process.env[envName] = prev;
      else delete process.env[envName];
    }
    await resetProviders();
  });
});

// ================================================================= POST /api/providers/test（本地桩服务器，离线）
describe("连通性测试 /api/providers/test", () => {
  interface StubHandle {
    port: number;
    close(): Promise<void>;
  }

  /** 启动本地桩服务器（close 时强制销毁 keep-alive/hung socket，避免 close 挂起） */
  async function startStub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<StubHandle> {
    const server: Server = createServer(handler);
    const sockets = new Set<{ destroy(): void }>();
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    return {
      port,
      close: () => {
        for (const s of sockets) s.destroy();
        return new Promise<void>((r) => server.close(() => r()));
      },
    };
  }

  /** 读取请求体（字符串） */
  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk as string));
      req.on("end", () => resolveBody(data));
    });
  }

  /** OpenAI 兼容桩：/v1/chat/completions + /v1/models 可编程响应 */
  interface StubConfig {
    chatStatus?: number;
    chatBody?: string;
    modelsStatus?: number;
    modelsBody?: string;
    /** 记录收到的头/体（断言鉴权头） */
    seen?: { chatAuth?: string; modelsAuth?: string; chatBody?: string };
  }

  function openaiStub(cfg: StubConfig): Promise<StubHandle> {
    return startStub((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/v1/chat/completions") {
        void readBody(req).then((body) => {
          if (cfg.seen) {
            cfg.seen.chatAuth = req.headers.authorization;
            cfg.seen.chatBody = body;
          }
          res.writeHead(cfg.chatStatus ?? 200, { "content-type": "application/json" });
          res.end(cfg.chatBody ?? JSON.stringify({ choices: [{ message: { content: "pong" } }], usage: {} }));
        });
        return;
      }
      if (req.method === "GET" && url === "/v1/models") {
        if (cfg.seen) cfg.seen.modelsAuth = req.headers.authorization;
        res.writeHead(cfg.modelsStatus ?? 200, { "content-type": "application/json" });
        res.end(cfg.modelsBody ?? JSON.stringify({ data: [{ id: "m-b" }, { id: "m-a" }, {}] }));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  }

  const entryBody = (port: number, apiKey?: string): Record<string, unknown> => ({
    entry: { id: "stub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, model: "gpt-test" },
    ...(apiKey === undefined ? {} : { apiKey }),
  });

  test("happy path：chat 200 + models 排序去伪（Bearer 鉴权头透传 + 最小 ping 消息）", async () => {
    const seen: { chatAuth?: string; modelsAuth?: string; chatBody?: string } = {};
    const stub = await openaiStub({ seen });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(stub.port, "sk-local-key-123456"));
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.models).toEqual(["m-a", "m-b"]); // 排序 + 无 id 条目被剔除
      expect(result.error).toBeUndefined();
      expect(seen.chatAuth).toBe("Bearer sk-local-key-123456");
      expect(seen.modelsAuth).toBe("Bearer sk-local-key-123456");
      expect(JSON.parse(seen.chatBody ?? "{}").messages[0].content).toBe("ping"); // 最小 chat 探测
    } finally {
      await stub.close();
    }
  });

  test("models 失败不影响测试结果（省略 models 字段）", async () => {
    const stub = await openaiStub({ modelsStatus: 500, modelsBody: "{}" });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(stub.port, "k"));
      expect(result.ok).toBe(true);
      expect("models" in result).toBe(false);
    } finally {
      await stub.close();
    }
  });

  test("401/403 → AUTH_REJECTED（中文 hint 原文）", async () => {
    for (const status of [401, 403]) {
      const stub = await openaiStub({ chatStatus: status, chatBody: JSON.stringify({ error: { message: "bad key" } }) });
      try {
        const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(stub.port, "k"));
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe("AUTH_REJECTED");
        expect(result.hint).toBe("API Key 无效或无权限");
      } finally {
        await stub.close();
      }
    }
  });

  test("404 → ENDPOINT_OR_MODEL_NOT_FOUND；429 → RATE_LIMITED", async () => {
    const notFound = await openaiStub({ chatStatus: 404, chatBody: "{}" });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(notFound.port, "k"));
      expect(result.error?.code).toBe("ENDPOINT_OR_MODEL_NOT_FOUND");
      expect(result.hint).toBe("端点或模型不存在，请检查 baseUrl 是否包含 /v1 与模型名");
    } finally {
      await notFound.close();
    }
    const limited = await openaiStub({ chatStatus: 429, chatBody: "{}" });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(limited.port, "k"));
      expect(result.error?.code).toBe("RATE_LIMITED");
      expect(result.hint).toBe("触发限流，请稍后重试");
    } finally {
      await limited.close();
    }
  });

  test("500 / 非 JSON 200 / API error 200 → PROTOCOL_ERROR（hint = 响应体摘录 ≤200）", async () => {
    const boom = await openaiStub({ chatStatus: 500, chatBody: `internal boom detail ${"x".repeat(300)}` });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(boom.port, "k"));
      expect(result.error?.code).toBe("PROTOCOL_ERROR");
      expect(result.hint).toContain("internal boom detail");
      expect((result.hint ?? "").length).toBeLessThanOrEqual(200); // 截断
    } finally {
      await boom.close();
    }
    const nonJson = await openaiStub({ chatBody: "not-json{{" });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(nonJson.port, "k"));
      expect(result.error?.code).toBe("PROTOCOL_ERROR");
      expect(result.hint).toBe("not-json{{"); // PROVIDER_BAD_RESPONSE body 摘录
    } finally {
      await nonJson.close();
    }
    const apiError = await openaiStub({ chatBody: JSON.stringify({ error: { message: "quota exceeded msg" } }) });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(apiError.port, "k"));
      expect(result.error?.code).toBe("PROTOCOL_ERROR");
      expect(result.hint).toContain("quota exceeded msg");
    } finally {
      await apiError.close();
    }
  });

  test("连接拒绝（本机未监听端口）→ NETWORK_UNREACHABLE", async () => {
    // 拿一个确证空闲端口：监听后立即关闭
    const probe = await startStub(() => {});
    const port = probe.port;
    await probe.close();
    const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", entryBody(port, "k"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NETWORK_UNREACHABLE");
    expect(result.hint).toBe("无法连接到服务地址，请检查 baseUrl 与网络/代理");
  });

  test("挂死连接（小超时注入）→ TIMEOUT", async () => {
    const hung = await startStub(() => {
      /* accept 但永不响应 */
    });
    try {
      const result = await testProviderConnection(
        handle.state.settings,
        handle.state.secure,
        { entry: { id: "stub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${hung.port}/v1`, model: "m" }, apiKey: "k" },
        { timeoutMs: 400, modelsTimeoutMs: 200 },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
      expect(result.hint).toBe("请求超时，服务无响应");
    } finally {
      await hung.close();
    }
  });

  test("manual 类型 → 立即成功（latencyMs 0，无网络）", async () => {
    const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", {
      entry: { id: "demo", type: "manual", baseUrl: "", model: "demo-model" },
    });
    expect(result).toEqual({ ok: true, latencyMs: 0 });
  });

  test("anthropic：/v1/messages + /v1/models + x-api-key/anthropic-version 头", async () => {
    const seen: { chatKey?: string; version?: string; modelsKey?: string } = {};
    const stub = await startStub((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/v1/messages") {
        void readBody(req).then(() => {
          seen.chatKey = String(req.headers["x-api-key"] ?? "");
          seen.version = String(req.headers["anthropic-version"] ?? "");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ content: [{ type: "text", text: "pong" }], usage: {} }));
        });
        return;
      }
      if (req.method === "GET" && url === "/v1/models") {
        seen.modelsKey = String(req.headers["x-api-key"] ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "claude-b" }, { id: "claude-a" }] }));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    try {
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", {
        entry: { id: "ac", type: "anthropic", baseUrl: `http://127.0.0.1:${stub.port}`, model: "claude-x" },
        apiKey: "ant-key-123",
      });
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(["claude-a", "claude-b"]);
      expect(seen.chatKey).toBe("ant-key-123");
      expect(seen.version).toBe("2023-06-01");
      expect(seen.modelsKey).toBe("ant-key-123");
    } finally {
      await stub.close();
    }
  });

  test("body 为已存 id：用最新存储条目 + 存储 Key（桩断言 Bearer）", async () => {
    await send("POST", "/api/providers", {
      entry: { id: "stub-stored", type: "openai-compatible", baseUrl: "https://placeholder.invalid/v1", model: "m" },
      apiKey: "sk-will-be-patched",
    });
    const seen: { chatAuth?: string } = {};
    const stub = await openaiStub({ seen });
    try {
      // 创建后改 baseUrl 指向桩 → 证明测试用的是最新存储条目 + 替换后的 Key
      await send("PUT", "/api/providers/stub-stored", {
        entry: { baseUrl: `http://127.0.0.1:${stub.port}/v1` },
        apiKey: "sk-stored-abc123",
      });
      const result = await sendJson<ProviderTestResult>("POST", "/api/providers/test", { id: "stub-stored" });
      expect(result.ok).toBe(true);
      expect(seen.chatAuth).toBe("Bearer sk-stored-abc123");
    } finally {
      await stub.close();
      await send("DELETE", "/api/providers/stub-stored");
    }
  });

  test("未知 id → 404；空 body / 非法条目 → 400", async () => {
    const missing = await send("POST", "/api/providers/test", { id: "nope" });
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toContain("PROVIDER_NOT_FOUND");

    const empty = await send("POST", "/api/providers/test", {});
    expect(empty.status).toBe(400);
    expect(await errorOf(empty)).toContain("PROVIDER_TEST_INVALID");

    const invalid = await send("POST", "/api/providers/test", { entry: { id: "x", type: "nope" } });
    expect(invalid.status).toBe(400);
    expect(await errorOf(invalid)).toContain("SETTINGS_INVALID");
  });
});

// ================================================================= /api/agent/exec 走 settings 桥（独立 fixture 项目，ManualProvider 零工具调用 → 零副作用）
describe("Agent exec 桥（settings → exec 全链路）", () => {
  const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
  const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-providers-e2e-${process.pid}`);

  test("settings 配置 manual provider → exec 成功返回 done", async () => {
    // 先经主 server 写入条目（落盘 settings.json），第二 server 打开项目后装配
    await send("POST", "/api/providers", { entry: { id: "demo", type: "manual", baseUrl: "", model: "demo-model" } });
    const projectRoot = join(FIXTURE_ROOT, "demo");
    await ProjectWorkspace.init(projectRoot, { name: "demo" });
    await createProjectTemplate(projectRoot, "demo");
    const second = await startStudioServer({ port: 0, dataDir, projectRoot });
    try {
      const res = await fetch(`http://127.0.0.1:${second.port}/api/agent/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "你好，请完成一个演示任务" }),
      });
      expect(res.status).toBe(200);
      const exec = (await res.json()) as { ok: boolean; toolCallCount: number; summary: string; steps: Array<{ role: string; content: string }> };
      expect(exec.ok).toBe(true);
      expect(exec.toolCallCount).toBe(0);
      expect(exec.summary).toBe("done");
      expect(exec.steps[0]?.role).toBe("assistant");
    } finally {
      await second.close();
      await resetProviders();
    }
  });

  afterAll(async () => {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  });
});
