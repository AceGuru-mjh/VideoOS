// @videoos/render-canvas 公共类型：渲染选项与产物契约（cache/encode/qa/server 依赖此定义）
import type { Vir, VirLayer } from "@videoos/vir";

/** 项目字体注册（assets/fonts）；family 用于匹配 text.font */
export interface FontRegistration {
  family: string;
  path: string;
}

export interface RenderOptions {
  /** 渲染前注册的项目字体（GlobalFonts.registerFromPath）；系统字体（DejaVu Sans 等）无需注册 */
  fonts?: FontRegistration[];
  /** 设备像素倍率，默认 1；物理画布 = width × deviceScale，绘制坐标保持逻辑像素 */
  deviceScale?: number;
  /** 相对 image src 的解析根目录（默认 process.cwd()）；绝对路径原样使用 */
  assetRoot?: string;
}

/** 单帧栅格化产物：width/height 为视频逻辑尺寸；PNG/DataURL 按 deviceScale 输出物理像素 */
export interface RenderedFrame {
  frame: number;
  width: number;
  height: number;
  /** canvas.toBuffer("image/png")；同输入字节级一致（确定性契约） */
  toPng(): Buffer;
  toDataUrl(): string;
  /** 原生 @napi-rs/canvas Canvas 实例（server 预览等直接复用；类型 unknown 保持后端中立） */
  canvas: unknown;
}

/** 文本测量结果（QA 溢出断言用）；height = size × lineHeight（附录 A：v1 单行） */
export interface TextMetrics {
  width: number;
  height: number;
}

export interface Renderer {
  readonly vir: Vir;
  readonly totalFrames: number;
  /** 越界帧 clamp 到 [0, totalFrames-1]；非有限数抛 RenderError */
  renderFrame(frame: number): RenderedFrame;
  /**
   * 渲染闭区间 [from, to]（两端各自 clamp）；from > to 返回空数组。
   * onFrame(frame, i) 逐帧回调，i 为结果数组下标（0 起）。
   */
  renderRange(from: number, to: number, onFrame?: (f: RenderedFrame, i: number) => void): RenderedFrame[];
  /**
   * 测量文本图层自然尺寸（不含动画/场景/相机系数，供 QA 溢出检测）。
   * layer 可传 text 型 VirLayer，或图层 id/name 字符串（此时可用 sceneId 按 id/name 限定场景）。
   */
  measureText(layer: VirLayer | string, sceneId?: string): TextMetrics;
}

/** 渲染器错误（code 前缀 RENDER_*；message 以 `${code}: ` 开头便于正则断言） */
export class RenderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "RenderError";
    this.code = code;
  }
}
