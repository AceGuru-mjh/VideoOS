// @videoos/encode：ffmpeg 编码 + 高层渲染管线（VIR → 帧缓存 → PNG 序列 → MP4/WebM）
export { detectFfmpeg, ffmpegVersion, FfmpegEncoder } from "./ffmpeg";
export { renderToVideo, renderFramePng } from "./pipeline";
export { EncodeError } from "./types";
export type {
  EncodeAudioOptions,
  EncodeOptions,
  EncodeResult,
  RenderFramePngInput,
  RenderPipelineInput,
  RenderPipelineResult,
  RenderProgress,
  VideoCodec,
} from "./types";
