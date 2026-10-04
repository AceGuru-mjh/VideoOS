// 过渡匹配：相邻场景对的入场过渡查找（crossfade/fade-black 产生重叠，cut 不重叠）
import type { VirTransition } from "@videoos/vir";

export interface IncomingTransition { type: "crossfade" | "fade-black"; duration: number }

/** 查找声明在 (prevName → sceneName) 上的首个产生重叠的过渡 */
export function findIncomingTransition(
  prevName: string,
  sceneName: string,
  transitions: readonly VirTransition[],
): IncomingTransition | undefined {
  for (const t of transitions) {
    if (t.between[0] === prevName && t.between[1] === sceneName
      && (t.type === "crossfade" || t.type === "fade-black")) {
      return { type: t.type, duration: t.duration };
    }
  }
  return undefined;
}

/** 查找声明在 (prevName → sceneName) 上的任意过渡（含 cut），用于“已应用”标记 */
export function findAnyTransition(
  prevName: string,
  sceneName: string,
  transitions: readonly VirTransition[],
): VirTransition | undefined {
  return transitions.find((t) => t.between[0] === prevName && t.between[1] === sceneName);
}
