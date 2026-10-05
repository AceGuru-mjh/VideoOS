// 设置持久化存储（SPEC v0.2 §5 §7）：<dataDir>/settings.json。
// - 原子写：同目录 tmp + rename（与 @videoos/workspace memory.ts 同策略），mode 0o600（含 API Key 等敏感配置）
// - 升级兼容：加载与读取均深合并 DEFAULT_SETTINGS → 新节/新字段自动出现；未知键由 schema 剥除
// - 损坏恢复：非法 JSON / schema 不通过 → 以默认值运行，原文件保留为 settings.json.bad 备份 + console.warn
// - 全部变更先经 zod 校验，失败抛 ServerError("SETTINGS_INVALID", ...)（app.onError → 400）
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z, type ZodTypeAny } from "zod";
import { ServerError } from "../errors";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SECTION_NAMES,
  SettingsPatchSchema,
  SettingsReplaceSchema,
  SettingsValuesSchema,
  type SettingsSectionName,
  type SettingsValues,
} from "./schema";

const SETTINGS_FILE = "settings.json";
const BACKUP_FILE = "settings.json.bad";

let tmpSeq = 0;

export class SettingsStore {
  /** 数据目录（settings.json 所在；由 resolveDataDir 决定） */
  readonly dataDir: string;
  private values: SettingsValues;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.values = this.load();
  }

  /** 当前完整设置：深合并默认值（升级后新键自动出现），返回深拷贝（调用方可随意修改） */
  get(): SettingsValues {
    return this.parseOrThrow(SettingsValuesSchema, mergeSettings(DEFAULT_SETTINGS, this.values));
  }

  /**
   * 局部更新 {section: {key: val}}：节内按键合并（对象字段按键合并，数组/原始值整体覆盖），缺席键保持现值。
   * 未知节 / 非法值 → SETTINGS_INVALID。
   */
  update(patch: unknown): SettingsValues {
    const parsed = this.parseOrThrow(SettingsPatchSchema, patch);
    this.values = this.parseOrThrow(SettingsValuesSchema, mergeSettings(this.values, parsed));
    this.persist();
    return this.get();
  }

  /** 全量替换（九节必须齐全；未知节 / 非法值 → SETTINGS_INVALID） */
  replace(values: unknown): SettingsValues {
    const parsed = this.parseOrThrow(SettingsReplaceSchema, values);
    this.values = parsed;
    this.persist();
    return this.get();
  }

  /** 恢复默认：sections 缺省/空数组 → 全部；否则仅指定节（未知节 → SETTINGS_INVALID） */
  reset(sections?: string[]): SettingsValues {
    const names: SettingsSectionName[] =
      sections === undefined || sections.length === 0
        ? [...SETTINGS_SECTION_NAMES]
        : sections.map((name) => {
            if (!(SETTINGS_SECTION_NAMES as readonly string[]).includes(name)) {
              throw new ServerError(
                "SETTINGS_INVALID",
                `unknown settings section: ${JSON.stringify(name)} (expected one of ${SETTINGS_SECTION_NAMES.join(", ")})`,
              );
            }
            return name as SettingsSectionName;
          });
    const next: Record<string, unknown> = { ...this.values };
    for (const name of names) next[name] = structuredClone(DEFAULT_SETTINGS[name]);
    this.values = this.parseOrThrow(SettingsValuesSchema, next);
    this.persist();
    return this.get();
  }

  // ---------------------------------------------------------------- internals

  private load(): SettingsValues {
    const file = join(this.dataDir, SETTINGS_FILE);
    if (!existsSync(file)) return structuredClone(DEFAULT_SETTINGS);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      this.backupCorrupt(file, err);
      return structuredClone(DEFAULT_SETTINGS);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.backupCorrupt(file, err);
      return structuredClone(DEFAULT_SETTINGS);
    }
    const parsed = SettingsValuesSchema.safeParse(isPlainObject(data) ? mergeSettings(DEFAULT_SETTINGS, data) : data);
    if (!parsed.success) {
      this.backupCorrupt(file, new Error(issuesToMessage(parsed.error.issues)));
      return structuredClone(DEFAULT_SETTINGS);
    }
    return parsed.data;
  }

  /** 损坏文件处置：改名保留为 settings.json.bad（旧备份先删，Windows rename 不覆盖），随后以默认值运行 */
  private backupCorrupt(file: string, cause: unknown): void {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[videoos/server] settings file corrupt (${reason}); using defaults (backup kept at ${BACKUP_FILE})`);
    try {
      const backup = join(this.dataDir, BACKUP_FILE);
      try {
        unlinkSync(backup);
      } catch {
        // 无旧备份
      }
      renameSync(file, backup);
    } catch (err) {
      console.warn(`[videoos/server] settings backup failed (${err instanceof Error ? err.message : String(err)}); continuing with defaults`);
    }
  }

  /** 原子持久化：tmp + rename（mode 0o600）；目录不存在时自动创建 */
  private persist(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const file = join(this.dataDir, SETTINGS_FILE);
    const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
    writeFileSync(tmp, `${JSON.stringify(this.values, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }

  /**
   * 校验并取输出类型：泛型基于 ZodTypeAny + z.output（而非 ZodType<T>）——
   * mcp.servers 带 .catch([])（issue #53 迁移容错）后 schema 的输入/输出类型不同，
   * ZodType<T> 形参会把 T 推断成输入类型导致赋值失配。
   */
  private parseOrThrow<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new ServerError("SETTINGS_INVALID", issuesToMessage(result.error.issues));
    }
    return result.data;
  }
}

/** zod issues → 可读多行消息（"path: message" 每行一条；根级错误无 path 前缀；providers.ts 共用） */
export function issuesToMessage(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("\n");
}

/**
 * 节级深合并：override 提供的节按键合并进 base（节内对象字段按键合并，数组/原始值整体覆盖），缺席节保留 base。
 * 非法形状（null/数字等）原样透传，交由 schema 校验拦截 —— 加载容错（缺节补默认）与 PATCH 语义共用。
 */
function mergeSettings(base: SettingsValues, override: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of SETTINGS_SECTION_NAMES) {
    const over = override[name];
    if (over === undefined) {
      out[name] = base[name];
    } else if (isPlainObject(over)) {
      out[name] = mergeSection(base[name] as Record<string, unknown>, over);
    } else {
      out[name] = over;
    }
  }
  return out;
}

/** 节内按键合并：over 提供的键覆盖（双方均为普通对象时再深一层按键合并），缺席键保留 base */
function mergeSection(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) {
    const current = out[key];
    const value = over[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? { ...current, ...value } : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
