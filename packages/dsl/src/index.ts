// @videoos/dsl：视频 DSL 构建器（defineVideo → VideoDefinition）
export { defineVideo } from "./builder";
export { DslError } from "./errors";
export { VIDEO_EFFECTS, isVideoEffect } from "./effects";
export type { VideoEffect } from "./effects";
export type {
  Align, CameraType, TransitionType, AnimationKind, LayerType,
  PositionInput, VideoMetaInput, AnimInput,
  CommonLayerOptions, TextOptions, RectOptions, EllipseOptions, ImageOptions,
  BeatOptions, SceneOptions, TransitionOptions, AudioOptions,
  SceneBuilder, VideoBuilder,
  ResolvedMeta, RawTransform, RawAnimation,
  RawTextProps, RawRectProps, RawEllipseProps, RawImageProps,
  RawLayerBase, RawLayer, RawBeat, RawCamera, RawScene, RawTransition, RawAudio,
  VideoProgram, VideoDefinition,
} from "./types";
