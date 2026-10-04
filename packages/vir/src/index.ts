// @videoos/vir：VIR 类型、zod schema、结构化解析与语义索引
export type {
  Vir, VirMeta, VirScene, VirLayer, VirLayerBase, VirLayerType,
  VirTransform, VirVec2, VirAnimation, VirAnimationType,
  VirTextProps, VirRectProps, VirEllipseProps, VirImageProps,
  VirBeat, VirCamera, VirCameraType, VirTransition, VirTransitionType,
  VirAudioClip, VirAssetRef, VirAssetType, VirGraphs,
} from "./types";
export {
  VirSchema, parseVir, VirParseError,
  VirVec2Schema, VirPositionSchema, VirTransformSchema,
  VirAnimationSchema, VirAnimationTypeSchema,
  VirTextPropsSchema, VirRectPropsSchema, VirEllipsePropsSchema, VirImagePropsSchema,
  VirLayerSchema, VirBeatSchema, VirCameraSchema, VirSceneSchema,
  VirTransitionSchema, VirAudioClipSchema, VirAssetRefSchema, VirGraphsSchema, VirMetaSchema,
} from "./schema";
export type { VirParseIssue } from "./schema";
export { buildSemanticIndex, SemanticError } from "./semantic";
export type { SemanticIndex, SceneInfo } from "./semantic";
