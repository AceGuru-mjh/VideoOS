// 服务端错误本地化助手：服务端错误形如 "CODE: detail"（或可读文本）。
// 已知错误码查 errors.CODE 本地化并保留 detail；未知码 / 非码错误原样透传。
import { useI18n } from "./index";

/** Server errors arrive as "CODE: detail" (or readable text) — localize known codes, keep detail. */
export function useApiErrorMessage(): (error: string | null | undefined) => string | null {
  const { t } = useI18n();
  return (error) => {
    if (error === null || error === undefined || error.length === 0) return null;
    const m = /^([A-Z][A-Z0-9_]+): (.*)$/s.exec(error);
    if (m !== null) {
      const localized = t(`errors.${m[1]}`);
      return localized === `errors.${m[1]}` ? error : `${localized} (${m[2]})`;
    }
    return error;
  };
}
