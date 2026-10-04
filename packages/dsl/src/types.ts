// DSL 公共类型：构建器接口、选项类型与内部 VideoProgram AST（Raw* 结构与 VIR 图层同构，start/uses 由编译器派生）
export type Align = "left" | "center" | "right";
export type CameraType = "static" | "push-in" | "pull-out" | "pan";
export type TransitionType = "cut" | "crossfade" | "fade-black";
export type AnimationKind = "enter" | "exit" | "loop";
export type LayerType = "text" | "rect" | "ellipse" | "image" | "group";

export interface PositionInput { x: number | string; y: number | string }

export interface VideoMetaInput {
  title: string;
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
  seed?: number;
}

export interface AnimInput {
  effect: string;
  duration?: number;   // 默认 0.5
  delay?: number;      // 默认 0
  easing?: string;     // 默认 "easeOutCubic"
  params?: Record<string, number>;
}

export interface CommonLayerOptions {
  at?: PositionInput;            // 默认 { x: "50%", y: "50%" }
  in?: number;                   // 默认 0
  out?: number;                  // 默认场景时长
  opacity?: number;              // 默认 1
  scale?: number;                // 默认 1（v1 仅均匀缩放）
  rotation?: number;             // 默认 0（度）
  enter?: AnimInput;
  exit?: AnimInput;
}

export interface TextOptions extends CommonLayerOptions {
  size?: number;                 // 默认 64
  font?: string;                 // 默认 "sans-serif"
  weight?: number;               // 默认 400
  color?: string;                // 默认 "#ffffff"
  align?: Align;                 // 默认 "center"
  letterSpacing?: number;        // 默认 0（px）
  lineHeight?: number;           // 默认 1.2
  maxWidth?: number;             // 溢出诊断用
}

export interface RectOptions extends CommonLayerOptions {
  width: number;
  height: number;
  fill: string;
  radius?: number;
  blur?: number;
}

export interface EllipseOptions extends CommonLayerOptions {
  width: number;
  height: number;
  fill: string;
  blur?: number;
}

export interface ImageOptions extends CommonLayerOptions {
  width?: number;
  height?: number;
  radius?: number;
  blur?: number;
}

export interface BeatOptions { at: number; description?: string }
export interface SceneOptions { duration: number; background?: string }
export interface TransitionOptions { duration?: number; between: [string, string] }
export interface AudioOptions { start?: number; volume?: number; fadeIn?: number; fadeOut?: number; loop?: boolean }

export interface SceneBuilder {
  text(name: string, content: string, opts?: TextOptions): void;
  rect(name: string, opts: RectOptions): void;
  ellipse(name: string, opts: EllipseOptions): void;
  image(name: string, src: string, opts?: ImageOptions): void;
  camera(type: CameraType, params?: Record<string, number>): void;
  beat(name: string, opts: BeatOptions): void;
}

export interface VideoBuilder {
  scene(name: string, opts: SceneOptions, build: (s: SceneBuilder) => void): void;
  transition(type: TransitionType, opts: TransitionOptions): void;
  audio(name: string, src: string, opts?: AudioOptions): void;
}

// ---------- 内部 AST（默认值已填充） ----------

export interface ResolvedMeta { title: string; width: number; height: number; fps: number; background: string; seed: number }

export interface RawTransform {
  anchor: { x: number; y: number };
  position: PositionInput;
  scale: { x: number; y: number };
  rotation: number;
  opacity: number;
}

export interface RawAnimation { type: AnimationKind; effect: string; duration: number; delay: number; easing: string; params?: Record<string, number> }

export interface RawTextProps { content: string; font: string; size: number; weight: number; color: string; align: Align; letterSpacing: number; lineHeight: number; maxWidth?: number }
export interface RawRectProps { width: number; height: number; fill: string; radius?: number; blur?: number }
export interface RawEllipseProps { width: number; height: number; fill: string; blur?: number }
export interface RawImageProps { width?: number; height?: number; radius?: number; blur?: number }

export interface RawLayerBase { id: string; name: string; type: LayerType; in: number; out: number; transform: RawTransform; animations: RawAnimation[]; src?: string }
export type RawLayer = (RawLayerBase & { type: "text"; text: RawTextProps })
  | (RawLayerBase & { type: "rect"; rect: RawRectProps })
  | (RawLayerBase & { type: "ellipse"; ellipse: RawEllipseProps })
  | (RawLayerBase & { type: "image"; image: RawImageProps })
  | (RawLayerBase & { type: "group" });

export interface RawBeat { id: string; name: string; at: number; description?: string }
export interface RawCamera { type: CameraType; params: Record<string, number> }
export interface RawScene { id: string; name: string; duration: number; background?: string; camera?: RawCamera; layers: RawLayer[]; beats: RawBeat[] }
export interface RawTransition { type: TransitionType; duration: number; between: [string, string] }
export interface RawAudio { id: string; name: string; src: string; start: number; volume: number; fadeIn?: number; fadeOut?: number; loop?: boolean }

export interface VideoProgram { meta: ResolvedMeta; scenes: RawScene[]; transitions: RawTransition[]; audio: RawAudio[] }
export interface VideoDefinition { kind: "videoos-definition"; version: "1.0"; program: VideoProgram }
