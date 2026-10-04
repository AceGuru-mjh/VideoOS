// 断言全量测试（SPEC §5.1）：语义断言（零渲染）+ 像素断言 + not 反转 + typewriter 边界 + 采样契约
import { beforeAll, expect as bunExpect, test } from "bun:test";
import { buildSampleDefinition, compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import type { VideoDefinition } from "@videoos/dsl";
import {
  QA_INTERNAL, QaAssertionError, createQaContext, expect,
} from "./index";
import type { QaAssertionError as QaAssertionErrorType, QaContext } from "./index";
import {
  basicDefinition, blackDefinition, contentDefinition, overflowDefinition, twoSceneDefinition, typewriterDefinition,
} from "./fixtures";

/** 断言必抛 QaAssertionError 并返回之（否则测试失败） */
function expectFail(fn: () => void): QaAssertionErrorType {
  try {
    fn();
  } catch (err) {
    if (err instanceof QaAssertionError) return err;
    throw new Error(`Expected QaAssertionError but got: ${String(err)}`);
  }
  throw new Error("Expected assertion to fail, but it passed");
}

function makeContext(definition: () => VideoDefinition): QaContext {
  const compiled: CompileResult = compile(definition());
  return createQaContext(compiled, createRenderer(compiled));
}

let basic: QaContext;
let typed: QaContext;
let black: QaContext;
let content: QaContext;
let twoScenes: QaContext;
let overflow: QaContext;
let sample: QaContext;

beforeAll(() => {
  basic = makeContext(basicDefinition);
  typed = makeContext(typewriterDefinition);
  black = makeContext(blackDefinition);
  content = makeContext(contentDefinition);
  twoScenes = makeContext(twoSceneDefinition);
  overflow = makeContext(overflowDefinition);
  sample = makeContext(buildSampleDefinition);
});

test("toContainText：静态文本子串/全文 pass", () => {
  expect(basic.frame(15)).toContainText("Hello");
  expect(basic.frame(15)).toContainText("Hello VideoOS");
  expect(basic.frame(0)).toContainText("Hello VideoOS"); // 无动画 → 第 0 帧即完整可见
});

test("toContainText：失败给出该帧全部可见文本", () => {
  const err = expectFail(() => expect(basic.frame(15)).toContainText("Goodbye"));
  bunExpect(err.message).toContain("Goodbye");
  const visible = err.details.visibleTexts as { layerId: string; content: string; opacity: number }[];
  bunExpect(visible).toHaveLength(1);
  bunExpect(visible[0]!.content).toBe("Hello VideoOS");
  bunExpect(visible[0]!.layerId).toBe("layer_hello_greeting");
  bunExpect(visible[0]!.opacity).toBe(1);
  bunExpect(err.details.assertion).toBe("toContainText");
});

test("toContainText：typewriter 边界 —— visibleChars < 全长时全文应 fail（帧 10 可见 10/13 字符）", () => {
  // 前置事实：easeOutCubic(10/30)=0.7037 → ceil(13×0.7037)=10 字符 "Hello Vide"
  const plan = typed.compile.framePlan(10);
  const textCmd = plan.commands.find((c) => c.op === "draw-text");
  bunExpect(textCmd && (textCmd as { content: string }).content).toBe("Hello Vide");

  const err = expectFail(() => expect(typed.frame(10)).toContainText("Hello VideoOS"));
  bunExpect(err.message).toContain("Hello VideoOS");
  const visible = err.details.visibleTexts as { content: string }[];
  bunExpect(visible[0]!.content).toBe("Hello Vide");

  // 已可见的前缀子串应 pass
  expect(typed.frame(10)).toContainText("Hello");
});

test("toContainText：typewriter 帧 0（0 字符可见）→ 任意文本 fail；帧 29（13/13）→ 全文 pass", () => {
  const err0 = expectFail(() => expect(typed.frame(0)).toContainText("Hello"));
  bunExpect((err0.details.visibleTexts as { content: string }[])[0]!.content).toBe("");
  expect(typed.frame(29)).toContainText("Hello VideoOS");
});

test("not.toContainText：无文本帧 pass / 有文本 fail", () => {
  expect(black.frame(0)).not.toContainText("anything");
  const err = expectFail(() => expect(basic.frame(15)).not.toContainText("Hello"));
  bunExpect(err.details.matchedTexts as unknown[]).toHaveLength(1);
  bunExpect((err.details.matchedTexts as { content: string }[])[0]!.content).toBe("Hello VideoOS");
});

test("toBeBlack：纯黑场景 pass（darkRatio=1）；含内容场景 fail", () => {
  expect(black.frame(15)).toBeBlack();
  const err = expectFail(() => expect(content.frame(0)).toBeBlack());
  bunExpect(err.details.darkRatio as number).toBeLessThan(0.5);
  bunExpect(err.message).toContain("dark ratio");
});

test("toBeBlack：暗像素占比采样值符合预期（内容帧 ≈ 240 样本中 50 暗）", () => {
  const err = expectFail(() => expect(content.frame(0)).toBeBlack()); // 默认阈值 0.98
  bunExpect(err.details.sampled).toBe(240); // 320×180、步长 16 → 20×12 网格
  const ratio = err.details.darkRatio as number;
  bunExpect(ratio).toBeGreaterThan(0.15);
  bunExpect(ratio).toBeLessThan(0.3);
});

test("toBeBlack(threshold)：自定义阈值放宽后可 pass", () => {
  expect(content.frame(0)).toBeBlack(0.1); // darkRatio ≈ 0.208 ≥ 0.1
  expectFail(() => expect(content.frame(0)).toBeBlack(0.5));
});

test("not.toBeBlack：含内容帧 pass / 纯黑帧 fail", () => {
  expect(content.frame(0)).not.toBeBlack();
  const err = expectFail(() => expect(black.frame(15)).not.toBeBlack());
  bunExpect(err.details.darkRatio).toBe(1);
});

test("toBeBlank：纯背景帧 pass（blankRatio=1）/ 内容帧 fail；not 反转对称", () => {
  expect(black.frame(15)).toBeBlank();
  const err = expectFail(() => expect(content.frame(0)).toBeBlank());
  bunExpect(err.details.background).toBe("#000000");
  bunExpect(err.details.blankRatio as number).toBeLessThan(0.5);
  expect(content.frame(0)).not.toBeBlank();
  expectFail(() => expect(black.frame(15)).not.toBeBlank());
});

test("toHaveAverageBrightnessBetween：基础帧均值落在区间 pass、越界 fail", () => {
  expect(basic.frame(15)).toHaveAverageBrightnessBetween(15, 60);
  const err = expectFail(() => expect(basic.frame(15)).toHaveAverageBrightnessBetween(100, 160));
  const avg = err.details.averageBrightness as number;
  bunExpect(avg).toBeGreaterThan(15);
  bunExpect(avg).toBeLessThan(60);
});

test("toHaveAverageBrightnessBetween：纯黑帧均值 = 0（闭区间边界 pass）", () => {
  expect(black.frame(15)).toHaveAverageBrightnessBetween(0, 5);
  const err = expectFail(() => expect(black.frame(15)).toHaveAverageBrightnessBetween(10, 100));
  bunExpect(err.details.averageBrightness).toBe(0);
});

test("toHaveAverageBrightnessBetween：非法区间（min > max）fail", () => {
  expectFail(() => expect(black.frame(0)).toHaveAverageBrightnessBetween(5, 1));
});

test("toBeSimilarTo：静态场景两帧全等 pass；跨场景 fail（details.similarity）", () => {
  expect(basic.frame(5)).toBeSimilarTo(20);
  const err = expectFail(() => expect(twoScenes.frame(5)).toBeSimilarTo(20)); // red vs blue
  const similarity = err.details.similarity as number;
  bunExpect(similarity).toBeGreaterThan(0.1);
  bunExpect(similarity).toBeLessThan(0.3);
  bunExpect(err.details.frames).toEqual([5, 20]);
});

test("toBeSimilarTo(threshold)：放宽阈值后跨场景帧可 pass", () => {
  expect(twoScenes.frame(5)).toBeSimilarTo(20, { threshold: 0.1 });
});

test("frame()：越界 clamp（9999→29、-3→0、2.7→2）；非有限数抛错", () => {
  bunExpect(basic.frame(9999).frame).toBe(29); // 1s@30fps → totalFrames 30
  bunExpect(basic.frame(-3).frame).toBe(0);
  bunExpect(basic.frame(2.7).frame).toBe(2);
  bunExpect(() => basic.frame(Number.NaN)).toThrow(QaAssertionError);
  bunExpect(() => basic.frame(Number.NaN)).toThrow(/Invalid frame index/);
});

test("frame()：LRU 帧缓存 —— 同帧重复像素断言零重复渲染（对象恒等）+ 容量 8 淘汰", () => {
  const internals = basic[QA_INTERNAL];
  for (let f = 0; f <= 9; f++) internals.frameImageData(f); // 触碰 10 帧
  bunExpect(internals.frameCacheSize).toBe(8);
  const first = internals.frameImageData(15);
  const second = internals.frameImageData(15);
  bunExpect(second).toBe(first); // 命中缓存（同一 ImageData 实例）
});

test("scene()：按名/按 id 解析；未知场景抛错并列出可用场景", () => {
  bunExpect(basic.scene("hello").name).toBe("hello");
  bunExpect(basic.scene("scene_hello").name).toBe("hello"); // id 查找
  const err = expectFail(() => basic.scene("nope"));
  bunExpect(err.message).toContain("nope");
  bunExpect(err.details.availableScenes).toEqual(["hello"]);
});

test("durationBetween：pass / fail（details.duration）", () => {
  expect(basic.scene("hello")).durationBetween(0.5, 1.5);
  const err = expectFail(() => expect(basic.scene("hello")).durationBetween(2, 3));
  bunExpect(err.details.duration).toBe(1);
  bunExpect(err.details.min).toBe(2);
  expectFail(() => expect(basic.scene("hello")).durationBetween(3, 1)); // 非法区间
});

test("toHaveBeat：pass / fail（details.beats）", () => {
  expect(basic.scene("hello")).toHaveBeat("show");
  const err = expectFail(() => expect(basic.scene("hello")).toHaveBeat("nope"));
  bunExpect(err.details.beats).toEqual(["show"]);
});

test("toHaveLayers：pass / fail（details.missing）", () => {
  expect(basic.scene("hello")).toHaveLayers("panel", "greeting");
  const err = expectFail(() => expect(basic.scene("hello")).toHaveLayers("panel", "ghost", "phantom"));
  bunExpect(err.details.missing).toEqual(["ghost", "phantom"]);
  bunExpect(err.details.layers).toEqual(["panel", "greeting"]);
});

test("noTextOverflow：正常场景 pass", () => {
  expect(basic.scene("hello")).noTextOverflow();
});

test("noTextOverflow：maxWidth=100 size=80 → fail（layer/内容/实测宽/上限）", () => {
  const err = expectFail(() => expect(overflow.scene("crowded")).noTextOverflow());
  const overflows = err.details.overflows as { layer: string; content: string; measuredWidth: number; limit: number }[];
  bunExpect(overflows).toHaveLength(1);
  bunExpect(overflows[0]!.layer).toBe("big");
  bunExpect(overflows[0]!.content).toBe("Wide Overflow Text");
  bunExpect(overflows[0]!.measuredWidth).toBeGreaterThan(100);
  bunExpect(overflows[0]!.limit).toBe(100);
  bunExpect(err.message).toContain("big");
});

test("noTextOverflow：无 maxWidth 时按 meta.width - 32 上限", () => {
  const err = expectFail(() => expect(overflow.scene("wide-default")).noTextOverflow());
  const overflows = err.details.overflows as { measuredWidth: number; limit: number }[];
  bunExpect(overflows[0]!.limit).toBe(640 - 32);
  bunExpect(overflows[0]!.measuredWidth).toBeGreaterThan(608);
  expect(overflow.scene("spacious")).noTextOverflow();
});

test("集成：buildSampleDefinition 语义断言（零渲染）+ 1080p 亮度像素断言", () => {
  expect(sample.scene("intro")).durationBetween(3, 5);
  expect(sample.scene("intro")).toHaveBeat("title-enter");
  expect(sample.scene("intro")).toHaveLayers("glow", "title", "subtitle");
  expect(sample.frame(30)).toContainText("VideoOS"); // t=1.0s：title 已完全入场
  expect(sample.frame(30)).toContainText("Programmable");
  expect(sample.frame(60)).toHaveAverageBrightnessBetween(10, 80); // 深底 + 白标题
});
