// 服务端错误本地化：错误以 "CODE: detail" 形式到达 —— 已知码查词典，detail 原样保留。
import { useI18n } from "./index";

/** 返回错误文本本地化函数（null/undefined/空串 → null；未知码原样返回）。 */
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
