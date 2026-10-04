// Monaco 编辑器注入用 TS 声明（Studio /api/typings 数据源）。
// 与 packages/dsl、packages/qa 的真实 API 对齐（SPEC §3/§5.1）；仅编辑器智能提示用途。

export interface TypingFile {
  /** monaco addExtraLib 的虚拟路径 */
  path: string;
  content: string;
}

const DSL_DTS = `declare module "@videoos/dsl" {
  export type Align = "left" | "center" | "right";
  export type CameraType = "push-in" | "pull-out" | "pan";
  export type TransitionType = "cut" | "crossfade" | "fade-black";
  export type VideoEffect =
    | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right"
    | "blur-up" | "blur-in" | "scale-pop" | "typewriter" | "wipe";
  export type EasingName =
    | "linear" | "easeInQuad" | "easeOutQuad" | "easeInOutQuad"
    | "easeInCubic" | "easeOutCubic" | "easeInOutCubic"
    | "easeOutExpo" | "easeOutBack" | "spring" | "bounce";

  /** 位置：数字=px；字符串=百分比（如 "50%"） */
  export interface PositionInput { x?: number | string; y?: number | string }

  export interface AnimInput {
    effect: VideoEffect;
    /** 默认 0.5 秒 */
    duration?: number;
    /** 默认 0（相对 in/out 窗口起点） */
    delay?: number;
    /** 默认 "easeOutCubic" */
    easing?: EasingName;
    params?: Record<string, number>;
  }

  export interface CommonLayerOptions {
    /** 默认 { x: "50%", y: "50%" }（场景中心） */
    at?: PositionInput;
    /** 入场时间（秒），默认 0 */
    in?: number;
    /** 出场时间（秒），默认场景时长 */
    out?: number;
    /** 默认 1 */
    opacity?: number;
    /** 默认 1 */
    scale?: number;
    /** 旋转（度），默认 0 */
    rotation?: number;
    enter?: AnimInput;
    exit?: AnimInput;
  }

  export interface TextOptions extends CommonLayerOptions {
    /** 默认 64 */
    size?: number;
    /** 字体族名（项目 assets/fonts 注册族或系统字体），默认 "sans-serif" */
    font?: string;
    /** 默认 400 */
    weight?: number;
    /** 默认 "#ffffff" */
    color?: string;
    /** 默认 "center" */
    align?: Align;
    /** 字距（px），默认 0 */
    letterSpacing?: number;
    /** 默认 1.2 */
    lineHeight?: number;
    /** 最大宽度（px）——超过产生溢出诊断 */
    maxWidth?: number;
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
    /** 缺省=画布尺寸（保纵横比请在 DSL 显式计算） */
    width?: number;
    height?: number;
    radius?: number;
    blur?: number;
  }

  export interface BeatOptions {
    /** 场景内时间（秒） */
    at: number;
    description?: string;
  }

  export interface SceneOptions {
    /** 场景时长（秒），必须 > 0 */
    duration: number;
    background?: string;
  }

  export interface TransitionOptions {
    between: [sceneA: string, sceneB: string];
    /** 默认 0.5 */
    duration?: number;
  }

  export interface AudioOptions {
    /** 全局起始（秒），默认 0 */
    start?: number;
    /** 0-1，默认 1 */
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    loop?: boolean;
  }

  export interface VideoMetaInput {
    title: string;
    width?: number;
    height?: number;
    fps?: number;
    background?: string;
    /** 确定性随机种子 */
    seed?: number;
  }

  export interface SceneBuilder {
    text(name: string, content: string, opts?: TextOptions): void;
    rect(name: string, opts: RectOptions): void;
    ellipse(name: string, opts: EllipseOptions): void;
    /** src = 项目相对路径（如 "assets/images/logo.png"） */
    image(name: string, src: string, opts?: ImageOptions): void;
    camera(type: CameraType, params?: Record<string, number>): void;
    beat(name: string, opts: BeatOptions): void;
  }

  export interface VideoBuilder {
    scene(name: string, opts: SceneOptions, build: (s: SceneBuilder) => void): void;
    transition(type: TransitionType, opts: TransitionOptions): void;
    audio(name: string, src: string, opts?: AudioOptions): void;
  }

  /** defineVideo(meta, v => { ... }) 的返回值（编译器输入，不透明） */
  export interface VideoDefinition { readonly __videoosDefinition: unique symbol }

  export function defineVideo(meta: VideoMetaInput, builder: (v: VideoBuilder) => void): VideoDefinition;
}
`;

const QA_DTS = `declare module "@videoos/qa" {
  export interface QaOptions {
    /** golden 基准目录（相对项目根），默认 "tests/golden" */
    goldenDir?: string;
    /** golden 缺失时写入当前渲染并判 pass */
    updateGolden?: boolean;
  }

  export interface FrameAssertion {
    /** 语义断言（零渲染）：该帧可见文本包含 text（typewriter 裁剪已考虑） */
    toContainText(text: string): void;
    /** 采样步长 16px；暗像素（r,g,b 全 <16）占比 ≥ threshold（默认 0.98） */
    toBeBlack(threshold?: number): void;
    /** 与场景背景每通道 |Δ|<3 占比 ≥ 0.98 */
    toBeBlank(): void;
    /** goldenDir/<name>(.png) 像素对比（容差 |Δ|≤6/通道），相似度 ≥ threshold（默认 0.98） */
    toMatchGolden(name: string, opts?: { threshold?: number }): void;
    toBeSimilarTo(other: FrameAssertion, opts?: { threshold?: number }): void;
    /** Rec.601 luma 全像素均值 ∈ [min, max] */
    toHaveAverageBrightnessBetween(min: number, max: number): void;
    not: {
      toContainText(text: string): void;
      toBeBlack(threshold?: number): void;
      toBeBlank(): void;
    };
  }

  export interface SceneAssertion {
    /** 秒，闭区间 */
    durationBetween(min: number, max: number): void;
    /** measureText 实测文本宽度 vs maxWidth ?? meta.width-32 */
    noTextOverflow(): void;
    toHaveBeat(name: string): void;
    toHaveLayers(...names: string[]): void;
  }

  export function expect(subject: FrameAssertion | SceneAssertion): FrameAssertion | SceneAssertion;
  /** 帧号（clamp 到 [0, totalFrames-1]） */
  export function frame(n: number): FrameAssertion;
  /** 场景名或语义 id */
  export function scene(name: string): SceneAssertion;

  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export const test: typeof it;

  export interface QaContext {
    frame(n: number): FrameAssertion;
    scene(name: string): SceneAssertion;
  }
  export function createQaContext(
    compileResult: unknown,
    renderer: unknown,
    options?: QaOptions,
  ): QaContext;
  /** 执行收集器中的用例并清空（videoos test / VAP test.run 入口） */
  export function runCollected(ctx?: QaContext): Promise<unknown>;
}
`;

const BUN_TEST_DTS = `declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export const test: typeof it;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeCloseTo(n: number, digits?: number): void;
    toContain(s: string): void;
    toThrow(expected?: string | RegExp | Error): void;
    not: { toBe(expected: unknown): void; toEqual(expected: unknown): void; toThrow(expected?: string | RegExp | Error): void };
  };
}
`;

export const STUDIO_TYPINGS: TypingFile[] = [
  { path: "file:///node_modules/@videoos/dsl/index.d.ts", content: DSL_DTS },
  { path: "file:///node_modules/@videoos/qa/index.d.ts", content: QA_DTS },
  { path: "file:///node_modules/@types/bun/test.d.ts", content: BUN_TEST_DTS },
];
