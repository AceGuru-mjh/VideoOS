// VIR（Video Intermediate Representation）核心类型契约——后续所有包依赖此定义，勿随意变更
export type VirLayerType = "text" | "rect" | "ellipse" | "image" | "group";
export type VirAnimationType = "enter" | "exit" | "loop";
export type VirCameraType = "static" | "push-in" | "pull-out" | "pan";
export type VirTransitionType = "cut" | "crossfade" | "fade-black";

export interface VirVec2 { x: number; y: number }
export interface VirTransform {
  anchor: VirVec2;                    // 0-1，相对元素自身尺寸
  position: { x: number | string; y: number | string }; // 支持 "50%"
  scale: VirVec2;
  rotation: number;                   // 度
  opacity: number;                    // 0-1
}
export interface VirAnimation {
  type: VirAnimationType;
  effect: string;                     // fade | slide-up | slide-down | slide-left | slide-right | blur-up | blur-in | scale-pop | typewriter | wipe
  duration: number; delay: number;    // 秒
  easing: string;
  params?: Record<string, number>;    // distance/blur/period 等
}
export interface VirTextProps {
  content: string; font: string; size: number; weight: number;
  color: string; align: "left" | "center" | "right";
  letterSpacing: number; lineHeight: number; maxWidth?: number;
}
export interface VirRectProps { width: number; height: number; fill: string; radius?: number; blur?: number }
export interface VirEllipseProps { width: number; height: number; fill: string; blur?: number }
export interface VirImageProps { width?: number; height?: number; radius?: number; blur?: number } // src 放 layer.src
export interface VirLayerBase {
  id: string; name: string; type: VirLayerType;
  in: number; out: number;            // 秒，场景内相对
  transform: VirTransform;
  animations: VirAnimation[];
  uses: string[];                     // 依赖的 asset id
  src?: string;                       // image 的资源路径
  children?: VirLayer[];              // group 预留
}
export type VirLayer = (VirLayerBase & { type: "text"; text: VirTextProps })
  | (VirLayerBase & { type: "rect"; rect: VirRectProps })
  | (VirLayerBase & { type: "ellipse"; ellipse: VirEllipseProps })
  | (VirLayerBase & { type: "image"; image: VirImageProps })
  | (VirLayerBase & { type: "group" });
export interface VirBeat { id: string; name: string; at: number; description?: string }
export interface VirCamera { type: VirCameraType; params: Record<string, number> }
export interface VirScene {
  id: string; name: string; start: number; duration: number;
  background?: string; camera?: VirCamera; layers: VirLayer[]; beats: VirBeat[];
}
export interface VirTransition { type: VirTransitionType; duration: number; between: [string, string] }
export interface VirAudioClip { id: string; name: string; src: string; start: number; volume: number; fadeIn?: number; fadeOut?: number; loop?: boolean }
export type VirAssetType = "image" | "font" | "audio";
export interface VirAssetRef { id: string; type: VirAssetType; src: string; hash?: string }
export interface VirGraphs {
  temporal: { nodes: { id: string; kind: "scene"; start: number; end: number }[]; edges: { from: string; to: string }[] };
  spatial: { roots: Record<string, string[]> };   // sceneId -> layerIds
  dependency: { nodes: { id: string; kind: "asset" | "layer" | "scene" }[]; edges: { from: string; to: string }[] };
}
export interface VirMeta { title: string; width: number; height: number; fps: number; duration: number; background: string; seed: number }
export interface Vir { virVersion: "1.0"; meta: VirMeta; scenes: VirScene[]; transitions: VirTransition[]; audio: VirAudioClip[]; assets: VirAssetRef[]; graphs: VirGraphs }
