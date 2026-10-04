// defineVideo / VideoBuilder / SceneBuilder 实现：内部积累 VideoProgram AST，builder 内即时校验并抛 DslError
import { EASING_NAMES, isEasingName } from "@videoos/core";
import { DslError } from "./errors";
import { isVideoEffect, VIDEO_EFFECTS } from "./effects";
import {
  ALIGNS, assertColor, assertEnum, assertFiniteNumber, assertIdentifierName,
  assertNonNegativeNumber, assertPosition, assertPositiveNumber, CAMERA_TYPES, TRANSITION_TYPES,
} from "./validate";
import type {
  AnimInput, AudioOptions, BeatOptions, CameraType, CommonLayerOptions, EllipseOptions,
  ImageOptions, RawAnimation, RawScene, RawTransform, RectOptions,
  SceneBuilder, SceneOptions, TextOptions, TransitionOptions, TransitionType,
  VideoBuilder, VideoDefinition, VideoMetaInput, VideoProgram,
} from "./types";

const DEFAULT_META = { width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 } as const;

/** 动画输入 → RawAnimation（填充默认值：duration 0.5 / delay 0 / easing easeOutCubic） */
function normalizeAnimation(input: AnimInput, type: "enter" | "exit", ctx: string): RawAnimation {
  if (input === null || typeof input !== "object") {
    throw new DslError("DSL_INVALID_ANIMATION", `${ctx}: ${type} animation must be an object`);
  }
  if (!isVideoEffect(input.effect)) {
    throw new DslError("DSL_UNKNOWN_EFFECT", `${ctx}: unknown animation effect "${input.effect}" (available: ${VIDEO_EFFECTS.join(", ")})`);
  }
  const duration = input.duration ?? 0.5;
  assertPositiveNumber(duration, `${ctx}: animation duration`, "DSL_INVALID_ANIMATION");
  const delay = input.delay ?? 0;
  assertNonNegativeNumber(delay, `${ctx}: animation delay`, "DSL_INVALID_ANIMATION");
  const easingName = input.easing ?? "easeOutCubic";
  if (!isEasingName(easingName)) {
    throw new DslError("DSL_UNKNOWN_EASING", `${ctx}: unknown easing "${easingName}" (available: ${EASING_NAMES.join(", ")})`);
  }
  let params: Record<string, number> | undefined;
  if (input.params !== undefined) {
    if (input.params === null || typeof input.params !== "object") {
      throw new DslError("DSL_INVALID_ANIMATION", `${ctx}: animation params must be an object of numbers`);
    }
    for (const [k, v] of Object.entries(input.params)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new DslError("DSL_INVALID_ANIMATION", `${ctx}: animation param "${k}" must be a finite number, got ${String(v)}`);
      }
    }
    params = { ...input.params };
  }
  return { type, effect: input.effect, duration, delay, easing: easingName, ...(params !== undefined ? { params } : {}) };
}

function buildAnimations(enter: AnimInput | undefined, exit: AnimInput | undefined, ctx: string): RawAnimation[] {
  const animations: RawAnimation[] = [];
  if (enter !== undefined) animations.push(normalizeAnimation(enter, "enter", ctx));
  if (exit !== undefined) animations.push(normalizeAnimation(exit, "exit", ctx));
  return animations;
}

interface CommonResolved { in: number; out: number; transform: RawTransform; animations: RawAnimation[] }

/** 通用图层选项解析（at/in/out/opacity/scale/rotation/enter/exit），out 默认场景时长 */
function resolveCommon(scene: RawScene, opts: CommonLayerOptions, ctx: string): CommonResolved {
  const at = opts.at ?? { x: "50%", y: "50%" };
  assertPosition(at, ctx);
  const inTime = opts.in ?? 0;
  assertNonNegativeNumber(inTime, `${ctx}: "in"`, "DSL_INVALID_TIME");
  if (inTime >= scene.duration) {
    throw new DslError("DSL_INVALID_TIME", `${ctx}: "in" (${inTime}) must be < scene duration (${scene.duration})`);
  }
  const outTime = opts.out ?? scene.duration;
  assertFiniteNumber(outTime, `${ctx}: "out"`, "DSL_INVALID_TIME");
  if (outTime <= inTime) {
    throw new DslError("DSL_INVALID_TIME", `${ctx}: "out" (${outTime}) must be > "in" (${inTime})`);
  }
  if (outTime > scene.duration) {
    throw new DslError("DSL_INVALID_TIME", `${ctx}: "out" (${outTime}) must not exceed scene duration (${scene.duration})`);
  }
  const opacity = opts.opacity ?? 1;
  assertFiniteNumber(opacity, `${ctx}: opacity`, "DSL_INVALID_TRANSFORM");
  if (opacity < 0 || opacity > 1) {
    throw new DslError("DSL_INVALID_TRANSFORM", `${ctx}: opacity must be within [0,1], got ${opacity}`);
  }
  const scale = opts.scale ?? 1;
  assertPositiveNumber(scale, `${ctx}: scale`, "DSL_INVALID_TRANSFORM");
  const rotation = opts.rotation ?? 0;
  assertFiniteNumber(rotation, `${ctx}: rotation`, "DSL_INVALID_TRANSFORM");
  const transform: RawTransform = {
    anchor: { x: 0.5, y: 0.5 },  // v1 固定居中锚点
    position: { x: at.x, y: at.y },
    scale: { x: scale, y: scale },
    rotation,
    opacity,
  };
  return { in: inTime, out: outTime, transform, animations: buildAnimations(opts.enter, opts.exit, ctx) };
}

