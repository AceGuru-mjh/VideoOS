// FramePlan 求值：把 VIR 按帧解析为绝对像素绘制命令（纯函数、惰性、确定性；几何含义见各字段注释）
import { clamp, easeOutCubic, easing, isEasingName, linear, resolvePosition } from "@videoos/core";
import type { Point } from "@videoos/core";
import type { Vir, VirCamera, VirLayer } from "@videoos/vir";
import { findIncomingTransition } from "./transition";

export interface FramePlanCamera { scale: number; translateX: number; translateY: number; rotation: number }
export interface FramePlanTransition { type: string; progress: number }
export interface TextClip { x: number; y: number; width: number; height: number }

export type FrameCommand =
  | { op: "draw-rect"; layerId: string; x: number; y: number; width: number; height: number; fill: string; opacity: number; radius: number; blur: number; rotation: number }
  | { op: "draw-ellipse"; layerId: string; cx: number; cy: number; rx: number; ry: number; fill: string; opacity: number; blur: number; rotation: number }
  | {
      op: "draw-text"; layerId: string; x: number; y: number; content: string; font: string; size: number; weight: number;
      color: string; align: "left" | "center" | "right"; opacity: number; blur: number; rotation: number;
      letterSpacing: number; lineHeight: number; maxWidth?: number;
      visibleChars?: number; clip?: TextClip;
    }
  | { op: "draw-image"; layerId: string; src: string; x: number; y: number; width: number; height: number; opacity: number; radius: number; blur: number; rotation: number };

export interface FramePlan {
  frame: number;
  time: number;
  /** 主场景（过渡重叠段取先启动/出场场景）id；无活跃场景为 null */
  sceneId: string | null;
  width: number;
  height: number;
  /** 主场景背景（scene.background ?? meta.background）；无场景时为 meta.background */
  background: string;
  /** 主场景相机在当前时刻的求值（push-in/pull-out/pan，easeOutCubic，作用于整帧、以画面中心为原点） */
  camera: FramePlanCamera;
  /** 按图层声明顺序（painter's order：后声明者绘制在上层）；几何均为已解析绝对像素 */
  commands: FrameCommand[];
  /** 过渡重叠段附加信息（fade-black 时后端应以黑场参与合成） */
  transition?: FramePlanTransition;
}

interface PreparedLayer { layer: VirLayer; center: Point | null }
interface PreparedScene {
  id: string; name: string;
  start: number; end: number; duration: number;
  background: string;
  camera?: VirCamera;
  layers: PreparedLayer[];
  incoming?: { type: "crossfade" | "fade-black"; duration: number };
}

function evaluateCamera(scene: PreparedScene, localT: number): FramePlanCamera {
  const identity: FramePlanCamera = { scale: 1, translateX: 0, translateY: 0, rotation: 0 };
  const cam = scene.camera;
  if (cam === undefined || cam.type === "static") return identity;
  const e = easeOutCubic(clamp(localT / scene.duration, 0, 1));
  const p = cam.params;
  switch (cam.type) {
    case "push-in": {
      const from = p.from ?? 1;
      const to = p.to ?? 1.05;
      return { ...identity, scale: from + (to - from) * e };
    }
    case "pull-out": {
      const from = p.from ?? 1.05;
      const to = p.to ?? 1;
      return { ...identity, scale: from + (to - from) * e };
    }
    case "pan": {
      const fromX = p.fromX ?? 0;
      const toX = p.toX ?? 0;
      const fromY = p.fromY ?? 0;
      const toY = p.toY ?? 0;
      return { ...identity, translateX: fromX + (toX - fromX) * e, translateY: fromY + (toY - fromY) * e };
    }
  }
}

/** 场景在时刻 t 的整体不透明度系数（crossfade：主场景恒 1、后场景 × progress；fade-black：前 × 1-progress、后 × progress） */
function sceneCoefficient(
  scene: PreparedScene,
  main: PreparedScene,
  incomingScene: PreparedScene | undefined,
  time: number,
): number {
  if (scene === main) {
    const inc = incomingScene?.incoming;
    if (inc !== undefined && inc.type === "fade-black" && inc.duration > 0) {
      return 1 - clamp((time - incomingScene!.start) / inc.duration, 0, 1);
    }
    return 1;
  }
  const inc = scene.incoming;
  if (inc === undefined || inc.duration <= 0) return 1;
  return clamp((time - scene.start) / inc.duration, 0, 1);
}

