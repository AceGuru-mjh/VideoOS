// Unit tests for the pure i18n utilities: format.ts (Intl date/number/count/
// duration/relative-time) and detect.ts (browser language preference).
// Date assertions use naive ISO strings (no zone suffix) so expected values
// hold in any runner timezone; "now"-relative cases build their timestamp at
// call time.
import { describe, expect, test } from "bun:test";
import { fmtDuration } from "../components/chat/util";
import { detectBrowserLocale } from "./detect";
import { formatCount, formatDateTime, formatDurationMs, formatNumber, formatRelativeTime, RELATIVE_JUST_NOW_KEY } from "./format";
import { flattenKeys, translate } from "./core";
import { en } from "./en";
import { zh } from "./zh";

/** real dictionary-backed translate, so key wiring is verified too */
const zhT = (key: string, params?: Record<string, string | number>): string => translate(zh, key, params);
const enT = (key: string, params?: Record<string, string | number>): string => translate(en, key, params);

describe("formatDateTime", () => {
  test("zh: naive ISO → 10月5日 14:30（无年份、24 小时制）", () => {
    expect(formatDateTime("zh", "2026-10-05T14:30:00")).toBe("10月5日 14:30");
  });

  test("en: naive ISO → Oct 5, 2:30 PM（无年份、12 小时制）", () => {
    expect(formatDateTime("en", "2026-10-05T14:30:00")).toBe("Oct 5, 2:30 PM");
  });

  test("en: 午夜走 12 小时制", () => {
    expect(formatDateTime("en", "2026-10-05T00:05:00")).toBe("Oct 5, 12:05 AM");
  });

  test("zh: 午夜保持两位小时", () => {
    expect(formatDateTime("zh", "2026-10-05T00:05:00")).toBe("10月5日 00:05");
  });

  test("带时区的 ISO 按本地时区渲染（任意时区下月份标记稳定）", () => {
    const zhOut = formatDateTime("zh", "2026-10-05T12:00:00Z");
    const enOut = formatDateTime("en", "2026-10-05T12:00:00Z");
    // Oct 5 12:00Z stays inside October in every real timezone (UTC±14)
    expect(zhOut).toContain("10月");
    expect(enOut).toContain("Oct");
  });

  test("非法输入 → 空串（不抛错）", () => {
    expect(formatDateTime("zh", "not-a-date")).toBe("");
    expect(formatDateTime("en", "")).toBe("");
    expect(formatDateTime("zh", "2026-13-45T99:99:99")).toBe("");
  });
});

describe("formatNumber / formatCount", () => {
  test("千位分组两语言一致：1234 → 1,234", () => {
    expect(formatNumber("zh", 1234)).toBe("1,234");
    expect(formatNumber("en", 1234)).toBe("1,234");
  });

  test("大数与负数", () => {
    expect(formatNumber("zh", 1234567)).toBe("1,234,567");
    expect(formatNumber("en", -1234567)).toBe("-1,234,567");
    expect(formatNumber("en", 0)).toBe("0");
  });

  test("formatCount 拼接本地化单位（单位串由调用方从词典取）", () => {
    expect(formatCount("zh", 1250, "tokens")).toBe("1,250 tokens");
    expect(formatCount("en", 1250, "tokens")).toBe("1,250 tokens");
    expect(formatCount("zh", 3, "个错误")).toBe("3 个错误");
    expect(formatCount("en", 42, "errors")).toBe("42 errors");
  });
});

describe("formatDurationMs", () => {
  test("技术单位：ms / s / m 三段", () => {
    expect(formatDurationMs(980)).toBe("980ms");
    expect(formatDurationMs(1200)).toBe("1.2s");
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(59_999)).toBe("60.0s");
    expect(formatDurationMs(60_000)).toBe("1m00s");
    expect(formatDurationMs(125_000)).toBe("2m05s");
    expect(formatDurationMs(0)).toBe("0ms");
  });

  test("负数原样透传（与 chat/util fmtDuration 同语义，不隐藏数据错误）", () => {
    expect(formatDurationMs(-500)).toBe("-500ms");
  });

  test("与 components/chat/util fmtDuration 逐字节一致（调用方可无损迁移）", () => {
    for (const ms of [0, 1, 230, 980, 999, 1000, 1400, 59_999, 60_000, 63_000, 125_000, 3_600_000, -500]) {
      expect(formatDurationMs(ms)).toBe(fmtDuration(ms));
    }
  });
});

