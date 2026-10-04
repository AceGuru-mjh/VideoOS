// DSL 即时校验辅助：命名、颜色、位置、数值、枚举
import { normalizeColor } from "@videoos/core";
import { DslError } from "./errors";
import type { CameraType, PositionInput, TransitionType, Align } from "./types";

export const CAMERA_TYPES: readonly CameraType[] = ["static", "push-in", "pull-out", "pan"];
export const TRANSITION_TYPES: readonly TransitionType[] = ["cut", "crossfade", "fade-black"];
export const ALIGNS: readonly Align[] = ["left", "center", "right"];

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const PERCENT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)%$/;

/** 名称需为语义标识符（Unicode 字母/数字开头，允许 - _），保证派生 id 稳定 */
export function assertIdentifierName(name: string, kind: string, context = ""): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new DslError("DSL_INVALID_NAME", `${context ? context + ": " : ""}${kind} name must match [letter|number][letter|number|_-]*, got ${JSON.stringify(name)}`);
  }
}

export function assertColor(value: string, context: string): string {
  try {
    return normalizeColor(value);
  } catch (err) {
    throw new DslError("DSL_INVALID_COLOR", `${context}: ${(err as Error).message}`);
  }
}

export function assertPosition(pos: PositionInput, context: string): void {
  if (pos === null || typeof pos !== "object") {
    throw new DslError("DSL_INVALID_POSITION", `${context}: "at" must be { x, y }`);
  }
  for (const axis of ["x", "y"] as const) {
    const v = pos[axis];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        throw new DslError("DSL_INVALID_POSITION", `${context}: at.${axis} must be a finite number, got ${String(v)}`);
      }
    } else if (typeof v === "string") {
      if (!PERCENT_RE.test(v.trim())) {
        throw new DslError("DSL_INVALID_POSITION", `${context}: at.${axis} must be a number or percent like "50%", got ${JSON.stringify(v)}`);
      }
    } else {
      throw new DslError("DSL_INVALID_POSITION", `${context}: at.${axis} must be number|string, got ${typeof v}`);
    }
  }
}

export function assertFiniteNumber(value: number, context: string, code = "DSL_INVALID_VALUE"): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DslError(code, `${context} must be a finite number, got ${String(value)}`);
  }
}

export function assertPositiveNumber(value: number, context: string, code = "DSL_INVALID_VALUE"): void {
  assertFiniteNumber(value, context, code);
  if (value <= 0) {
    throw new DslError(code, `${context} must be > 0, got ${value}`);
  }
}

export function assertNonNegativeNumber(value: number, context: string, code = "DSL_INVALID_VALUE"): void {
  assertFiniteNumber(value, context, code);
  if (value < 0) {
    throw new DslError(code, `${context} must be >= 0, got ${value}`);
  }
}

export function assertEnum<T extends string>(value: T, allowed: readonly T[], kind: string, code: string): void {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DslError(code, `Unknown ${kind} ${JSON.stringify(value)} (available: ${allowed.join(", ")})`);
  }
}