/** 求值单个图层 → 命令（窗口外/无法绘制返回 null） */
function buildLayerCommand(
  vir: Vir,
  layer: VirLayer,
  center: Point,
  localT: number,
  sceneCoeff: number,
): FrameCommand | null {
  if (layer.type === "image" && layer.src === undefined) return null; // IMAGE_NO_SRC 已诊断
  if (layer.type === "group") return null; // children 预留

  // wipe 裁剪盒用的自然尺寸（文本无测量，用与溢出诊断一致的启发式：chars × size × 0.62）
  let naturalWidth = 0;
  let naturalHeight = 0;
  if (layer.type === "text") {
    naturalWidth = layer.text.content.length * layer.text.size * 0.62;
    naturalHeight = layer.text.size * layer.text.lineHeight;
  } else if (layer.type === "rect") {
    naturalWidth = layer.rect.width;
    naturalHeight = layer.rect.height;
  } else if (layer.type === "ellipse") {
    naturalWidth = layer.ellipse.width;
    naturalHeight = layer.ellipse.height;
  } else if (layer.type === "image") {
    naturalWidth = layer.image.width ?? vir.meta.width;
    naturalHeight = layer.image.height ?? vir.meta.height;
  }

  let opacity = layer.transform.opacity;
  let offsetX = 0;
  let offsetY = 0;
  let scaleX = layer.transform.scale.x;
  let scaleY = layer.transform.scale.y;
  const rotation = layer.transform.rotation;
  let extraBlur = 0;
  let visibleChars: number | undefined;
  let clip: TextClip | undefined;

  for (const anim of layer.animations) {
    if (anim.type === "loop") {
      // v1：loop 一律按 sin 波动处理 opacity（0.5 + 0.5·sin(2πt/period + phase)）
      const rawPeriod = anim.params?.period;
      const period = rawPeriod !== undefined && rawPeriod > 0 ? rawPeriod : 1;
      const phase = anim.params?.phase ?? 0;
      const t = localT - layer.in - anim.delay;
      opacity *= 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + phase);
      continue;
    }
    const fn = isEasingName(anim.easing) ? easing(anim.easing, anim.params) : linear; // 未知 easing 已诊断，回退 linear
    let e: number;
    if (anim.type === "enter") {
      const p = clamp((localT - (layer.in + anim.delay)) / anim.duration, 0, 1);
      e = fn(p);
    } else {
      // exit：结束于 layer.out，t 从 1 → 0（e=1 完全可见，e=0 完全退场）
      const start = layer.out - anim.delay - anim.duration;
      if (localT <= start) {
        e = 1;
      } else {
        e = fn(1 - clamp((localT - start) / anim.duration, 0, 1));
      }
    }
    const distance = anim.params?.distance ?? 40;
    const blurPx = anim.params?.blur ?? 12;
    switch (anim.effect) {
      case "fade": opacity *= e; break;
      case "slide-up": offsetY += (1 - e) * distance; break;       // 自下方上浮入场
      case "slide-down": offsetY -= (1 - e) * distance; break;
      case "slide-left": offsetX += (1 - e) * distance; break;     // 自右侧左移入场
      case "slide-right": offsetX -= (1 - e) * distance; break;
      case "blur-up":
        offsetY += (1 - e) * distance;
        extraBlur += (1 - e) * blurPx;
        opacity *= e;
        break;
      case "blur-in":
        extraBlur += (1 - e) * blurPx;
        opacity *= e;
        break;
      case "scale-pop": {
        const f = 0.6 + 0.4 * e;
        scaleX *= f;
        scaleY *= f;
        opacity *= Math.min(1, e * 2);
        break;
      }
      case "typewriter":
        if (layer.type === "text") {
          visibleChars = Math.max(0, Math.ceil(layer.text.content.length * e));
        }
        break;
      case "wipe":
        clip = {
          x: center.x - naturalWidth / 2,
          y: center.y - naturalHeight / 2,
          width: naturalWidth * e,
          height: naturalHeight,
        };
        break;
      default:
        break; // 未知效果已诊断（UNKNOWN_EFFECT），此处忽略
    }
  }

  const cx = center.x + offsetX;
  const cy = center.y + offsetY;
  const finalOpacity = clamp(opacity * sceneCoeff, 0, 1);

  if (layer.type === "text") {
    const t = layer.text;
    const size = t.size * scaleX;             // v1：文本仅支持均匀缩放（取 scale.x）
    const letterSpacing = t.letterSpacing * scaleX;
    const content = visibleChars !== undefined ? t.content.slice(0, visibleChars) : t.content;
    return {
      op: "draw-text", layerId: layer.id, x: cx, y: cy, content,
      font: t.font, size, weight: t.weight, color: t.color, align: t.align,
      opacity: finalOpacity, blur: extraBlur, rotation,
      letterSpacing, lineHeight: t.lineHeight,
      ...(t.maxWidth !== undefined ? { maxWidth: t.maxWidth } : {}),
      ...(visibleChars !== undefined ? { visibleChars } : {}),
      ...(clip !== undefined ? { clip } : {}),
    };
  }
  if (layer.type === "rect") {
    const r = layer.rect;
    const w = r.width * scaleX;
    const h = r.height * scaleY;
    return {
      op: "draw-rect", layerId: layer.id,
      x: cx - w / 2, y: cy - h / 2, width: w, height: h,
      fill: r.fill, opacity: finalOpacity,
      radius: (r.radius ?? 0) * (scaleX + scaleY) / 2,
      blur: (r.blur ?? 0) + extraBlur,
      rotation,
    };
  }
  if (layer.type === "ellipse") {
    const el = layer.ellipse;
    return {
      op: "draw-ellipse", layerId: layer.id, cx, cy,
      rx: (el.width / 2) * scaleX, ry: (el.height / 2) * scaleY,
      fill: el.fill, opacity: finalOpacity,
      blur: (el.blur ?? 0) + extraBlur,
      rotation,
    };
  }
  // image（src 已确认存在）
  const im = layer.image;
  const w = (im.width ?? vir.meta.width) * scaleX;   // 未指定尺寸时默认画布大小（v1 约定）
  const h = (im.height ?? vir.meta.height) * scaleY;
  return {
    op: "draw-image", layerId: layer.id, src: layer.src!,
    x: cx - w / 2, y: cy - h / 2, width: w, height: h,
    opacity: finalOpacity,
    radius: (im.radius ?? 0) * (scaleX + scaleY) / 2,
    blur: (im.blur ?? 0) + extraBlur,
    rotation,
  };
}

