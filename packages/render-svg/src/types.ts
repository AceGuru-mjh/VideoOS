// @videoos/render-svg 公共类型：与 render-canvas 的 createRenderer 契约对齐（矢量帧输出）
import type { Vir } from "@videoos/vir";

/** 契约兼容项：SVG 后端为纯字符串生成，不消费字体注册（font-family 直接写入，由查看器本地字体渲染） */
export interface FontRegistration {
  family: string;
  path: string;
}

export interface RenderOptions {
  /** 接受但忽略：字体族名直接写入 font-family，由查看器用本地字体渲染 */
  fonts?: FontRegistration[];
  /** 接受但忽略：矢量输出无设备像素概念 */
  deviceScale?: number;
  /** 相对 image src 的解析根目录（默认 process.cwd()），转 file:// URI 前先绝对化 */
  assetRoot?: string;
}

/** SVG 帧产物：合法 `<svg xmlns viewBox>` 文档字符串；同输入字节级一致（确定性契约） */
export interface SvgFrame {
  frame: number;
  width: number;
  height: number;
  svg: string;
  toPng?: undefined;
}

export interface SvgRenderer {
  readonly vir: Vir;
  readonly totalFrames: number;
  /** 越界帧 clamp 到 [0, totalFrames-1]；非有限数抛 RenderError */
  renderFrame(frame: number): SvgFrame;
  /** 渲染闭区间 [from, to]（两端各自 clamp）；from > to 返回空数组 */
  renderRange(from: number, to: number): SvgFrame[];
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
