// Browser language detection (pure): navigator.languages → "zh" | "en".
// Kept free of DOM access so it is unit-testable and reusable on any runtime.
import type { Locale } from "./core";

export type { Locale };

/**
 * Pick the UI locale from an ordered list of BCP-47 language tags
 * (navigator.languages is preference-ordered — the first recognizable tag
 * wins). Rules:
 *   - any "zh*" tag (zh, zh-CN, zh-Hant-TW, …) → "zh"
 *   - else any "en*" tag (en, en-GB, …) → "en"
 *   - unrecognized / empty list → `fallback`
 *
 * Integration note for I18nProvider (recommendation for the integrator —
 * index.tsx is owned by another task): today the provider boots with
 * `readStoredLocale() ?? "zh"`. A first-visit experience improvement is
 * `readStoredLocale() ?? detectBrowserLocale(navigator.languages)`, i.e.
 * localStorage first (explicit choice persists), then the browser preference,
 * then the "zh" default. The server-side settings.general.language sync
 * (which already only applies when no local preference exists) keeps working
 * unchanged. This module is intentionally NOT wired into the provider yet.
 */
export function detectBrowserLocale(languages: readonly string[], fallback: Locale = "zh"): Locale {
  for (const tag of languages) {
    // defensive: navigator.languages can be sparse if someone hand-rolls it
    if (typeof tag !== "string") continue;
    const normalized = tag.toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("en")) return "en";
  }
  return fallback;
}
