// @videoos/qa 公共类型契约：测试收集/报告结构、断言接口、QaContext 依赖注入（SPEC §5）
// 消费方：VAP test.run / CLI videoos test / Studio 测试面板（均通过 QaContext 注入编译与渲染）
import type { ImageData } from "@napi-rs/canvas";
import type { CompileResult } from "@videoos/compiler";
import type { RenderedFrame, Renderer } from "@videoos/render-canvas";
import type { VirScene } from "@videoos/vir";

export type TestStatus = "pass" | "fail" | "skip";

export interface TestResult {
  name: string;
  suite: string;
  status: TestStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  durationMs: number;
}

export interface QaReport {
  suites: SuiteResult[];
  totalPassed: number;
  totalFailed: number;
  durationMs: number;
  /** SHA-256(canonicalJson(vir))（SPEC 附录 B 算法），标识被测视频版本 */
  virHash: string;
}

export interface QaOptions {
  /** 为 true 时缺失/失配的 golden 直接以当前渲染覆盖写入并判 pass（--update-golden） */
  updateGolden?: boolean;
  /** golden 基准目录，默认 "tests/golden"（相对项目根；createQaContext 时按 process.cwd() 解析为绝对路径） */
  goldenDir?: string;
}

/** 断言失败错误：断言方法抛出，runner 捕获后转为 TestResult（message/details 透传给 Agent） */
export class QaAssertionError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "QaAssertionError";
    this.details = details;
  }
}

/** @internal 断言实现与 runner 之间的内部句柄（symbol 键避免污染公共 API 形状） */
export const QA_INTERNAL: unique symbol = Symbol("videoos.qa.internal");

/** @internal QaContext 的运行时内部能力（LRU 帧缓存、notes、场景查找） */
export interface QaInternals {
  readonly compile: CompileResult;
  readonly renderer: Renderer;
  /** 已解析选项（goldenDir 为绝对路径、updateGolden 为布尔） */
  readonly options: Required<QaOptions>;
  readonly totalFrames: number;
  /** 帧号 clamp 到 [0, totalFrames-1]；非有限数抛 QaAssertionError（与 renderer.renderFrame 语义一致） */
  clampFrame(frame: number): number;
  /** LRU 缓存（容量 8）的帧渲染产物（PNG 编码等使用） */
  frameRendered(frame: number): RenderedFrame;
  /** LRU 缓存（容量 8）的帧像素数据（像素断言共用，避免同帧重复渲染/拷贝） */
  frameImageData(frame: number): ImageData;
  /** 帧缓存当前条目数（测试/调试用） */
  readonly frameCacheSize: number;
  /** 按场景名或场景 id 查找；失败抛 QaAssertionError（message 含可用场景列表） */
  findScene(name: string): VirScene;
  /** 记录 pass 用例的附加 details（如 goldenUpdated）；runner 在每个用例结束后 drain */
  recordDetails(details: Record<string, unknown>): void;
  /** 取出并清空累积的 notes */
  drainDetails(): Record<string, unknown>;
}

/** 帧主题：expect(frame(n)) 的断言目标 */
export interface FrameSubject {
  readonly kind: "frame";
  /** 已 clamp 的帧号（[0, totalFrames-1]） */
  readonly frame: number;
  readonly [QA_INTERNAL]: QaInternals;
}

/** 场景主题：expect(scene(name)) 的断言目标 */
export interface SceneSubject {
  readonly kind: "scene";
  /** 场景名（按 VIR scene.name 解析；传入 id 时亦归一为 name） */
  readonly name: string;
  readonly [QA_INTERNAL]: QaInternals;
}

export interface GoldenMatchOptions {
  /** 相似度阈值（默认 0.98）：相似度 ≥ threshold 判 pass */
  threshold?: number;
}

/** not 反转仅支持布尔型断言（toBeBlack / toBeBlank / toContainText） */
export interface FrameNegatedAssertion {
  toContainText(text: string): void;
  toBeBlack(threshold?: number): void;
  toBeBlank(): void;
}

export interface FrameAssertion {
  /** 语义断言（零渲染）：该帧活跃文本图层（typewriter 裁剪后的 content）包含期望子串且 opacity > 0.05 */
  toContainText(text: string): void;
  /** 暗像素（r,g,b 全 < 16）采样占比（步长 16px）≥ threshold（默认 0.98） */
  toBeBlack(threshold?: number): void;
  /** 透明或纯背景：与 plan.background 每通道色差 < 3 的像素占比 ≥ 0.98 */
  toBeBlank(): void;
  /** 与 goldenDir/name.png 像素 diff，相似度 ≥ threshold（默认 0.98）；updateGolden 时写入 golden 并 pass（details.goldenUpdated） */
  toMatchGolden(name: string, opts?: GoldenMatchOptions): void;
  /** 两帧像素相似度（动画平滑性检查），默认阈值 0.98 */
  toBeSimilarTo(otherFrame: number, opts?: { threshold?: number }): void;
  /** 平均亮度（Rec.601 luma，0-255）落在 [min, max]（闭区间） */
  toHaveAverageBrightnessBetween(min: number, max: number): void;
  readonly not: FrameNegatedAssertion;
}

export interface SceneAssertion {
  /** VIR 场景时长（秒）落在 [min, max]（闭区间） */
  durationBetween(min: number, max: number): void;
  /** 场景全部 text 图层实测宽度（renderer.measureText，含 letterSpacing）≤ maxWidth ?? meta.width - 32 */
  noTextOverflow(): void;
  /** VIR beats 含该节拍（按 name） */
  toHaveBeat(name: string): void;
  /** 场景含全部给定图层（按 name） */
  toHaveLayers(...names: string[]): void;
}

export type Assertion = FrameAssertion | SceneAssertion;

/** 一切断言的依赖注入上下文：VAP test.run 与 CLI 都构造它 */
export interface QaContext {
  compile: CompileResult;
  /** @videoos/render-canvas 渲染器（须与 compile 来自同一 CompileResult） */
  renderer: Renderer;
  /** 已解析选项（goldenDir 绝对路径） */
  options: QaOptions;
  frame(n: number): FrameSubject;
  scene(name: string): SceneSubject;
  readonly [QA_INTERNAL]: QaInternals;
}

export type TestFn = () => void | Promise<void>;

/** runSuites 的输入套件结构（由 describe/it 收集器产出，亦可手工构造） */
export interface SuiteTest {
  name: string;
  fn: TestFn;
  /** true 时跳过执行，直接记 skip */
  skip?: boolean;
}

export interface Suite {
  name: string;
  tests: SuiteTest[];
}
