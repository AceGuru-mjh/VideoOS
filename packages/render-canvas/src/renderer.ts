// Canvas 参考渲染后端：FramePlan → Skia 栅格化（@napi-rs/canvas）
// 原则：编译器烘焙全部系数（动画/过渡/相机求值），渲染器只按命令序绘制（painter's order）
// 确定性：无随机、无墙钟；同输入 PNG 字节级一致
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { secondsToFrames } from "@videoos/core";
import type { CompileResult, FrameCommand, FramePlan } from "@videoos/compiler";
import type { Vir, VirLayer } from "@videoos/vir";
import { registerFonts } from "./fonts";
import { fontString, measureTextWidth } from "./text";
import { RenderError } from "./types";
import type { RenderedFrame, RenderOptions, Renderer, TextMetrics } from "./types";

const DEG2RAD = Math.PI / 180;

/**
 * 同步图像解码：@napi-rs/canvas 的 Image 位图解码是异步的（onload 需事件循环；
 * Buffer 赋值 src 只解析尺寸不产出位图，drawImage 输出为空），而 renderFrame 契约为同步。
 * 方案：一次性子进程同步解码（spawnSync）→ stdout 回传原始 RGBA → 主进程 putImageData
 * 到等尺寸 Canvas 缓存，后续帧直接 drawImage 缓存 Canvas。每个图像只解码一次（含跨帧复用）。
 */
const nodeRequire = createRequire(import.meta.url);

/** 解出本机可用的 canvas 入口（子进程 require 用；避免依赖 cwd 的 node_modules） */
function resolveCanvasModulePath(): string {
  try {
    return nodeRequire.resolve("@napi-rs/canvas");
  } catch (err) {
    throw new RenderError("RENDER_IMAGE_DECODE_FAILED", `Cannot resolve @napi-rs/canvas for sync decode: ${(err as Error).message}`);
  }
}

const DECODE_CHILD_SCRIPT = `
const { createCanvas, loadImage } = require(process.env.VIDEOOS_CANVAS_MODULE);
const p = process.env.VIDEOOS_DECODE_PATH;
loadImage(p).then(
  (img) => {
    if (img.width <= 0 || img.height <= 0) throw new Error('empty image');
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const out = Buffer.alloc(8 + d.length);
    out.writeUInt32LE(img.width, 0);
    out.writeUInt32LE(img.height, 4);
    out.set(d, 8);
    process.stdout.write(out);
  },
  (err) => {
    process.stderr.write(String((err && err.message) || err));
    process.exit(1);
  },
);
`;

type RectCommand = Extract<FrameCommand, { op: "draw-rect" }>;
type EllipseCommand = Extract<FrameCommand, { op: "draw-ellipse" }>;
type TextCommand = Extract<FrameCommand, { op: "draw-text" }>;
type ImageCommand = Extract<FrameCommand, { op: "draw-image" }>;
type TextLayer = Extract<VirLayer, { type: "text" }>;

/** fade-black 过渡：commands 拆为「主场景块 / 后场景块」，黑幕叠加在两者之间（crossfade 无需拆分，系数已烘焙） */
function partitionFadeBlack(vir: Vir, plan: FramePlan): { main: FrameCommand[]; incoming: FrameCommand[] } | null {
  if (plan.transition === undefined || plan.transition.type !== "fade-black") return null;
  const time = plan.time;
  const active = vir.scenes.filter((s) => s.start <= time && time < s.start + s.duration);
  if (active.length < 2) return null;
  const incomingScene = active[1]!;
  const incomingIds = new Set<string>(incomingScene.layers.map((l) => l.id));
  incomingIds.add(`${incomingScene.id}:bg`); // 后场景背景 materialize 的整幅 rect（M1 契约）
  const main: FrameCommand[] = [];
  const incoming: FrameCommand[] = [];
  for (const cmd of plan.commands) {
    if (incomingIds.has(cmd.layerId)) incoming.push(cmd);
    else main.push(cmd);
  }
  return { main, incoming };
}