class SceneBuilderImpl implements SceneBuilder {
  private readonly layerNames = new Set<string>();
  private readonly beatNames = new Set<string>();
  private cameraSet = false;

  constructor(private readonly scene: RawScene) {}

  private claimLayerName(name: string, ctx: string): void {
    if (this.layerNames.has(name)) {
      throw new DslError("DSL_DUPLICATE_LAYER", `${ctx}: duplicate layer name "${name}" in scene "${this.scene.name}"`);
    }
    this.layerNames.add(name);
  }

  private layerId(name: string): string {
    return `layer_${this.scene.name}_${name}`;
  }

  text(name: string, content: string, opts: TextOptions = {}): void {
    const ctx = `text layer "${name}" in scene "${this.scene.name}"`;
    assertIdentifierName(name, "layer", ctx);
    this.claimLayerName(name, ctx);
    if (typeof content !== "string") {
      throw new DslError("DSL_INVALID_TEXT", `${ctx}: content must be a string, got ${typeof content}`);
    }
    const common = resolveCommon(this.scene, opts, ctx);
    const size = opts.size ?? 64;
    assertPositiveNumber(size, `${ctx}: size`, "DSL_INVALID_TEXT");
    const font = opts.font ?? "sans-serif";
    if (typeof font !== "string" || font.length === 0) {
      throw new DslError("DSL_INVALID_TEXT", `${ctx}: font must be a non-empty string`);
    }
    const weight = opts.weight ?? 400;
    assertPositiveNumber(weight, `${ctx}: weight`, "DSL_INVALID_TEXT");
    const color = assertColor(opts.color ?? "#ffffff", `${ctx}: color`);
    const align = opts.align ?? "center";
    assertEnum(align, ALIGNS, "text align", "DSL_INVALID_TEXT");
    const letterSpacing = opts.letterSpacing ?? 0;
    assertFiniteNumber(letterSpacing, `${ctx}: letterSpacing`, "DSL_INVALID_TEXT");
    const lineHeight = opts.lineHeight ?? 1.2;
    assertPositiveNumber(lineHeight, `${ctx}: lineHeight`, "DSL_INVALID_TEXT");
    let maxWidth: number | undefined;
    if (opts.maxWidth !== undefined) {
      assertPositiveNumber(maxWidth = opts.maxWidth, `${ctx}: maxWidth`, "DSL_INVALID_TEXT");
    }
    this.scene.layers.push({
      id: this.layerId(name), name, type: "text",
      in: common.in, out: common.out, transform: common.transform, animations: common.animations,
      text: { content, font, size, weight, color, align, letterSpacing, lineHeight, ...(maxWidth !== undefined ? { maxWidth } : {}) },
    });
  }

  rect(name: string, opts: RectOptions): void {
    const ctx = `rect layer "${name}" in scene "${this.scene.name}"`;
    assertIdentifierName(name, "layer", ctx);
    this.claimLayerName(name, ctx);
    if (opts === null || typeof opts !== "object") {
      throw new DslError("DSL_INVALID_RECT", `${ctx}: options object required`);
    }
    const common = resolveCommon(this.scene, opts, ctx);
    assertPositiveNumber(opts.width, `${ctx}: width`, "DSL_INVALID_RECT");
    assertPositiveNumber(opts.height, `${ctx}: height`, "DSL_INVALID_RECT");
    const fill = assertColor(opts.fill, `${ctx}: fill`);
    let radius: number | undefined;
    if (opts.radius !== undefined) {
      assertNonNegativeNumber(radius = opts.radius, `${ctx}: radius`, "DSL_INVALID_RECT");
    }
    let blur: number | undefined;
    if (opts.blur !== undefined) {
      assertNonNegativeNumber(blur = opts.blur, `${ctx}: blur`, "DSL_INVALID_RECT");
    }
    this.scene.layers.push({
      id: this.layerId(name), name, type: "rect",
      in: common.in, out: common.out, transform: common.transform, animations: common.animations,
      rect: { width: opts.width, height: opts.height, fill, ...(radius !== undefined ? { radius } : {}), ...(blur !== undefined ? { blur } : {}) },
    });
  }