/** 从 VIR 创建按帧求值器：framePlan(frame) 为纯函数，不预生成、不缓存 */
export function createFramePlan(vir: Vir): (frame: number) => FramePlan {
  const { width, height, fps, background: defaultBackground } = vir.meta;
  const canvas = { width, height };
  const sceneNames = vir.scenes.map((s) => s.name);
  const scenes: PreparedScene[] = vir.scenes.map((scene, i) => {
    const incoming = i > 0
      ? findIncomingTransition(sceneNames[i - 1]!, scene.name, vir.transitions)
      : undefined;
    const layers: PreparedLayer[] = scene.layers.map((layer) => {
      let center: Point | null = null;
      try {
        center = resolvePosition(layer.transform.position, canvas); // 非法位置已诊断，此处降级为跳过
      } catch {
        center = null;
      }
      return { layer, center };
    });
    return {
      id: scene.id, name: scene.name,
      start: scene.start, end: scene.start + scene.duration, duration: scene.duration,
      background: scene.background ?? defaultBackground,
      ...(scene.camera !== undefined ? { camera: scene.camera } : {}),
      layers,
      ...(incoming !== undefined ? { incoming } : {}),
    };
  });

  return (frame: number): FramePlan => {
    const time = frame / fps;
    const active = scenes.filter((s) => s.start <= time && time < s.end);
    const main = active[0];
    const incomingScene = active[1];
    const plan: FramePlan = {
      frame,
      time,
      sceneId: main !== undefined ? main.id : null,
      width,
      height,
      background: main !== undefined ? main.background : defaultBackground,
      camera: main !== undefined ? evaluateCamera(main, time - main.start) : { scale: 1, translateX: 0, translateY: 0, rotation: 0 },
      commands: [],
    };
    if (main === undefined) return plan;
    if (incomingScene !== undefined && incomingScene.incoming !== undefined && incomingScene.incoming.duration > 0) {
      const progress = clamp((time - incomingScene.start) / incomingScene.incoming.duration, 0, 1);
      plan.transition = { type: incomingScene.incoming.type, progress };
    }
    for (const scene of active) {
      const coeff = sceneCoefficient(scene, main, incomingScene, time);
      if (scene !== main) {
        // 后场景背景整幅渐入（crossfade/fade-black 均按 progress）
        plan.commands.push({
          op: "draw-rect", layerId: `${scene.id}:bg`,
          x: 0, y: 0, width, height,
          fill: scene.background, opacity: coeff, radius: 0, blur: 0, rotation: 0,
        });
      }
      const localT = time - scene.start;
      for (const { layer, center } of scene.layers) {
        if (center === null) continue;
        if (!(layer.in <= localT && localT < layer.out)) continue; // 可见窗口 [in, out)
        const command = buildLayerCommand(vir, layer, center, localT, coeff);
        if (command !== null) plan.commands.push(command);
      }
    }
    return plan;
  };
}
