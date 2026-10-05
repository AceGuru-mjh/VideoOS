// /api/settings E2E：真实监听端口上的 REST 全链路（GET/PUT/PATCH/reset + 400 + 重启保留）。
// fixture 数据目录建于 os.tmpdir（设置路由不依赖项目会话，无需 repo 子树）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudioServer, type StudioServerHandle } from "../index";
import { DEFAULT_SETTINGS, type SettingsValues } from "./schema";

const dataDir = mkdtempSync(join(tmpdir(), "vos-settings-api-"));

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

const json = async (path: string, init?: RequestInit): Promise<SettingsValues> => {
  const res = await req(path, init);
  expect(res.status).toBe(200);
  return (await res.json()) as SettingsValues;
};

const patch = (body: unknown): Promise<Response> => req("/api/settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("GET /api/settings", () => {
  test("全新数据目录 → 九节齐全的默认值", async () => {
    const data = await json("/api/settings");
    expect(Object.keys(data).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(data).toEqual(DEFAULT_SETTINGS);
    expect(data.general.theme).toBe("midnight");
    expect(data.agent.autonomy).toBe("L3");
  });
});

describe("PATCH /api/settings", () => {
  test("局部更新：嵌套键变更保留兄弟键，GET 可见持久化", async () => {
    const data = await json("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ general: { theme: "amber" }, interface: { fontSize: "lg" }, skills: { autoTrigger: false } }),
    });
    expect(data.general.theme).toBe("amber");
    expect(data.general.language).toBe("zh"); // 兄弟键保留
    expect(data.interface.fontSize).toBe("lg");
    expect(data.skills.autoTrigger).toBe(false);
    expect(data.agent.maxSteps).toBe(12); // 未触及的节保持

    const reread = await json("/api/settings");
    expect(reread.general.theme).toBe("amber");
    expect(reread.interface.fontSize).toBe("lg");
  });

  test("坏枚举值 → 400 SETTINGS_INVALID，现值不变", async () => {
    const res = await patch({ general: { theme: "nope" } });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
    expect(data.error).toContain("theme");
    const after = await json("/api/settings");
    expect(after.general.theme).toBe("amber");
  });

  test("未知节 → 400 SETTINGS_INVALID", async () => {
    const res = await patch({ nope: { x: 1 } });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
  });

  test("非 JSON 体 → 400 SETTINGS_INVALID（而非 500）", async () => {
    const res = await req("/api/settings", { method: "PATCH", body: "not-json" });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
  });
});

describe("PUT /api/settings", () => {
  test("全量替换 → 200 保存对象，GET 反映", async () => {
    const full = await json("/api/settings");
    full.general.language = "en";
    full.privacy.telemetry = true;
    full.providers.defaultProvider = "openai";
    const saved = await json("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(full),
    });
    expect(saved.general.language).toBe("en");
    expect(saved.privacy.telemetry).toBe(true);
    expect(saved.providers.defaultProvider).toBe("openai");

    const reread = await json("/api/settings");
    expect(reread.general.language).toBe("en");
    expect(reread.general.theme).toBe("amber"); // 未改字段保持
  });

  test("缺节 → 400 SETTINGS_INVALID，现值不变", async () => {
    const full = await json("/api/settings");
    const missing = { ...full } as Partial<SettingsValues>;
    delete missing.advanced;
    const res = await req("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(missing),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
    expect(data.error).toContain("advanced");
    expect((await json("/api/settings")).general.language).toBe("en");
  });

  test("未知节 → 400 SETTINGS_INVALID", async () => {
    const full = await json("/api/settings");
    const res = await req("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...full, extra: {} }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
  });
});

describe("POST /api/settings/reset", () => {
  test("重启保留：新 server 实例（同数据目录）读回保存值", async () => {
    const second = await startStudioServer({ port: 0, dataDir });
    try {
      const res = await fetch(`http://127.0.0.1:${second.port}/api/settings`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as SettingsValues;
      expect(data.general.theme).toBe("amber");
      expect(data.general.language).toBe("en");
      expect(data.privacy.telemetry).toBe(true);
      expect(data.interface.fontSize).toBe("lg");
    } finally {
      await second.close();
    }
  });

  test("指定节重置：目标节回默认，其他节保留", async () => {
    const data = await json("/api/settings/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections: ["general"] }),
    });
    expect(data.general).toEqual(DEFAULT_SETTINGS.general);
    expect(data.privacy.telemetry).toBe(true); // 未重置节保留
    expect(data.interface.fontSize).toBe("lg");
  });

  test("未知节 → 400 SETTINGS_INVALID", async () => {
    const res = await req("/api/settings/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections: ["nope"] }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SETTINGS_INVALID");
  });

  test("无 body / 空 sections → 全部恢复默认", async () => {
    const noBody = await json("/api/settings/reset", { method: "POST" });
    expect(noBody).toEqual(DEFAULT_SETTINGS);
    await json("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ general: { theme: "rose" } }),
    });
    const emptySections = await json("/api/settings/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections: [] }),
    });
    expect(emptySections).toEqual(DEFAULT_SETTINGS);
  });
});
