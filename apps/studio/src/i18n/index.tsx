// i18n React 层：Provider + useI18n + 即时切换（localStorage 优先，服务端 settings 兜底同步）。
// 全 studio 唯一语言事实源；切语言零刷新——所有字符串经 t() 订阅重渲。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api";
import { translate, type Dictionary, type Locale } from "./core";
import { en } from "./en";
import { zh } from "./zh";

const LOCALE_STORAGE_KEY = "videoos.language";

export interface I18nValue {
  locale: Locale;
  /** 点路径查词（"topbar.compile"）；缺失回显键本身；{param} 插值 */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** 即时切换（写 localStorage + 异步同步服务端 settings） */
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return raw === "zh" || raw === "en" ? raw : null;
  } catch {
    return null;
  }
}

function initialLocale(): Locale {
  return readStoredLocale() ?? "zh";
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const syncedRef = useRef(false);

  // 启动同步：本地无偏好时采纳服务端 settings.language（服务端不可达则静默保持）
  useEffect(() => {
    if (readStoredLocale() !== null) {
      syncedRef.current = true;
      return;
    }
    let cancelled = false;
    api
      .getSettings()
      .then(({ settings }) => {
        if (cancelled || syncedRef.current) return;
        syncedRef.current = true;
        if (settings.language === "zh" || settings.language === "en") setLocaleState(settings.language);
      })
      .catch(() => {
        // 旧 server / 网络异常——本地默认即可
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // html lang 跟随（无障碍 / 输入法提示）
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    syncedRef.current = true;
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // private mode — 本次会话内仍生效
    }
    void api.putSettings({ language: next }).catch(() => {
      // 服务端同步失败不影响本地切换
    });
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict: Dictionary = locale === "zh" ? zh : en;
    return {
      locale,
      t: (key, params) => translate(dict, key, params),
      setLocale,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used within <I18nProvider>");
  return value;
}
