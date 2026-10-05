// Locale-aware formatting utilities (pure functions, no React):
//   - date/time, numbers, counts → Intl, follows the active locale
//   - durations → technical unit (no locale variance, parity with
//     components/chat/util fmtDuration so call sites can adopt this module)
//   - relative time → Intl.RelativeTimeFormat + one dictionary key for the
//     "< 1 minute" bucket (Intl has no "just now" concept)
// All helpers return "" for invalid input instead of throwing — a broken
// timestamp must never crash a render pass.
import type { Locale } from "./core";

export type { Locale };

/** Shape of the translate function exposed by useI18n / core.translate. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Dictionary key rendered for timestamps younger than one minute.
 * Lives in the chatStream section (chatStream.relNow: "刚刚" / "just now").
 */
export const RELATIVE_JUST_NOW_KEY = "chatStream.relNow";

/** Beyond a week, relative time stops being useful — show the absolute date. */
const RELATIVE_DAY_LIMIT = 7;

/** Map the two-product locales onto full BCP-47 tags for Intl. */
const INTL_LOCALE: Record<Locale, string> = { zh: "zh-CN", en: "en-US" };

/**
 * ISO timestamp → short date-time: "10月5日 14:30" (zh) / "Oct 5, 2:30 PM" (en).
 * No year component (Studio surfaces same-project timestamps). Invalid input → "".
 * Naive timestamps (no zone suffix) round-trip in the local zone; zoned ones
 * render in the viewer's local time — standard Date semantics.
 */
export function formatDateTime(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions =
    locale === "zh"
      ? { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], opts).format(date);
}

/** number → locale-grouped string: 1234 → "1,234" in both locales. */
export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n);
}

/**
 * number + unit → "1,250 tokens" / "3 个错误". The unit string is expected to
 * come from the dictionary (already localized); this helper only formats the
 * count and joins — a thin wrapper so call sites stay uniform.
 */
export function formatCount(locale: Locale, n: number, unit: string): string {
  return `${formatNumber(locale, n)} ${unit}`;
}

/**
 * Milliseconds → technical duration: "980ms" / "1.2s" / "1m03s".
 * Locale-independent by design (matches components/chat/util fmtDuration
 * byte-for-byte, including the negative pass-through), so technical readouts
 * do not shift when the UI language changes.
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms - m * 60_000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/**
 * ISO timestamp → relative time: "3 分钟前" (zh) / "3 minutes ago" (en) via
 * Intl.RelativeTimeFormat. Buckets (matching the legacy chat util semantics):
 *   < 60 s        → t(RELATIVE_JUST_NOW_KEY)   — "刚刚" / "just now"
 *   < 1 h / < 24 h / < 7 d → minutes / hours / days (auto numeric)
 *   ≥ 7 d         → formatDateTime(locale, iso) — absolute fallback
 * Future timestamps render "in …"/"…后" automatically. Invalid input → "".
 *
 * The `t` param keeps this pure: it receives the active translate function
 * instead of importing React context, so it is testable without a provider.
 */
export function formatRelativeTime(locale: Locale, iso: string, t: TranslateFn): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  const absSeconds = Math.abs(diffMs) / 1000;
  if (absSeconds < 60) return t(RELATIVE_JUST_NOW_KEY);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const sign = diffMs < 0 ? -1 : 1;
  if (absSeconds < 3_600) return rtf.format(sign * Math.round(absSeconds / 60), "minute");
  if (absSeconds < 86_400) return rtf.format(sign * Math.round(absSeconds / 3_600), "hour");
  if (absSeconds < RELATIVE_DAY_LIMIT * 86_400) {
    return rtf.format(sign * Math.round(absSeconds / 86_400), "day");
  }
  return formatDateTime(locale, iso);
}