describe("formatRelativeTime", () => {
  test("just-now 键存在于两份词典（format API 与词典的契约）", () => {
    const zhKeys = new Set(flattenKeys(zh));
    const enKeys = new Set(flattenKeys(en));
    expect(zhKeys.has(RELATIVE_JUST_NOW_KEY)).toBe(true);
    expect(enKeys.has(RELATIVE_JUST_NOW_KEY)).toBe(true);
  });

  test("< 1 分钟 → 词典 just-now 键", () => {
    const iso = new Date(Date.now() - 10_000).toISOString();
    expect(formatRelativeTime("zh", iso, zhT)).toBe("刚刚");
    expect(formatRelativeTime("en", iso, enT)).toBe("just now");
  });

  test("分钟档：zh 3 分钟前 / en 3 minutes ago", () => {
    const iso = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(formatRelativeTime("zh", iso, zhT)).toContain("3");
    expect(formatRelativeTime("zh", iso, zhT)).toContain("分钟");
    expect(formatRelativeTime("en", iso, enT)).toBe("3 minutes ago");
  });

  test("小时档", () => {
    const iso = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(formatRelativeTime("zh", iso, zhT)).toContain("小时");
    expect(formatRelativeTime("en", iso, enT)).toBe("5 hours ago");
  });

  test("天档（< 7 天）", () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime("zh", iso, zhT)).toContain("天");
    expect(formatRelativeTime("en", iso, enT)).toBe("2 days ago");
  });

  test("≥ 7 天 → 绝对日期兜底（与 formatDateTime 一致）", () => {
    const iso = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(formatRelativeTime("zh", iso, zhT)).toBe(formatDateTime("zh", iso));
    expect(formatRelativeTime("en", iso, enT)).toBe(formatDateTime("en", iso));
  });

  test("未来时间走 in/后 方向", () => {
    const iso = new Date(Date.now() + 3 * 60_000).toISOString();
    expect(formatRelativeTime("en", iso, enT)).toBe("in 3 minutes");
    expect(formatRelativeTime("zh", iso, zhT)).toContain("3");
    expect(formatRelativeTime("zh", iso, zhT)).toContain("分钟");
  });

  test("非法输入 → 空串", () => {
    expect(formatRelativeTime("zh", "garbage", zhT)).toBe("");
    expect(formatRelativeTime("en", "", enT)).toBe("");
  });
});

describe("detectBrowserLocale", () => {
  test("空列表 / 全不识别 → fallback（默认 zh）", () => {
    expect(detectBrowserLocale([])).toBe("zh");
    expect(detectBrowserLocale(["fr-FR", "de-DE", "ja-JP"])).toBe("zh");
    expect(detectBrowserLocale(["fr-FR"], "en")).toBe("en");
  });

  test("zh* 标签 → zh（简繁、区域变体）", () => {
    expect(detectBrowserLocale(["zh"])).toBe("zh");
    expect(detectBrowserLocale(["zh-CN", "en-US"])).toBe("zh");
    expect(detectBrowserLocale(["zh-Hant-TW"])).toBe("zh");
    expect(detectBrowserLocale(["en-US", "zh-CN"])).toBe("en"); // 顺序即优先级
  });

  test("en* 标签 → en", () => {
    expect(detectBrowserLocale(["en"])).toBe("en");
    expect(detectBrowserLocale(["en-GB"])).toBe("en");
    expect(detectBrowserLocale(["fr-FR", "en-US"])).toBe("en"); // 跳过不认识的
  });

  test("大小写与下划线变体宽容", () => {
    expect(detectBrowserLocale(["EN-US"])).toBe("en");
    expect(detectBrowserLocale(["ZH_cn"])).toBe("zh");
  });

  test("稀疏输入防御：非字符串条目跳过", () => {
    expect(detectBrowserLocale(["fr-FR", "", "en-US"])).toBe("en");
  });
});
