// @videoos/encode 公共类型：ffmpeg 编码选项/产物 + 高层渲染管线契约（CLI render.* 与 server 的基础）
import type { CompileResult } from "@videoos/compiler";
import type { FontRegistration } from "@videoos/render-canvas";

export type VideoCodec = "h264" | "vp9";

/** 音轨混流选项（v1：单音轨 + 音量；fadeIn/fadeOut 由 CLI/server 层展开为 filter 复杂参数） */
export interface EncodeAudioOptions {
  path: string;
  volume?: number;
}

export interface EncodeOptions {
  fps: number;
  width: number;
  height: number;
  /** h264（默认）→ libx264 mp4；vp9 → libvpx-vp9 webm */
  codec?: VideoCodec;
  /** 默认 18 */
  crf?: number;
  /** 默认 "medium"（仅 h264 生效） */
  preset?: string;
  /** 有音轨时混流（-c:a aac/libopus -shortest） */
  audio?: EncodeAudioOptions;
  /** 进度回调：已编码帧数（解析 `-progress pipe:1` 的 frame=N 行） */
  onProgress?: (framesEncoded: number) => void;
}

export interface EncodeResult {
  output: string;
  frames: number;
  durationSeconds: number;
  /** 完整命令行（含引号包装，供诊断/日志展示） */
  command: string;
  /** stderr 尾部（≤ 2000 字符） */
  stderrTail: string;
}

/** 编码/管线错误（code 前缀 ENCODE_*；message 以 `${code}: ` 开头便于正则断言） */
export class EncodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "EncodeError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 高层渲染管线（VIR → 帧缓存 → PNG 序列 → ffmpeg）
// ---------------------------------------------------------------------------

export interface RenderPipelineInput {
  /** 编译产物（@videoos/compiler.compile 的返回值） */
  compileResult: CompileResult;
  /** 输出目录（.video/renders），不存在则创建 */
  outputDir: string;
  /** 缓存根（.video/cache）；默认 outputDir 同级的 cache 目录 */
  cacheRoot?: string;
  /** 项目字体注册（透传 createRenderer） */
  fonts?: FontRegistration[];
  /** v1 仅 canvas */
  backend?: "canvas";
  /** 编码器配置（bin 默认 detectFfmpeg；codec 默认 h264） */
  encoder?: { bin?: string; codec?: VideoCodec; crf?: number; preset?: string };
  onProgress?: (p: RenderProgress) => void;
  /** 范围渲染（闭区间，各自 clamp 到 [0, totalFrames-1]） */
  frames?: { from?: number; to?: number };
  /** 单场景渲染（语义索引定位帧范围；与 frames 互斥） */
  scene?: string;
  /** 相对 image src 的解析根（透传 createRenderer；默认 process.cwd()） */
  assetRoot?: string;
  /** 可选音轨混流（默认不混流；VIR.audio → 音频文件的自动解析属 CLI/server 层职责） */
  audio?: EncodeAudioOptions;
}

export interface RenderProgress {
  phase: "compile" | "render" | "encode";
  /** render 阶段 = 当前帧号（绝对）；encode 阶段 = 已编码帧数；compile 阶段 = 起始帧号 */
  frame: number;
  totalFrames: number;
  cacheHits: number;
  cacheMisses: number;
  message?: string;
}

export interface RenderPipelineResult {
  video: string;
  frames: number;
  durationSeconds: number;
  cacheHits: number;
  cacheMisses: number;
  encodeResult: EncodeResult;
}

/** 单帧渲染入参（renderFramePng） */
export type RenderFramePngInput = Omit<RenderPipelineInput, "encoder" | "frames" | "scene"> & {
  frame: number;
};