  ellipse(name: string, opts: EllipseOptions): void {
    const ctx = `ellipse layer "${name}" in scene "${this.scene.name}"`;
    assertIdentifierName(name, "layer", ctx);
    this.claimLayerName(name, ctx);
    if (opts === null || typeof opts !== "object") {
      throw new DslError("DSL_INVALID_ELLIPSE", `${ctx}: options object required`);
    }
    const common = resolveCommon(this.scene, opts, ctx);
    assertPositiveNumber(opts.width, `${ctx}: width`, "DSL_INVALID_ELLIPSE");
    assertPositiveNumber(opts.height, `${ctx}: height`, "DSL_INVALID_ELLIPSE");
    const fill = assertColor(opts.fill, `${ctx}: fill`);
    let blur: number | undefined;
    if (opts.blur !== undefined) {
      assertNonNegativeNumber(blur = opts.blur, `${ctx}: blur`, "DSL_INVALID_ELLIPSE");
    }
    this.scene.layers.push({
      id: this.layerId(name), name, type: "ellipse",
      in: common.in, out: common.out, transform: common.transform, animations: common.animations,
      ellipse: { width: opts.width, height: opts.height, fill, ...(blur !== undefined ? { blur } : {}) },
    });
  }

  image(name: string, src: string, opts: ImageOptions = {}): void {
    const ctx = `image layer "${name}" in scene "${this.scene.name}"`;
    assertIdentifierName(name, "layer", ctx);
    this.claimLayerName(name, ctx);
    if (typeof src !== "string" || src.length === 0) {
      throw new DslError("DSL_INVALID_IMAGE", `${ctx}: src must be a non-empty string`);
    }
    const common = resolveCommon(this.scene, opts, ctx);
    let width: number | undefined;
    if (opts.width !== undefined) {
      assertPositiveNumber(width = opts.width, `${ctx}: width`, "DSL_INVALID_IMAGE");
    }
    let height: number | undefined;
    if (opts.height !== undefined) {
      assertPositiveNumber(height = opts.height, `${ctx}: height`, "DSL_INVALID_IMAGE");
    }
    let radius: number | undefined;
    if (opts.radius !== undefined) {
      assertNonNegativeNumber(radius = opts.radius, `${ctx}: radius`, "DSL_INVALID_IMAGE");
    }
    let blur: number | undefined;
    if (opts.blur !== undefined) {
      assertNonNegativeNumber(blur = opts.blur, `${ctx}: blur`, "DSL_INVALID_IMAGE");
    }
    this.scene.layers.push({
      id: this.layerId(name), name, type: "image", src,
      in: common.in, out: common.out, transform: common.transform, animations: common.animations,
      image: {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(radius !== undefined ? { radius } : {}),
        ...(blur !== undefined ? { blur } : {}),
      },
    });
  }

  camera(type: CameraType, params: Record<string, number> = {}): void {
    const ctx = `camera in scene "${this.scene.name}"`;
    assertEnum(type, CAMERA_TYPES, "camera type", "DSL_UNKNOWN_CAMERA");
    if (params === null || typeof params !== "object") {
      throw new DslError("DSL_INVALID_CAMERA", `${ctx}: params must be an object of numbers`);
    }
    for (const [k, v] of Object.entries(params)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new DslError("DSL_INVALID_CAMERA", `${ctx}: param "${k}" must be a finite number, got ${String(v)}`);
      }
    }
    if (this.cameraSet) {
      throw new DslError("DSL_DUPLICATE_CAMERA", `${ctx}: camera already set for this scene`);
    }
    this.cameraSet = true;
    this.scene.camera = { type, params: { ...params } };
  }

  beat(name: string, opts: BeatOptions): void {
    const ctx = `beat "${name}" in scene "${this.scene.name}"`;
    assertIdentifierName(name, "beat", ctx);
    if (this.beatNames.has(name)) {
      throw new DslError("DSL_DUPLICATE_BEAT", `${ctx}: duplicate beat name`);
    }
    if (opts === null || typeof opts !== "object") {
      throw new DslError("DSL_INVALID_BEAT", `${ctx}: options object with "at" required`);
    }
    assertNonNegativeNumber(opts.at, `${ctx}: at`, "DSL_INVALID_BEAT");
    if (opts.at > this.scene.duration) {
      throw new DslError("DSL_INVALID_BEAT", `${ctx}: at (${opts.at}) must not exceed scene duration (${this.scene.duration})`);
    }
    let description: string | undefined;
    if (opts.description !== undefined) {
      if (typeof opts.description !== "string") throw new DslError("DSL_INVALID_BEAT", `${ctx}: description must be a string`);
      description = opts.description;
    }
    this.beatNames.add(name);
    this.scene.beats.push({ id: `beat_${this.scene.name}_${name}`, name, at: opts.at, ...(description !== undefined ? { description } : {}) });
  }
}

