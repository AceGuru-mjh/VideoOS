// i18n 纯逻辑核心（无 React 依赖，可独立测试）：
// 词典 = 嵌套对象；键 = 点路径（"topbar.compile"）；参数 = {name} 占位插值。
export type Locale = "zh" | "en";

export interface Dictionary {
  [key: string]: string | Dictionary;
}

/** 点路径查词典；缺失返回键本身（开发期可见、生产不崩溃）；{param} 插值 */
export function translate(dict: Dictionary, key: string, params?: Record<string, string | number>): string {
  let node: string | Dictionary = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return key;
    node = node[part];
    if (node === undefined) return key;
  }
  if (typeof node !== "string") return key;
  if (params === undefined) return node;
  return node.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 展开词典全部键（点路径；仅字符串叶子）— zh/en 键位奇偶校验用 */
export function flattenKeys(dict: Dictionary, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix.length > 0 ? `${prefix}.${k}` : k;
    if (typeof v === "string") keys.push(path);
    else keys.push(...flattenKeys(v, path));
  }
  return keys;
}

/** 顶层段合并（后者覆盖同名段）— common（既有 UI）与 chat（对话子系统）词典组装 */
export function mergeDicts(...dicts: Dictionary[]): Dictionary {
  const merged: Dictionary = {};
  for (const dict of dicts) {
    for (const [k, v] of Object.entries(dict)) merged[k] = v;
  }
  return merged;
}

/** 读取点路径处的子词典（平铺 dotted-key 映射用，如任务卡标签表 {"compile.run": "编译"}） */
export function section(dict: Dictionary, path: string): Record<string, string> | null {
  let node: string | Dictionary = dict;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = node[part];
    if (node === undefined) return null;
  }
  if (typeof node !== "object" || node === null) return null;
  return node as Record<string, string>;
}

/** 两词典顶层段交集（应为空——段所有权互斥，奇偶测试用） */
export function topLevelOverlap(a: Dictionary, b: Dictionary): string[] {
  const keysA = new Set(Object.keys(a));
  return Object.keys(b).filter((k) => keysA.has(k));
}