export function createRenderer(compileResult: CompileResult, options: RenderOptions = {}): Renderer {
  const vir = compileResult.vir;

  const deviceScale = options.deviceScale ?? 1;
  if (typeof deviceScale !== "number" || !Number.isFinite(deviceScale) || deviceScale <= 0) {
    throw new RenderError("RENDER_INVALID_DEVICE_SCALE", `deviceScale must be a positive finite number, got ${String(options.deviceScale)}`);
  }
  const assetRoot = options.assetRoot;
  if (assetRoot !== undefined && (typeof assetRoot !== "string" || assetRoot.length === 0)) {
    throw new RenderError("RENDER_INVALID_ASSET_ROOT", "options.assetRoot must be a non-empty string when provided");
  }
  if (options.fonts !== undefined) registerFonts(options.fonts);

  const totalFrames = Math.max(0, secondsToFrames(vir.meta.duration, vir.meta.fps));
  const framePlan = compileResult.framePlan; // 惰性纯函数（M1 契约）

  // ---- 资源 ----
  // 解码后的图像以「自然尺寸 Canvas」缓存（Map，避免重复解码；跨帧/跨 renderRange 复用）
  const imageCache = new Map<string, Canvas>();
  const measureCtx = createCanvas(8, 8).getContext("2d");

  function resolveSrc(src: string): string {
    if (/^(https?|data):/i.test(src)) {
      throw new RenderError("RENDER_IMAGE_UNSUPPORTED_SRC", `Image src must be a local file path, got "${src}"`);
    }
    return isAbsolute(src) ? src : resolve(assetRoot ?? process.cwd(), src);
  }

  /** 子进程同步解码 → 原始 RGBA → 等尺寸 Canvas（一次性成本，随后缓存） */
  function decodeImageSync(abs: string): Canvas {
    const res = spawnSync(process.execPath, ["-e", DECODE_CHILD_SCRIPT], {
      env: {
        ...process.env,
        VIDEOOS_CANVAS_MODULE: resolveCanvasModulePath(),
        VIDEOOS_DECODE_PATH: abs,
      },
      maxBuffer: 256 * 1024 * 1024,
    });
    if (res.error !== undefined) {
      throw new RenderError("RENDER_IMAGE_DECODE_FAILED", `Failed to decode image ${abs}: ${res.error.message}`);
    }
    if (res.status !== 0) {
      throw new RenderError("RENDER_IMAGE_DECODE_FAILED", `Failed to decode image ${abs}: ${res.stderr.toString().trim()}`);
    }
    const out = res.stdout;
    if (out.length < 9) {
      throw new RenderError("RENDER_IMAGE_DECODE_FAILED", `Malformed decode output (too short) for ${abs}`);
    }
    const w = out.readUInt32LE(0);
    const h = out.readUInt32LE(4);
    if (w <= 0 || h <= 0 || out.length < 8 + w * h * 4) {
      throw new RenderError("RENDER_IMAGE_DECODE_FAILED", `Malformed decode output for ${abs} (${w}x${h}, ${out.length} bytes)`);
    }
    const rgba = new Uint8ClampedArray(w * h * 4);
    rgba.set(out.subarray(8, 8 + w * h * 4));
    const decoded = createCanvas(w, h);
    decoded.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    return decoded;
  }

  function getImage(src: string): Canvas {
    const abs = resolveSrc(src);
    const cached = imageCache.get(abs);
    if (cached !== undefined) return cached;
    if (!existsSync(abs)) {
      throw new RenderError("RENDER_IMAGE_MISSING", `Image file not found: ${src} (resolved: ${abs})`);
    }
    const decoded = decodeImageSync(abs);
    imageCache.set(abs, decoded);
    return decoded;
  }

  // 预热：createRenderer 时同步解码 VIR 中全部 image 图层（缺失文件不在此抛错，留给 renderFrame 按需抛）
  for (const scene of vir.scenes) {
    for (const layer of scene.layers) {
      if (layer.type === "image" && layer.src !== undefined) {
        try {
          getImage(layer.src);
        } catch {
          // ASSET_MISSING 已由编译器诊断；渲染期命中时再抛 RenderError
        }
      }
    }
  }

  // ---- 绘制原语 ----

  /** 相机：以画面中心为原点 scale/rotate，再应用平移（M1 契约：重叠段后场景沿用主相机） */
  function applyCamera(ctx: SKRSContext2D, plan: FramePlan): void {
    const cam = plan.camera;
    ctx.translate(plan.width / 2, plan.height / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.rotate(cam.rotation * DEG2RAD);
    ctx.translate(-plan.width / 2 + cam.translateX, -plan.height / 2 + cam.translateY);
  }

  /** 元素旋转：一律绕元素中心（anchor v1 固定 0.5,0.5） */
  function applyRotation(ctx: SKRSContext2D, cx: number, cy: number, rotation: number): void {
    if (rotation === 0) return;
    ctx.translate(cx, cy);
    ctx.rotate(rotation * DEG2RAD);
    ctx.translate(-cx, -cy);
  }

  function drawRect(ctx: SKRSContext2D, cmd: RectCommand): void {
    ctx.save();
    ctx.globalAlpha = cmd.opacity;
    if (cmd.blur > 0) ctx.filter = `blur(${cmd.blur}px)`;
    applyRotation(ctx, cmd.x + cmd.width / 2, cmd.y + cmd.height / 2, cmd.rotation);
    ctx.fillStyle = cmd.fill;
    ctx.beginPath();
    if (cmd.radius > 0) ctx.roundRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.radius);
    else ctx.rect(cmd.x, cmd.y, cmd.width, cmd.height);
    ctx.fill();
    ctx.filter = "none";
    ctx.restore();
  }

  function drawEllipse(ctx: SKRSContext2D, cmd: EllipseCommand): void {
    ctx.save();
    ctx.globalAlpha = cmd.opacity;
    if (cmd.blur > 0) ctx.filter = `blur(${cmd.blur}px)`;
    applyRotation(ctx, cmd.cx, cmd.cy, cmd.rotation);
    ctx.fillStyle = cmd.fill;
    ctx.beginPath();
    ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";
    ctx.restore();
  }

  function drawImage(ctx: SKRSContext2D, cmd: ImageCommand): void {
    const img = getImage(cmd.src); // 解码缓存 Canvas（同步）
    ctx.save();
    ctx.globalAlpha = cmd.opacity;
    if (cmd.blur > 0) ctx.filter = `blur(${cmd.blur}px)`;
    applyRotation(ctx, cmd.x + cmd.width / 2, cmd.y + cmd.height / 2, cmd.rotation);
    if (cmd.radius > 0) {
      ctx.beginPath();
      ctx.roundRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.radius);
      ctx.clip();
    }
    ctx.drawImage(img, cmd.x, cmd.y, cmd.width, cmd.height);
    ctx.filter = "none";
    ctx.restore();
  }

  function drawText(ctx: SKRSContext2D, cmd: TextCommand): void {
    ctx.save();
    ctx.globalAlpha = cmd.opacity;
    if (cmd.blur > 0) ctx.filter = `blur(${cmd.blur}px)`;
    if (cmd.clip !== undefined) {
      // wipe 效果：场景坐标系的裁剪盒（先裁剪、后旋转）
      ctx.beginPath();
      ctx.rect(cmd.clip.x, cmd.clip.y, cmd.clip.width, cmd.clip.height);
      ctx.clip();
    }
    applyRotation(ctx, cmd.x, cmd.y, cmd.rotation); // x,y 为文本块中心（附录 A）
    ctx.font = fontString(cmd.weight, cmd.size, cmd.font);
    ctx.textAlign = cmd.align;
    ctx.textBaseline = "middle";
    ctx.letterSpacing = `${cmd.letterSpacing}px`;
    ctx.fillStyle = cmd.color;
    // v1 content 单行绘制（typewriter 的可见字符已由编译器裁剪）
    ctx.fillText(cmd.content, cmd.x, cmd.y);
    ctx.filter = "none";
    ctx.restore();
  }

  function drawCommand(ctx: SKRSContext2D, cmd: FrameCommand): void {
    switch (cmd.op) {
      case "draw-rect": return drawRect(ctx, cmd);
      case "draw-ellipse": return drawEllipse(ctx, cmd);
      case "draw-image": return drawImage(ctx, cmd);
      case "draw-text": return drawText(ctx, cmd);
    }
  }

  // ---- 帧渲染 ----

  function renderPlan(plan: FramePlan): Canvas {
    const canvas = createCanvas(
      Math.max(1, Math.round(plan.width * deviceScale)),
      Math.max(1, Math.round(plan.height * deviceScale)),
    );
    const ctx = canvas.getContext("2d");
    ctx.scale(deviceScale, deviceScale); // 之后全部按逻辑像素绘制

    // 背景整幅填充（设备空间，不参与相机变换）
    ctx.fillStyle = plan.background;
    ctx.fillRect(0, 0, plan.width, plan.height);

    const split = partitionFadeBlack(vir, plan);
    if (split === null) {
      ctx.save();
      applyCamera(ctx, plan);
      for (const cmd of plan.commands) drawCommand(ctx, cmd);
      ctx.restore();
      return canvas;
    }
    // fade-black：主场景命令 → 黑幕（设备空间整幅，不随相机）→ 后场景命令（沿用主相机）
    ctx.save();
    applyCamera(ctx, plan);
    for (const cmd of split.main) drawCommand(ctx, cmd);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = plan.transition!.progress;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.restore();
    ctx.save();
    applyCamera(ctx, plan);
    for (const cmd of split.incoming) drawCommand(ctx, cmd);
    ctx.restore();
    return canvas;
  }

  function clampFrame(frame: number): number {
    if (typeof frame !== "number" || !Number.isFinite(frame)) {
      throw new RenderError("RENDER_INVALID_FRAME", `Frame index must be a finite number, got ${String(frame)}`);
    }
    return Math.floor(Math.max(0, Math.min(frame, totalFrames - 1)));
  }

  function renderFrame(frame: number): RenderedFrame {
    const clamped = clampFrame(frame);
    const plan = framePlan(clamped);
    const canvas = renderPlan(plan);
    return {
      frame: clamped,
      width: plan.width,
      height: plan.height,
      toPng: () => canvas.toBuffer("image/png"),
      toDataUrl: () => canvas.toDataURL("image/png"),
      canvas,
    };
  }

  function renderRange(from: number, to: number, onFrame?: (f: RenderedFrame, i: number) => void): RenderedFrame[] {
    const a = clampFrame(from);
    const b = clampFrame(to);
    const frames: RenderedFrame[] = [];
    for (let f = a; f <= b; f++) {
      const rendered = renderFrame(f);
      frames.push(rendered);
      onFrame?.(rendered, frames.length - 1);
    }
    return frames;
  }

  // ---- 文本测量（QA 溢出检测） ----

  function resolveTextLayer(layer: VirLayer | string, sceneId?: string): TextLayer {
    if (typeof layer !== "string") {
      if (layer.type !== "text") {
        throw new RenderError("RENDER_LAYER_NOT_TEXT", `Layer "${layer.name}" is of type "${layer.type}", expected a text layer`);
      }
      return layer;
    }
    const scenes = sceneId !== undefined ? vir.scenes.filter((s) => s.id === sceneId || s.name === sceneId) : vir.scenes;
    for (const scene of scenes) {
      const found = scene.layers.find((l) => l.id === layer || l.name === layer);
      if (found === undefined) continue;
      if (found.type !== "text") {
        throw new RenderError("RENDER_LAYER_NOT_TEXT", `Layer "${found.name}" is of type "${found.type}", expected a text layer`);
      }
      return found;
    }
    throw new RenderError(
      "RENDER_TEXT_LAYER_NOT_FOUND",
      `Text layer "${layer}" not found${sceneId !== undefined ? ` in scene "${sceneId}"` : ""}`,
    );
  }

  function measureText(layer: VirLayer | string, sceneId?: string): TextMetrics {
    const text = resolveTextLayer(layer, sceneId);
    const t = text.text;
    const width = measureTextWidth(measureCtx, t.content, fontString(t.weight, t.size, t.font), t.letterSpacing);
    return { width, height: t.size * t.lineHeight };
  }

  return {
    vir,
    totalFrames,
    renderFrame,
    renderRange,
    measureText,
  };
}