class VideoBuilderImpl implements VideoBuilder {
  private readonly sceneNames = new Set<string>();
  private readonly audioNames = new Set<string>();
  private readonly transitionPairs = new Set<string>();

  constructor(private readonly program: VideoProgram) {}

  scene(name: string, opts: SceneOptions, build: (s: SceneBuilder) => void): void {
    assertIdentifierName(name, "scene");
    if (this.sceneNames.has(name)) {
      throw new DslError("DSL_DUPLICATE_SCENE", `Duplicate scene name "${name}"`);
    }
    if (opts === null || typeof opts !== "object") {
      throw new DslError("DSL_INVALID_SCENE", `Scene "${name}": options object with "duration" required`);
    }
    if (typeof opts.duration !== "number" || !Number.isFinite(opts.duration) || opts.duration <= 0) {
      throw new DslError("DSL_INVALID_DURATION", `Scene "${name}": duration must be a positive number, got ${String(opts.duration)}`);
    }
    let background: string | undefined;
    if (opts.background !== undefined) {
      background = assertColor(opts.background, `Scene "${name}": background`);
    }
    const scene: RawScene = {
      id: `scene_${name}`, name, duration: opts.duration,
      layers: [], beats: [],
      ...(background !== undefined ? { background } : {}),
    };
    this.sceneNames.add(name);
    this.program.scenes.push(scene);
    if (typeof build !== "function") {
      throw new DslError("DSL_INVALID_SCENE", `Scene "${name}": build callback must be a function`);
    }
    build(new SceneBuilderImpl(scene));
  }

