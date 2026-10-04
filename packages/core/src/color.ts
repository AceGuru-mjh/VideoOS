// 颜色工具：#rgb/#rrggbb/#rrggbbaa 规范化、alpha 乘法混合、相对亮度判断
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 校验并规范化为小写 #rrggbb 或 #rrggbbaa；#rgb 会展开为 6 位 */
export function normalizeColor(hex: string): string {
  if (typeof hex !== "string" || !HEX_COLOR_RE.test(hex)) {
    throw new Error(`Invalid color ${JSON.stringify(hex)}: expected #rgb, #rrggbb or #rrggbbaa`);
  }
  const body = hex.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

/** 设置/混合 alpha：已有 alpha 与传入 alpha 相乘（0-1 clamp），返回 #rrggbb(aa) */
export function withAlpha(color: string, alpha: number): string {
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) {
    throw new RangeError(`withAlpha: alpha must be a finite number, got ${String(alpha)}`);
  }
  const normalized = normalizeColor(color);
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const existing = normalized.length === 9 ? parseInt(normalized.slice(7, 9), 16) / 255 : 1;
  const blended = Math.round(existing * a * 255);
  return `${normalized.slice(0, 7)}${blended.toString(16).padStart(2, "0")}`;
}

/** 感知亮度（Rec.601 luma = 0.299R+0.587G+0.114B）/255 < 0.5 视为深色（alpha 忽略） */
export function isDark(color: string): boolean {
  const n = normalizeColor(color);
  const channel = (h: string): number => parseInt(h, 16);
  const luma = 0.299 * channel(n.slice(1, 3)) + 0.587 * channel(n.slice(3, 5)) + 0.114 * channel(n.slice(5, 7));
  return luma / 255 < 0.5;
}
