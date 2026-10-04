// 文本测量（QA 溢出检测）：注册字体后用 Skia measureText 实测宽度；与渲染共用同一 font 字符串
import type { SKRSContext2D } from "@napi-rs/canvas";
import { resolveFontFamily } from "./fonts";

/**
 * 渲染/测量共用的 font 简写字符串。
 * 注意：@napi-rs/canvas 不解析裸 `sans-serif` 泛型关键字（渲染为空），故除首个族名外
 * 追加具体回退链（DejaVu/Liberation/Arial 覆盖 Linux/Windows/macOS），Skia 按序取首个可用族。
 */
export function fontString(weight: number, size: number, family: string): string {
  const resolved = resolveFontFamily(family);
  return `${weight} ${size}px "${resolved}", "DejaVu Sans", "Liberation Sans", "Arial", sans-serif`;
}

/** 在给定上下文上测量单行文本宽度（含 letterSpacing；测量后复位为 0px） */
export function measureTextWidth(ctx: SKRSContext2D, content: string, font: string, letterSpacing: number): number {
  ctx.font = font;
  ctx.letterSpacing = `${letterSpacing}px`;
  const width = ctx.measureText(content).width;
  ctx.letterSpacing = "0px";
  return width;
}
