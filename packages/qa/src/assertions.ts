// SPEC §5.1 全部断言实现。断言策略：语义优先（toContainText/duration/beat/layers/overflow 零渲染直读
// FramePlan/VIR/measureText），像素断言（black/blank/golden/similar/brightness）才触发渲染（LRU 缓存共用）。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { normalizeColor } from "@videoos/core";
import type { FrameCommand } from "@videoos/compiler";
import type { ImageData } from "@napi-rs/canvas";
import { compareImages, loadImageDataSync, renderDiff } from "./diff";
import { QA_INTERNAL, QaAssertionError } from "./types";
import type { FrameAssertion, FrameSubject, GoldenMatchOptions, SceneAssertion, SceneSubject } from "./types";

type TextCommand = Extract<FrameCommand, { op: "draw-text" }>;

const DEFAULT_THRESHOLD = 0.98;
const BLANK_THRESHOLD = 0.98;
const DARK_SAMPLE_STEP = 16; // toBeBlack/toBeBlank 采样步长（px）
const DARK_CHANNEL_MAX = 16; // r,g,b 全 < 16 视为暗像素
const BLANK_CHANNEL_TOLERANCE = 3; // 与背景每通道 |Δ| < 3 视为背景色（透明像素 a < 8 亦视为 blank）
const VISIBLE_TEXT_OPACITY = 0.05; // 文本命令 opacity > 0.05 视为可见

const round = (n: number, digits = 4): number => Number(n.toFixed(digits));

function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeColor(hex); // 非法颜色抛 Error（编译期已诊断；此处防御）
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

