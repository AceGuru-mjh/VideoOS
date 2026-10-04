// @videoos/core：零依赖基础库（确定性 rng / easing / color / geo / time）
export { createRng } from "./rng";
export type { Rng } from "./rng";
export {
  easing, isEasingName, EASING_NAMES,
  linear, easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
  easeOutExpo, easeOutBack, spring, bounce,
} from "./easing";
export type { EasingFn, EasingParams, SpringParams } from "./easing";
export { normalizeColor, withAlpha, isDark } from "./color";
export { resolvePosition, clamp, lerp } from "./geo";
export type { Point, Size, PositionInput } from "./geo";
export { framesToSeconds, secondsToFrames, formatTimecode } from "./time";
