// 命名动画效果常量（VIR 动画 effect 的合法取值；loop 类型 v1 仅按 sin 波动处理 fade 语义）
export const VIDEO_EFFECTS = [
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "blur-up",
  "blur-in",
  "scale-pop",
  "typewriter",
  "wipe",
] as const;

export type VideoEffect = (typeof VIDEO_EFFECTS)[number];

export function isVideoEffect(name: string): name is VideoEffect {
  return (VIDEO_EFFECTS as readonly string[]).includes(name);
}