export function createFrameAssertions(subject: FrameSubject): FrameAssertion {
  const qa = subject[QA_INTERNAL];

  function fail(assertion: string, message: string, details: Record<string, unknown>): never {
    throw new QaAssertionError(message, { assertion, frame: subject.frame, ...details });
  }

  /** 该帧全部可见文本命令（零渲染：FramePlan 的 draw-text，content 已含 typewriter visibleChars 裁剪） */
  function visibleTexts(): TextCommand[] {
    const plan = qa.compile.framePlan(subject.frame);
    return plan.commands.filter((c): c is TextCommand => c.op === "draw-text" && c.opacity > VISIBLE_TEXT_OPACITY);
  }

  function describeTexts(commands: TextCommand[]): { layerId: string; content: string; opacity: number }[] {
    return commands.map((c) => ({ layerId: c.layerId, content: c.content, opacity: round(c.opacity, 3) }));
  }

  // ---- 语义断言 ----

  function toContainText(text: string): void {
    const visible = visibleTexts();
    if (!visible.some((c) => c.content.includes(text))) {
      fail("toContainText", `Frame ${subject.frame} does not contain visible text ${JSON.stringify(text)}`, {
        expected: text,
        visibleTexts: describeTexts(visible),
      });
    }
  }

  function notToContainText(text: string): void {
    const matched = visibleTexts().filter((c) => c.content.includes(text));
    if (matched.length > 0) {
      fail("not.toContainText", `Frame ${subject.frame} contains visible text ${JSON.stringify(text)} but expected it to be absent`, {
        expected: text,
        matchedTexts: describeTexts(matched),
      });
    }
  }

  // ---- 像素断言 ----

  interface SampleStats { ratio: number; matched: number; sampled: number }

  /** 步长 16px 网格采样统计（确定性） */
  function samplePixels(img: ImageData, isMatch: (r: number, g: number, b: number, a: number) => boolean): SampleStats {
    const { data, width, height } = img;
    let sampled = 0;
    let matched = 0;
    for (let y = 0; y < height; y += DARK_SAMPLE_STEP) {
      for (let x = 0; x < width; x += DARK_SAMPLE_STEP) {
        const i = (y * width + x) * 4;
        sampled++;
        if (isMatch(data[i], data[i + 1], data[i + 2], data[i + 3])) matched++;
      }
    }
    return { ratio: sampled === 0 ? 1 : matched / sampled, matched, sampled };
  }

  const isDarkPixel = (r: number, g: number, b: number): boolean =>
    r < DARK_CHANNEL_MAX && g < DARK_CHANNEL_MAX && b < DARK_CHANNEL_MAX;

  function toBeBlack(threshold = DEFAULT_THRESHOLD): void {
    const stats = samplePixels(qa.frameImageData(subject.frame), (r, g, b) => isDarkPixel(r, g, b));
    if (stats.ratio < threshold) {
      fail("toBeBlack", `Frame ${subject.frame} is not black: dark ratio ${round(stats.ratio)} < threshold ${threshold}`, {
        darkRatio: round(stats.ratio), threshold, sampled: stats.sampled, darkPixels: stats.matched,
      });
    }
  }

  function notToBeBlack(threshold = DEFAULT_THRESHOLD): void {
    const stats = samplePixels(qa.frameImageData(subject.frame), (r, g, b) => isDarkPixel(r, g, b));
    if (stats.ratio >= threshold) {
      fail("not.toBeBlack", `Frame ${subject.frame} is black: dark ratio ${round(stats.ratio)} >= threshold ${threshold}`, {
        darkRatio: round(stats.ratio), threshold, sampled: stats.sampled, darkPixels: stats.matched,
      });
    }
  }

  function blankStats(): { stats: SampleStats; background: string } {
    const plan = qa.compile.framePlan(subject.frame);
    const bg = (() => {
      try {
        return hexToRgb(plan.background);
      } catch (err) {
        return fail("toBeBlank", `Frame ${subject.frame} has invalid background color ${JSON.stringify(plan.background)}: ${(err as Error).message}`, {
          background: plan.background,
        });
      }
    })();
    const stats = samplePixels(qa.frameImageData(subject.frame), (r, g, b, a) =>
      a < 8 || (Math.abs(r - bg[0]) < BLANK_CHANNEL_TOLERANCE && Math.abs(g - bg[1]) < BLANK_CHANNEL_TOLERANCE && Math.abs(b - bg[2]) < BLANK_CHANNEL_TOLERANCE));
    return { stats, background: plan.background };
  }

  function toBeBlank(): void {
    const { stats, background } = blankStats();
    if (stats.ratio < BLANK_THRESHOLD) {
      fail("toBeBlank", `Frame ${subject.frame} is not blank: only ${round(stats.ratio * 100, 2)}% pixels match background ${background} (expected >= ${BLANK_THRESHOLD * 100}%)`, {
        blankRatio: round(stats.ratio), background, sampled: stats.sampled, matched: stats.matched,
      });
    }
  }

  function notToBeBlank(): void {
    const { stats, background } = blankStats();
    if (stats.ratio >= BLANK_THRESHOLD) {
      fail("not.toBeBlank", `Frame ${subject.frame} is blank: ${round(stats.ratio * 100, 2)}% pixels match background ${background} (expected < ${BLANK_THRESHOLD * 100}%)`, {
        blankRatio: round(stats.ratio), background, sampled: stats.sampled, matched: stats.matched,
      });
    }
  }

  /** golden 文件路径：绝对路径原样；否则 goldenDir/name(.png) */
  function goldenPath(name: string): string {
    const file = name.endsWith(".png") ? name : `${name}.png`;
    return isAbsolute(file) ? file : join(qa.options.goldenDir, file);
  }

  function toMatchGolden(name: string, opts: GoldenMatchOptions = {}): void {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const goldenFile = goldenPath(name);
    if (!existsSync(goldenFile)) {
      if (!qa.options.updateGolden) {
        fail("toMatchGolden", `Golden image not found: ${goldenFile}`, {
          golden: goldenFile, threshold,
          hint: "re-run with QaOptions.updateGolden = true to (re)generate goldens",
        });
      }
      mkdirSync(dirname(goldenFile), { recursive: true });
      writeFileSync(goldenFile, qa.frameRendered(subject.frame).toPng());
      qa.recordDetails({ goldenUpdated: true, golden: goldenFile });
      return;
    }
    const golden = loadImageDataSync(goldenFile);
    const actual = qa.frameImageData(subject.frame);
    const { similarity, width, height } = compareImages(actual, golden);
    if (similarity < threshold) {
      const diffPng = renderDiff(golden, actual);
      const diffFile = goldenFile.replace(/\.png$/, ".diff.png");
      try {
        mkdirSync(dirname(diffFile), { recursive: true });
        writeFileSync(diffFile, diffPng);
      } catch {
        // diff 落盘失败不影响断言结论（details 中仍带 diffPng Buffer）
      }
      fail("toMatchGolden", `Frame ${subject.frame} does not match golden ${JSON.stringify(name)}: similarity ${round(similarity)} < threshold ${threshold}`, {
        similarity: round(similarity), threshold, golden: goldenFile, width, height,
        diff: diffFile, diffPng,
      });
    }
  }

  function toBeSimilarTo(otherFrame: number, opts: { threshold?: number } = {}): void {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const other = qa.clampFrame(otherFrame);
    const { similarity } = compareImages(qa.frameImageData(subject.frame), qa.frameImageData(other));
    if (similarity < threshold) {
      fail("toBeSimilarTo", `Frame ${subject.frame} and frame ${other} are not similar enough: ${round(similarity)} < threshold ${threshold}`, {
        frames: [subject.frame, other], similarity: round(similarity), threshold,
      });
    }
  }

  function toHaveAverageBrightnessBetween(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      fail("toHaveAverageBrightnessBetween", `Invalid brightness range [${String(min)}, ${String(max)}]: expected finite numbers with min <= max`, { min, max });
    }
    const data = qa.frameImageData(subject.frame).data;
    let total = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const averageBrightness = total / count;
    if (averageBrightness < min || averageBrightness > max) {
      fail("toHaveAverageBrightnessBetween", `Frame ${subject.frame} average brightness ${round(averageBrightness, 2)} is outside [${min}, ${max}]`, {
        averageBrightness: round(averageBrightness, 2), min, max,
      });
    }
  }

  return {
    toContainText, toBeBlack, toBeBlank, toMatchGolden, toBeSimilarTo, toHaveAverageBrightnessBetween,
    not: { toContainText: notToContainText, toBeBlack: notToBeBlack, toBeBlank: notToBeBlank },
  };
}

