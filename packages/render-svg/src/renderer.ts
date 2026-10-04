// SVG 矢量渲染后端：FramePlan → 合法 <svg> 文档字符串（零 npm 依赖，仅 @videoos/* 内部包）
// 原则：编译器烘焙全部系数，渲染器只做命令 → 元素映射（painter's order = 文档序）
// 确定性：纯字符串拼接，无随机、无墙钟；同输入字节级一致
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { secondsToFrames } from "@videoos/core";
import type { CompileResult, FrameCommand, FramePlan } from "@videoos/compiler";
import type { Vir } from "@videoos/vir";
import { RenderError } from "./types";
import type { RenderOptions, SvgFrame, SvgRenderer } from "./types";

/** XML 转义（属性值与文本节点共用；content 含 <&> 时必须） */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 数字格式化：截断浮点噪声到 4 位小数（确定性输出；-0 归一为 0） */
function num(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RenderError("RENDER_NON_FINITE_VALUE", `Cannot serialize non-finite number: ${String(n)}`);
  }
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** id 片段安全化（filter/clipPath id 由 frame + layerId 唯一化） */
function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/** fade-black 过渡：commands 拆为「主场景块 / 后场景块」，黑幕 rect 插在两组 <g> 之间（crossfade 无需拆分） */
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

