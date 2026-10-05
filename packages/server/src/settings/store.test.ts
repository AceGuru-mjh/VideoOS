// SettingsStore 单元测试：默认值 / 深合并 / 全量替换 / 重置 / 损坏恢复 / 原子写 / 重启保留。
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ServerError } from "../errors";
import { SettingsStore } from "./store";
import { DEFAULT_SETTINGS, SETTINGS_SECTION_NAMES, SettingsValuesSchema, type SettingsValues } from "./schema";

const root = mkdtempSync(join(tmpdir(), "vos-settings-store-"));
const dirOf = (name: string): string => join(root, name);

/** 断言抛 SETTINGS_INVALID（code + status + message 片段） */
async function expectSettingsInvalid(fn: () => unknown, messagePart?: string): Promise<void> {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ServerError);
  const err = caught as ServerError;
  expect(err.code).toBe("SETTINGS_INVALID");
  expect(err.status).toBe(400);
  expect(err.message).toContain("SETTINGS_INVALID");
  if (messagePart !== undefined) expect(err.message).toContain(messagePart);
}

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SettingsStore", () => {
  test("DEFAULT_SETTINGS 满足 SettingsValuesSchema（防字面量与 schema 漂移）", () => {
    expect(SettingsValuesSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  test("全新目录 → 默认值；只读构造不落盘", () => {
    const store = new SettingsStore(dirOf("fresh"));
    const values = store.get();
    expect(Object.keys(values).sort()).toEqual([...SETTINGS_SECTION_NAMES].sort());
    expect(values).toEqual(DEFAULT_SETTINGS);
    expect(values.general.theme).toBe("midnight");
    expect(values.agent.autonomy).toBe("L3");
    expect(values.agent.maxSteps).toBe(12);
    expect(values.render.preset).toBe("1080p30");
    expect(values.privacy.logRetentionDays).toBe(14);
    expect(existsSync(join(dirOf("fresh"), "settings.json"))).toBe(false);
  });

  test("update 深合并：嵌套键变更保留兄弟键与其他节", () => {
    const store = new SettingsStore(dirOf("update"));
    store.update({ general: { theme: "amber" }, render: { concurrency: 4 } });
    const after = store.update({ general: { language: "en" } });
    expect(after.general.theme).toBe("amber"); // 兄弟键保留
    expect(after.general.language).toBe("en");
    expect(after.general.onboarded).toBe(false);
    expect(after.general.startup).toBe("last-session");
    expect(after.render.concurrency).toBe(4); // 其他节保留
    expect(after.agent.maxSteps).toBe(12);
  });

  test("update 对象字段（toolPermissions）按键合并、数组整体覆盖", () => {
    const store = new SettingsStore(dirOf("merge-record"));
    store.update({ agent: { toolPermissions: { "shell.run": "confirm" } } });
    const after = store.update({
      agent: { toolPermissions: { "file.write": "deny" }, maxSteps: 24 },
      providers: { entries: [{ id: "openai", type: "manual", baseUrl: "", model: "gpt-4o" }] },
    });
    expect(after.agent.toolPermissions).toEqual({ "shell.run": "confirm", "file.write": "deny" });
    expect(after.agent.maxSteps).toBe(24);
    expect(after.providers.entries).toEqual([{ id: "openai", type: "manual", baseUrl: "", model: "gpt-4o" }]); // 数组整体覆盖
  });

  test("update 非法值 / 未知节 → SETTINGS_INVALID 且状态不变、不落盘", async () => {
    const store = new SettingsStore(dirOf("invalid"));
    await expectSettingsInvalid(() => store.update({ general: { theme: "nope" } }), "theme");
    await expectSettingsInvalid(() => store.update({ nope: { x: 1 } }));
    await expectSettingsInvalid(() => store.update("not-an-object"));
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(join(dirOf("invalid"), "settings.json"))).toBe(false);
  });

  test("replace 全量替换；缺节 / 未知节 → SETTINGS_INVALID 且原值保持", async () => {
    const store = new SettingsStore(dirOf("replace"));
    const full: SettingsValues = store.get();
    full.privacy.telemetry = true;
    full.general.onboarded = true;
    const after = store.replace(full);
    expect(after.privacy.telemetry).toBe(true);
    expect(after.general.onboarded).toBe(true);

    const missing = { ...store.get() } as Partial<SettingsValues>;
    delete missing.advanced;
    await expectSettingsInvalid(() => store.replace(missing), "advanced");
    await expectSettingsInvalid(() => store.replace({ ...store.get(), extra: {} }));
    expect(store.get().privacy.telemetry).toBe(true); // 失败不影响现值
  });

  test("reset 单节保留其他节；不传 / 空数组 → 全部；未知节 → SETTINGS_INVALID", async () => {
    const store = new SettingsStore(dirOf("reset"));
    store.update({ general: { theme: "amber", onboarded: true }, render: { concurrency: 4 } });
    const one = store.reset(["general"]);
    expect(one.general).toEqual(DEFAULT_SETTINGS.general);
    expect(one.render.concurrency).toBe(4); // 未重置的节保留
    expect(store.reset([])).toEqual(DEFAULT_SETTINGS);
    store.update({ general: { theme: "rose" } });
    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
    await expectSettingsInvalid(() => store.reset(["nope"]));
  });

  test("损坏 JSON → 默认值 + settings.json.bad 备份保留", () => {
    const dir = dirOf("corrupt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), "{ not valid json !!!", "utf8");
    const store = new SettingsStore(dir);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(readFileSync(join(dir, "settings.json.bad"), "utf8")).toBe("{ not valid json !!!");
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });

  test("schema 不通过的文件（坏枚举）→ 默认值 + .bad 备份", () => {
    const dir = dirOf("corrupt-enum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ general: { theme: 123 }, privacy: { telemetry: true } }));
    const store = new SettingsStore(dir);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(join(dir, "settings.json.bad"))).toBe(true);
  });

  test("升级兼容：旧版文件缺节/缺字段 → 补默认，未知键剥除，非损坏", () => {
    const dir = dirOf("upgrade");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ general: { theme: "amber", futureKey: 1 } }));
    const store = new SettingsStore(dir);
    const values = store.get();
    expect(values.general.theme).toBe("amber");
    expect(values.general.language).toBe("zh"); // 节内缺省字段补默认
    expect("futureKey" in values.general).toBe(false); // 未知键剥除
    expect(values.privacy.telemetry).toBe(false); // 缺失节补默认
    expect(existsSync(join(dir, "settings.json.bad"))).toBe(false);
  });

  test("原子写：目录内仅 settings.json（无 tmp 残留）+ mode 0o600", () => {
    const dir = dirOf("atomic");
    const store = new SettingsStore(dir);
    store.update({ general: { theme: "amber" } });
    store.replace(store.get());
    store.reset(["general"]);
    expect(readdirSync(dir)).toEqual(["settings.json"]);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "settings.json")).mode & 0o777).toBe(0o600);
    }
  });

  test("重启保留：新实例同目录读回保存值", () => {
    const dir = dirOf("restart");
    const first = new SettingsStore(dir);
    first.update({ general: { theme: "forest" }, privacy: { logLevel: "debug" }, agent: { maxSteps: 30 } });
    const second = new SettingsStore(dir);
    const values = second.get();
    expect(values.general.theme).toBe("forest");
    expect(values.privacy.logLevel).toBe("debug");
    expect(values.agent.maxSteps).toBe(30);
  });

  test("get 返回深拷贝：修改返回值不影响 store", () => {
    const store = new SettingsStore(dirOf("clone"));
    const values = store.get();
    values.general.theme = "rose";
    values.agent.toolPermissions["shell.run"] = "deny";
    expect(store.get().general.theme).toBe("midnight");
    expect(store.get().agent.toolPermissions).toEqual({});
  });
});