  transition(type: TransitionType, opts: TransitionOptions): void {
    assertEnum(type, TRANSITION_TYPES, "transition type", "DSL_UNKNOWN_TRANSITION");
    if (opts === null || typeof opts !== "object" || !Array.isArray(opts.between) || opts.between.length !== 2
      || !opts.between.every((n) => typeof n === "string" && n.length > 0)) {
      throw new DslError("DSL_INVALID_TRANSITION", "transition requires between: [sceneA, sceneB]");
    }
    const duration = opts.duration ?? 0.5;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      throw new DslError("DSL_INVALID_TRANSITION", `Transition duration must be > 0, got ${String(opts.duration)}`);
    }
    const key = `${opts.between[0]}>>${opts.between[1]}`;
    if (this.transitionPairs.has(key)) {
      throw new DslError("DSL_DUPLICATE_TRANSITION", `Duplicate transition between "${opts.between[0]}" and "${opts.between[1]}"`);
    }
    this.transitionPairs.add(key);
    this.program.transitions.push({ type, duration, between: [opts.between[0], opts.between[1]] });
  }

  audio(name: string, src: string, opts: AudioOptions = {}): void {
    assertIdentifierName(name, "audio");
    if (this.audioNames.has(name)) {
      throw new DslError("DSL_DUPLICATE_AUDIO", `Duplicate audio name "${name}"`);
    }
    if (typeof src !== "string" || src.length === 0) {
      throw new DslError("DSL_INVALID_AUDIO", `Audio "${name}": src must be a non-empty string`);
    }
    const start = opts.start ?? 0;
    assertNonNegativeNumber(start, `Audio "${name}": start`, "DSL_INVALID_AUDIO");
    const volume = opts.volume ?? 1;
    assertFiniteNumber(volume, `Audio "${name}": volume`, "DSL_INVALID_AUDIO");
    if (volume < 0 || volume > 1) {
      throw new DslError("DSL_INVALID_AUDIO", `Audio "${name}": volume must be within [0,1], got ${volume}`);
    }
    let fadeIn: number | undefined;
    if (opts.fadeIn !== undefined) {
      assertNonNegativeNumber(fadeIn = opts.fadeIn, `Audio "${name}": fadeIn`, "DSL_INVALID_AUDIO");
    }
    let fadeOut: number | undefined;
    if (opts.fadeOut !== undefined) {
      assertNonNegativeNumber(fadeOut = opts.fadeOut, `Audio "${name}": fadeOut`, "DSL_INVALID_AUDIO");
    }
    let loop: boolean | undefined;
    if (opts.loop !== undefined) {
      if (typeof opts.loop !== "boolean") throw new DslError("DSL_INVALID_AUDIO", `Audio "${name}": loop must be boolean`);
      loop = opts.loop;
    }
    this.audioNames.add(name);
    this.program.audio.push({
      id: `audio_${name}`, name, src, start, volume,
      ...(fadeIn !== undefined ? { fadeIn } : {}),
      ...(fadeOut !== undefined ? { fadeOut } : {}),
      ...(loop !== undefined ? { loop } : {}),
    });
  }

  /** builder 结束后的整体校验（引用/相邻性/时长约束） */
  finish(): void {
    const scenes = this.program.scenes;
    if (scenes.length === 0) {
      throw new DslError("DSL_EMPTY_VIDEO", "Video must contain at least one scene");
    }
    for (const tr of this.program.transitions) {
      const [a, b] = tr.between;
      const ia = scenes.findIndex((s) => s.name === a);
      const ib = scenes.findIndex((s) => s.name === b);
      if (ia < 0 || ib < 0) {
        throw new DslError("DSL_UNKNOWN_SCENE", `Transition references unknown scene: ${ia < 0 ? `"${a}"` : `"${b}"`}`);
      }
      if (ib !== ia + 1) {
        throw new DslError("DSL_NON_ADJACENT_TRANSITION", `Transition between "${a}" and "${b}" must reference consecutive scenes`);
      }
      const minDuration = Math.min(scenes[ia]!.duration, scenes[ib]!.duration);
      if (tr.duration >= minDuration) {
        throw new DslError("DSL_INVALID_TRANSITION", `Transition duration (${tr.duration}) must be shorter than both scenes (min ${minDuration})`);
      }
    }
    // 全局 layer id 唯一性（防 scene/layer 名含下划线导致 id 拼接歧义）
    const layerIds = new Set<string>();
    for (const scene of scenes) {
      for (const layer of scene.layers) {
        if (layerIds.has(layer.id)) {
          throw new DslError("DSL_DUPLICATE_ID", `Duplicate layer id "${layer.id}" (scene/layer name combination collides)`);
        }
        layerIds.add(layer.id);
      }
    }
  }
}

/** DSL 入口：声明式构建视频定义（VideoDefinition），全部默认值在此填充 */
export function defineVideo(meta: VideoMetaInput, builder: (v: VideoBuilder) => void): VideoDefinition {
  if (meta === null || typeof meta !== "object") {
    throw new DslError("DSL_INVALID_META", "meta must be an object");
  }
  if (typeof meta.title !== "string" || meta.title.length === 0) {
    throw new DslError("DSL_INVALID_META", "meta.title must be a non-empty string");
  }
  const width = meta.width ?? DEFAULT_META.width;
  if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) {
    throw new DslError("DSL_INVALID_META", `meta.width must be a positive integer, got ${String(meta.width)}`);
  }
  const height = meta.height ?? DEFAULT_META.height;
  if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
    throw new DslError("DSL_INVALID_META", `meta.height must be a positive integer, got ${String(meta.height)}`);
  }
  const fps = meta.fps ?? DEFAULT_META.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    throw new DslError("DSL_INVALID_META", `meta.fps must be a positive number, got ${String(meta.fps)}`);
  }
  const background = assertColor(meta.background ?? DEFAULT_META.background, "meta.background");
  const seed = meta.seed ?? DEFAULT_META.seed;
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new DslError("DSL_INVALID_META", `meta.seed must be a finite number, got ${String(meta.seed)}`);
  }
  if (typeof builder !== "function") {
    throw new DslError("DSL_INVALID_META", "builder must be a function");
  }
  const program: VideoProgram = {
    meta: { title: meta.title, width, height, fps, background, seed },
    scenes: [], transitions: [], audio: [],
  };
  const impl = new VideoBuilderImpl(program);
  builder(impl);
  impl.finish();
  return { kind: "videoos-definition", version: "1.0", program };
}