export function createSvgRenderer(compileResult: CompileResult, options: RenderOptions = {}): SvgRenderer {
  const vir = compileResult.vir;
  const assetRoot = options.assetRoot;
  if (assetRoot !== undefined && (typeof assetRoot !== "string" || assetRoot.length === 0)) {
    throw new RenderError("RENDER_INVALID_ASSET_ROOT", "options.assetRoot must be a non-empty string when provided");
  }

  const totalFrames = Math.max(0, secondsToFrames(vir.meta.duration, vir.meta.fps));
  const framePlan = compileResult.framePlan; // 惰性纯函数（M1 契约）

  function resolveSrc(src: string): string {
    if (/^(https?|data):/i.test(src)) {
      throw new RenderError("RENDER_IMAGE_UNSUPPORTED_SRC", `Image src must be a local file path, got "${src}"`);
    }
    return isAbsolute(src) ? src : resolve(assetRoot ?? process.cwd(), src);
  }

  /** 相机 → 外层 <g transform>；恒等相机返回 null（不包裹） */
  function cameraTransform(plan: FramePlan): string | null {
    const cam = plan.camera;
    if (cam.scale === 1 && cam.rotation === 0 && cam.translateX === 0 && cam.translateY === 0) return null;
    const { width: w, height: h } = plan;
    const parts: string[] = [`translate(${num(w / 2)}, ${num(h / 2)})`];
    if (cam.scale !== 1) parts.push(`scale(${num(cam.scale)})`);
    if (cam.rotation !== 0) parts.push(`rotate(${num(cam.rotation)})`);
    parts.push(`translate(${num(-w / 2 + cam.translateX)}, ${num(-h / 2 + cam.translateY)})`);
    return parts.join(" ");
  }

  interface EmitState {
    frame: number;
    defs: string[];
  }

  function opacityAttr(opacity: number): string {
    return opacity < 1 ? ` opacity="${num(opacity)}"` : "";
  }

  /** blur → <filter><feGaussianBlur stdDeviation="blur/2">（CSS blur 半径 ≈ 2σ，与 canvas 后端一致） */
  function blurAttr(state: EmitState, layerId: string, blur: number): string {
    if (blur <= 0) return "";
    const id = `blur_f${state.frame}_${safeId(layerId)}`;
    state.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feGaussianBlur stdDeviation="${num(blur / 2)}"/></filter>`,
    );
    return ` filter="url(#${id})"`;
  }

  function rotateAttr(rotation: number, cx: number, cy: number): string {
    return rotation !== 0 ? ` transform="rotate(${num(rotation)}, ${num(cx)}, ${num(cy)})"` : "";
  }

  function emitCommand(state: EmitState, cmd: FrameCommand): string {
    switch (cmd.op) {
      case "draw-rect":
        return (
          `<rect x="${num(cmd.x)}" y="${num(cmd.y)}" width="${num(cmd.width)}" height="${num(cmd.height)}"` +
          (cmd.radius > 0 ? ` rx="${num(cmd.radius)}"` : "") +
          ` fill="${esc(cmd.fill)}"` +
          opacityAttr(cmd.opacity) +
          blurAttr(state, cmd.layerId, cmd.blur) +
          rotateAttr(cmd.rotation, cmd.x + cmd.width / 2, cmd.y + cmd.height / 2) +
          "/>"
        );
      case "draw-ellipse":
        return (
          `<ellipse cx="${num(cmd.cx)}" cy="${num(cmd.cy)}" rx="${num(cmd.rx)}" ry="${num(cmd.ry)}"` +
          ` fill="${esc(cmd.fill)}"` +
          opacityAttr(cmd.opacity) +
          blurAttr(state, cmd.layerId, cmd.blur) +
          rotateAttr(cmd.rotation, cmd.cx, cmd.cy) +
          "/>"
        );
      case "draw-image": {
        // file:// URI（先绝对化）；preserveAspectRatio="none" 与 canvas drawImage 拉伸语义一致
        const href = pathToFileURL(resolveSrc(cmd.src)).href;
        let clipAttr = "";
        if (cmd.radius > 0) {
          const id = `clip_f${state.frame}_${safeId(cmd.layerId)}`;
          state.defs.push(
            `<clipPath id="${id}"><rect x="${num(cmd.x)}" y="${num(cmd.y)}" width="${num(cmd.width)}" height="${num(cmd.height)}" rx="${num(cmd.radius)}"/></clipPath>`,
          );
          clipAttr = ` clip-path="url(#${id})"`;
        }
        return (
          `<image href="${esc(href)}" x="${num(cmd.x)}" y="${num(cmd.y)}" width="${num(cmd.width)}" height="${num(cmd.height)}"` +
          ` preserveAspectRatio="none"` +
          opacityAttr(cmd.opacity) +
          blurAttr(state, cmd.layerId, cmd.blur) +
          clipAttr +
          rotateAttr(cmd.rotation, cmd.x + cmd.width / 2, cmd.y + cmd.height / 2) +
          "/>"
        );
      }
      case "draw-text": {
        // 对齐映射：canvas textAlign ↔ SVG text-anchor
        const anchor = cmd.align === "center" ? "middle" : cmd.align === "left" ? "start" : "end";
        let clipAttr = "";
        if (cmd.clip !== undefined) {
          // wipe 裁剪盒（场景坐标）
          const id = `clip_f${state.frame}_${safeId(cmd.layerId)}`;
          state.defs.push(
            `<clipPath id="${id}"><rect x="${num(cmd.clip.x)}" y="${num(cmd.clip.y)}" width="${num(cmd.clip.width)}" height="${num(cmd.clip.height)}"/></clipPath>`,
          );
          clipAttr = ` clip-path="url(#${id})"`;
        }
        return (
          `<text x="${num(cmd.x)}" y="${num(cmd.y)}"` +
          ` font-family="'${esc(cmd.font)}', sans-serif"` +
          ` font-size="${num(cmd.size)}" font-weight="${num(cmd.weight)}"` +
          ` fill="${esc(cmd.color)}"` +
          ` text-anchor="${anchor}" dominant-baseline="middle"` +
          ` letter-spacing="${num(cmd.letterSpacing)}"` +
          opacityAttr(cmd.opacity) +
          blurAttr(state, cmd.layerId, cmd.blur) +
          clipAttr +
          rotateAttr(cmd.rotation, cmd.x, cmd.y) +
          `>${esc(cmd.content)}</text>`
        );
      }
    }
  }

  function clampFrame(frame: number): number {
    if (typeof frame !== "number" || !Number.isFinite(frame)) {
      throw new RenderError("RENDER_INVALID_FRAME", `Frame index must be a finite number, got ${String(frame)}`);
    }
    return Math.floor(Math.max(0, Math.min(frame, totalFrames - 1)));
  }

  function renderFrame(frame: number): SvgFrame {
    const clamped = clampFrame(frame);
    const plan = framePlan(clamped);
    const state: EmitState = { frame: clamped, defs: [] };
    const parts: string[] = [];

    // 背景整幅填充（不参与相机变换）
    parts.push(`<rect x="0" y="0" width="100%" height="100%" fill="${esc(plan.background)}"/>`);

    const cam = cameraTransform(plan);
    const openG = cam !== null ? `<g transform="${cam}">` : "";
    const closeG = cam !== null ? "</g>" : "";
    const split = partitionFadeBlack(vir, plan);
    if (split === null) {
      if (openG !== "") parts.push(openG);
      for (const cmd of plan.commands) parts.push(emitCommand(state, cmd));
      if (closeG !== "") parts.push(closeG);
    } else {
      // fade-black：主场景 g → 黑幕 rect（整幅、不随相机）→ 后场景 g（沿用主相机）
      if (openG !== "") parts.push(openG);
      for (const cmd of split.main) parts.push(emitCommand(state, cmd));
      if (closeG !== "") parts.push(closeG);
      parts.push(
        `<rect x="0" y="0" width="${num(plan.width)}" height="${num(plan.height)}" fill="#000000" opacity="${num(plan.transition!.progress)}"/>`,
      );
      if (openG !== "") parts.push(openG);
      for (const cmd of split.incoming) parts.push(emitCommand(state, cmd));
      if (closeG !== "") parts.push(closeG);
    }

    const defs = state.defs.length > 0 ? `<defs>${state.defs.join("")}</defs>` : "";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(plan.width)}" height="${num(plan.height)}" ` +
      `viewBox="0 0 ${num(plan.width)} ${num(plan.height)}">${defs}${parts.join("")}</svg>`;

    return { frame: clamped, width: plan.width, height: plan.height, svg, toPng: undefined };
  }

  function renderRange(from: number, to: number): SvgFrame[] {
    const a = clampFrame(from);
    const b = clampFrame(to);
    const frames: SvgFrame[] = [];
    for (let f = a; f <= b; f++) frames.push(renderFrame(f));
    return frames;
  }

  return {
    vir,
    totalFrames,
    renderFrame,
    renderRange,
  };
}