export function createSceneAssertions(subject: SceneSubject): SceneAssertion {
  const qa = subject[QA_INTERNAL];

  function fail(assertion: string, message: string, details: Record<string, unknown>): never {
    throw new QaAssertionError(message, { assertion, scene: subject.name, ...details });
  }

  function durationBetween(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      fail("durationBetween", `Invalid duration range [${String(min)}, ${String(max)}]: expected finite numbers with min <= max`, { min, max });
    }
    const scene = qa.findScene(subject.name);
    if (scene.duration < min || scene.duration > max) {
      fail("durationBetween", `Scene "${subject.name}" duration ${scene.duration}s is outside [${min}s, ${max}s]`, {
        duration: scene.duration, min, max,
      });
    }
  }

  function noTextOverflow(): void {
    const scene = qa.findScene(subject.name);
    const defaultLimit = qa.compile.vir.meta.width - 32; // 安全边距 32px
    const overflows: { layer: string; content: string; measuredWidth: number; limit: number }[] = [];
    for (const layer of scene.layers) {
      if (layer.type !== "text") continue;
      const limit = layer.text.maxWidth ?? defaultLimit;
      const { width } = qa.renderer.measureText(layer, scene.id);
      if (width > limit) {
        overflows.push({ layer: layer.name, content: layer.text.content, measuredWidth: round(width, 1), limit });
      }
    }
    if (overflows.length > 0) {
      fail("noTextOverflow", `Scene "${subject.name}" has ${overflows.length} overflowing text layer(s): ${overflows.map((o) => o.layer).join(", ")}`, { overflows });
    }
  }

  function toHaveBeat(name: string): void {
    const scene = qa.findScene(subject.name);
    if (!scene.beats.some((b) => b.name === name)) {
      fail("toHaveBeat", `Scene "${subject.name}" has no beat "${name}"`, { beat: name, beats: scene.beats.map((b) => b.name) });
    }
  }

  function toHaveLayers(...names: string[]): void {
    const scene = qa.findScene(subject.name);
    const present = scene.layers.map((l) => l.name);
    const missing = names.filter((n) => !present.includes(n));
    if (missing.length > 0) {
      fail("toHaveLayers", `Scene "${subject.name}" is missing layer(s): ${missing.join(", ")}`, { missing, layers: present });
    }
  }

  return { durationBetween, noTextOverflow, toHaveBeat, toHaveLayers };
}
