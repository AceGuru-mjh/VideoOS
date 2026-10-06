// Studio 分析/健康 API（可视化套件 Task 2-c）：/api/analytics/* 三个只读聚合端点。
//   GET /api/analytics/project — 上次 compile 产物（state.projectSession.session.lastCompile）的只读分析：
//     绝不触发重编译（无编译产物 → {available: false}）；统计反映「上次编译」而非当前磁盘源码
//     （entry 在编译后被外部修改时，Studio 应先 POST /api/compile 再刷新本端点）。
//   GET /api/analytics/health  — 进程 / 运行时 / WS 连接 / 会话 / MCP / Skills / Provider / 渲染任务快照。
//   GET /api/analytics/usage   — EventHub 环形缓冲（最近 500 条 ServerEvent）的事件统计与中文摘要。
// 设计约定：
//   - 全部 GET 只读、零副作用（不 emit、不写盘、不编译）→ 可被 Studio 轮询；
//   - 数值字段全部非负有限；列表排序确定性（count 降序 + 键升序）→ 前端图表稳定渲染、快照测试可复现；
//   - 只复用 ServerState 已有字段（hub / settings / sessions / render / projectSession），缺字段返回 null 而非伪造。
import { VIDEOOS_VERSION, normalizeColor } from "@videoos/core";
import type { Hono } from "hono";
import type { CompileResult } from "@videoos/compiler";
import type { Vir, VirLayer, VirTransitionType } from "@videoos/vir";
import { skillsSnapshot } from "../chat/skills";
import type { ServerEvent, ServerState } from "../state";

// ---------------------------------------------------------------------------
// 响应契约（apps/studio AnalyticsPanel / HealthPanel 消费；字段名与端点文档冻结）
// ---------------------------------------------------------------------------

/** 无编译产物时的响应（单字段，客户端据此显示「先编译」引导态） */
export interface ProjectAnalyticsUnavailable {
  available: false;
}

/** 项目概览：场景 / 时长 / 图层规模（数值均四舍五入到 2 位小数） */
export interface ProjectAnalyticsSummary {
  sceneCount: number;
  durationSeconds: number;
  layerCount: number;
  avgSceneDuration: number;
  longestScene: { name: string; duration: number };
}

/** 图层类型计数（text/rect/ellipse/image 为 VIR 图层；audio=音频剪辑数、camera=运镜场景数、transition=转场数） */
export type AnalyticsLayerKind =
  | "text"
  | "rect"
  | "ellipse"
  | "image"
  | "audio"
  | "camera"
  | "transition"
  | "group";

export interface LayerTypeCount {
  type: AnalyticsLayerKind;
  count: number;
}

/** 调色板聚合条目（hex 归一为小写 #rrggbb；alpha 通道不参与聚合） */
export interface ColorCount {
  hex: string;
  count: number;
}

/** 字体使用计数（text 图层的 font 字段） */
export interface FontCount {
  font: string;
  count: number;
}

/** 复杂度因子（label 中文；weight 0-1，四位因子各占 25 分） */
export interface ComplexityFactor {
  label: string;
  weight: number;
}

export interface ComplexityInfo {
  /** 0-100 整数启发式分值（四因子均值 × 100） */
  score: number;
  factors: ComplexityFactor[];
}

/** 转场统计（types 按 count 降序 + type 升序） */
export interface TransitionStats {
  count: number;
  types: Array<{ type: VirTransitionType; count: number }>;
}

export interface ProjectAnalyticsAvailable {
  available: true;
  project: { name: string; entry: string };
  summary: ProjectAnalyticsSummary;
  layerTypes: LayerTypeCount[];
  topColors: ColorCount[];
  fontsUsed: FontCount[];
  complexity: ComplexityInfo;
  transitions: TransitionStats;
}

export type ProjectAnalyticsResponse = ProjectAnalyticsUnavailable | ProjectAnalyticsAvailable;

/** 内存占用（MB，1 位小数；来自 process.memoryUsage） */
export interface MemoryUsageMB {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}

/** 运行时版本（version=process.version 的 node 兼容串；bun=Bun 版本或 null） */
export interface RuntimeInfo {
  version: string;
  bun: string | null;
}

export interface HealthAnalyticsResponse {
  status: "ok";
  uptimeSeconds: number;
  memoryMB: MemoryUsageMB;
  runtime: RuntimeInfo;
  /** 当前 WS 广播连接数（EventHub.clients.size） */
  wsConnections: number;
  sessions: { count: number };
  /** settings.mcp.servers 条目统计 */
  mcp: { servers: number; enabled: number };
  /** skills 快照统计（skillsSnapshot 读盘可得；异常时 null 而非伪造） */
  skills: { total: number; enabled: number } | null;
  /** settings.providers.entries 统计（configured = enabled !== false） */
  providers: { count: number; configured: number };
  /** 渲染任务快照（state.render 直读） */
  render: {
    running: boolean;
    startedAt: string | null;
    scene: string | null;
    progress: { phase: string; frame: number; totalFrames: number } | null;
    error: string | null;
  };
  /** @videoos/core 版本（与 GET /api/health 一致） */
  version: string;
}

/** 事件类型计数（vap 事件展开为 `vap:<kind>`，便于按审计动作细分） */
export interface TypeCount {
  type: string;
  count: number;
}

/** 最近事件摘要条目（at：vap 事件携带 ISO 时间戳，server 合成事件无时间戳 → null） */
export interface RecentEventItem {
  type: string;
  at: string | null;
  summary: string;
}

export interface UsageAnalyticsResponse {
  /** 环形缓冲内事件总数 */
  total: number;
  byType: TypeCount[];
  /** 最近 RECENT_EVENTS_LIMIT 条（时间顺序：旧 → 新） */
  recent: RecentEventItem[];
  /** compile 类事件数（server "compile" + vap compile） */
  compileCount: number;
  /** 渲染相关事件数（render-progress / render-done / render-error / vap render） */
  renderEvents: number;
  /** 测试相关事件数（server "test-done" + vap test） */
  testRuns: number;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** topColors 聚合上限（调色板图表只关心主色；超出截断，按 count 降序） */
const TOP_COLORS_LIMIT = 12;
/** recent 摘要条数上限（与 Studio EventsPanel 滚动窗一致量级） */
const RECENT_EVENTS_LIMIT = 20;
/** 复杂度启发式满配阈值（达到即该因子权重 1.0） */
const COMPLEXITY_MAX_SCENES = 20;
const COMPLEXITY_MAX_LAYERS_PER_SCENE = 10;
const COMPLEXITY_MAX_ANIMATIONS_PER_LAYER = 2;
/** 每因子分值占比（四因子 → 各 25 分） */
const COMPLEXITY_FACTOR_SHARE = 25;
const BYTES_PER_MB = 1024 * 1024;
/** layerTypes 固定输出顺序（任务契约的七类；group 仅在 >0 时追加） */
const LAYER_KIND_ORDER: readonly AnalyticsLayerKind[] = [
  "text",
  "rect",
  "ellipse",
  "image",
  "audio",
  "camera",
  "transition",
];
/** usage 分类键集合（vap 事件展开后的 kind 复合键） */
const COMPILE_EVENT_KEYS: ReadonlySet<string> = new Set(["compile", "vap:compile"]);
const RENDER_EVENT_KEYS: ReadonlySet<string> = new Set([
  "render-progress",
  "render-done",
  "render-error",
  "vap:render",
]);
const TEST_EVENT_KEYS: ReadonlySet<string> = new Set(["test-done", "vap:test"]);

// ---------------------------------------------------------------------------
// 数值工具（全部非负有限，防御 NaN/Infinity 进 JSON）
// ---------------------------------------------------------------------------

/** 四舍五入到 2 位小数；非有限值归 0 */
function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** 四舍五入到 1 位小数；非有限值归 0 */
function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

/** 字节数 → MB（1 位小数） */
function bytesToMB(bytes: number): number {
  return round1(bytes / BYTES_PER_MB);
}

/** clamp(0, max) */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 未知值 → Record 类型收窄（不使用 any；供 VapEvent.detail 防御性读取） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** 确定性字符串比较（码点序，不依赖 ICU/locale → 跨环境快照/图表顺序稳定） */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 项目分析（纯函数：输入 CompileResult，输出统计；不触碰 IO）
// ---------------------------------------------------------------------------

/** 场景/时长/图层规模概览 */
function summarizeScenes(compile: CompileResult): ProjectAnalyticsSummary {
  const scenes = compile.vir.scenes;
  const sceneCount = scenes.length;
  const layerCount = scenes.reduce((sum, scene) => sum + scene.layers.length, 0);
  const totalSceneDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  let longest: { name: string; duration: number } = { name: "", duration: 0 };
  for (const scene of scenes) {
    if (scene.duration > longest.duration) longest = { name: scene.name, duration: scene.duration };
  }
  return {
    sceneCount,
    durationSeconds: round2(compile.vir.meta.duration),
    layerCount,
    avgSceneDuration: sceneCount > 0 ? round2(totalSceneDuration / sceneCount) : 0,
    longestScene: { name: longest.name, duration: round2(longest.duration) },
  };
}

/** 图层类型计数：七类固定输出（含 0 计数，图表形状稳定）；group 仅在实际出现时追加 */
function countLayerTypes(compile: CompileResult): LayerTypeCount[] {
  const vir = compile.vir;
  const counts = new Map<AnalyticsLayerKind, number>();
  for (const kind of LAYER_KIND_ORDER) counts.set(kind, 0);
  let groupCount = 0;
  for (const scene of vir.scenes) {
    for (const layer of scene.layers) {
      counts.set(layer.type, (counts.get(layer.type) ?? 0) + 1);
      if (layer.type === "group") groupCount += 1;
    }
  }
  counts.set("audio", vir.audio.length);
  counts.set("camera", vir.scenes.filter((scene) => scene.camera !== undefined).length);
  counts.set("transition", vir.transitions.length);
  const out: LayerTypeCount[] = LAYER_KIND_ORDER.map((type) => ({ type, count: counts.get(type) ?? 0 }));
  if (groupCount > 0) out.push({ type: "group", count: groupCount });
  return out;
}

/** 颜色字符串 → 小写 #rrggbb；非法（命名色 / 空串 / 未知格式）→ null 跳过 */
function normalizeHex6(raw: string): string | null {
  try {
    // normalizeColor 校验 #rgb/#rrggbb/#rrggbbaa 并小写归一；#rgb 自动展开 6 位
    const normalized = normalizeColor(raw);
    // #rrggbbaa → 截前 7 位（alpha 不参与调色板聚合，透明度差异由渲染层表达）
    return normalized.slice(0, 7);
  } catch {
    return null;
  }
}

/** 单个图层的颜色提取：text.color / rect.fill / ellipse.fill（VIR v1 无 stroke 字段） */
function layerColors(layer: VirLayer): string[] {
  switch (layer.type) {
    case "text":
      return [layer.text.color];
    case "rect":
      return [layer.rect.fill];
    case "ellipse":
      return [layer.ellipse.fill];
    default:
      return [];
  }
}

/** topColors：图层 fill/color + 场景背景 + meta 背景 → 归一聚合（count 降序 + hex 升序，截 TOP_COLORS_LIMIT） */
function collectTopColors(compile: CompileResult): ColorCount[] {
  const vir = compile.vir;
  const tally = new Map<string, number>();
  const add = (raw: string): void => {
    const hex = normalizeHex6(raw);
    if (hex === null) return;
    tally.set(hex, (tally.get(hex) ?? 0) + 1);
  };
  add(vir.meta.background);
  for (const scene of vir.scenes) {
    if (scene.background !== undefined) add(scene.background);
    for (const layer of scene.layers) {
      for (const color of layerColors(layer)) add(color);
    }
  }
  return [...tally.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : compareStrings(a.hex, b.hex)))
    .slice(0, TOP_COLORS_LIMIT);
}

/** fontsUsed：text 图层 font 字段聚合（count 降序 + font 升序） */
function collectFonts(compile: CompileResult): FontCount[] {
  const tally = new Map<string, number>();
  for (const scene of compile.vir.scenes) {
    for (const layer of scene.layers) {
      if (layer.type !== "text") continue;
      tally.set(layer.text.font, (tally.get(layer.text.font) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([font, count]) => ({ font, count }))
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : compareStrings(a.font, b.font)));
}

/** transitions：总数 + 按类型计数（count 降序 + type 升序） */
function collectTransitions(compile: CompileResult): TransitionStats {
  const tally = new Map<VirTransitionType, number>();
  for (const transition of compile.vir.transitions) {
    tally.set(transition.type, (tally.get(transition.type) ?? 0) + 1);
  }
  const types = [...tally.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : compareStrings(a.type, b.type)));
  return { count: compile.vir.transitions.length, types };
}

/** 复杂度启发式（0-100）：场景数量 / 图层密度 / 转场密度 / 动画密度 四因子各占 25 分 */
function scoreComplexity(vir: Vir): ComplexityInfo {
  const sceneCount = vir.scenes.length;
  const layerCount = vir.scenes.reduce((sum, scene) => sum + scene.layers.length, 0);
  const animationCount = vir.scenes.reduce(
    (sum, scene) => sum + scene.layers.reduce((inner, layer) => inner + layer.animations.length, 0),
    0,
  );
  const avgLayersPerScene = sceneCount > 0 ? layerCount / sceneCount : 0;
  const avgAnimationsPerLayer = layerCount > 0 ? animationCount / layerCount : 0;
  const sceneSwitches = Math.max(sceneCount - 1, 1);
  const transitionDensity = vir.transitions.length / sceneSwitches;

  const factors: ComplexityFactor[] = [
    { label: "场景数量", weight: round2(clamp01(sceneCount / COMPLEXITY_MAX_SCENES)) },
    { label: "图层密度", weight: round2(clamp01(avgLayersPerScene / COMPLEXITY_MAX_LAYERS_PER_SCENE)) },
    { label: "转场密度", weight: round2(clamp01(transitionDensity)) },
    { label: "动画密度", weight: round2(clamp01(avgAnimationsPerLayer / COMPLEXITY_MAX_ANIMATIONS_PER_LAYER)) },
  ];
  const rawScore = factors.reduce((sum, factor) => sum + factor.weight, 0) * COMPLEXITY_FACTOR_SHARE;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  return { score, factors };
}

// ---------------------------------------------------------------------------
// 事件统计（纯函数：输入 ServerEvent 环形缓冲快照）
// ---------------------------------------------------------------------------

/** 事件分类键：vap 事件展开为 `vap:<kind>`，其余用 ServerEvent.type */
function eventKey(event: ServerEvent): string {
  return event.type === "vap" ? `vap:${event.event.kind}` : event.type;
}

/** 事件时间戳：仅 vap 事件携带（VapEvent.at ISO 串）；server 合成事件无时间戳 → null */
function eventTime(event: ServerEvent): string | null {
  return event.type === "vap" ? event.event.at : null;
}

/** vap 审计事件摘要（detail 防御性读取：形状不符时退化为纯 kind 描述，绝不抛错） */
function summarizeVapEvent(kind: string, tool: string | undefined, detail: unknown): string {
  switch (kind) {
    case "tool-call":
      return `审计：调用工具 ${tool ?? "(unknown)"}`;
    case "tool-result":
      return `审计：工具返回 ${tool ?? "(unknown)"}`;
    case "compile": {
      if (isRecord(detail) && typeof detail.scenes === "number" && typeof detail.duration === "number") {
        return `审计：编译完成（${detail.scenes} 场景 / ${round2(detail.duration)}s）`;
      }
      return "审计：编译完成";
    }
    case "render": {
      if (isRecord(detail) && typeof detail.video === "string") {
        return `审计：渲染完成（${detail.video}）`;
      }
      return "审计：渲染完成";
    }
    case "test": {
      if (
        isRecord(detail) &&
        typeof detail.totalPassed === "number" &&
        typeof detail.totalFailed === "number"
      ) {
        return `审计：测试完成（${detail.totalPassed} 通过 / ${detail.totalFailed} 失败）`;
      }
      return "审计：测试完成";
    }
    case "transaction":
      return "审计：事务操作";
    default:
      return `审计：${kind}`;
  }
}

/** 事件 → 一行中文摘要（供 EventsPanel / UsagePanel 直接渲染） */
function summarizeEvent(event: ServerEvent): string {
  switch (event.type) {
    case "vap":
      return summarizeVapEvent(event.event.kind, event.event.tool, event.event.detail);
    case "server":
      return `服务器消息：${event.message}`;
    case "compile":
      return `编译${event.ok ? "成功" : "失败"}：${event.totalFrames} 帧 / ${round2(event.durationSeconds)}s`;
    case "render-progress":
      return `渲染进度：${event.phase}（第 ${event.frame}/${event.totalFrames} 帧）`;
    case "render-done":
      return `渲染完成：${event.video}（${event.frames} 帧，缓存命中 ${event.cacheHits}）`;
    case "render-error":
      return `渲染失败：${event.error}`;
    case "test-done":
      return `测试完成：${event.totalPassed} 通过 / ${event.totalFailed} 失败`;
    case "agent-done":
      return `Agent 执行${event.ok ? "完成" : "失败"}：${event.toolCallCount} 次工具调用`;
    case "agent-run-start":
      return `对话运行开始（${event.runId}）`;
    case "agent-text":
      return `模型输出：${event.text.slice(0, 48)}${event.text.length > 48 ? "…" : ""}`;
    case "agent-tool": {
      const durationSuffix = event.durationMs !== undefined ? `，${event.durationMs}ms` : "";
      return `工具调用 ${event.name}：${event.status}${durationSuffix}`;
    }
    case "agent-run-done":
      return `对话运行${event.ok ? "完成" : "失败"}：${event.steps} 步`;
    case "agent-confirm":
      return `等待确认：${event.tool.name}（${event.confirmId}）`;
    case "agent-resolved":
      return `确认裁决：${event.decision}（${event.confirmId}）`;
  }
}

/** 环形缓冲快照 → usage 统计（排序确定性：count 降序 + 键升序） */
function analyzeEvents(events: readonly ServerEvent[]): UsageAnalyticsResponse {
  const tally = new Map<string, number>();
  let compileCount = 0;
  let renderEvents = 0;
  let testRuns = 0;
  for (const event of events) {
    const key = eventKey(event);
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (COMPILE_EVENT_KEYS.has(key)) compileCount += 1;
    if (RENDER_EVENT_KEYS.has(key)) renderEvents += 1;
    if (TEST_EVENT_KEYS.has(key)) testRuns += 1;
  }
  const byType: TypeCount[] = [...tally.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : compareStrings(a.type, b.type)));
  const recent: RecentEventItem[] = events.slice(-RECENT_EVENTS_LIMIT).map((event) => ({
    type: eventKey(event),
    at: eventTime(event),
    summary: summarizeEvent(event),
  }));
  return { total: events.length, byType, recent, compileCount, renderEvents, testRuns };
}

// ---------------------------------------------------------------------------
// 健康快照
// ---------------------------------------------------------------------------

/** process.versions 窄化视图（Node 类型不含 bun 字段；Bun 运行时携带 → 结构化兼容读取，无 any） */
interface ProcessVersionsView {
  readonly node?: string;
  readonly bun?: string;
}

function runtimeInfo(): RuntimeInfo {
  const versions: ProcessVersionsView = process.versions;
  return { version: process.version, bun: versions.bun ?? null };
}

/** skills 快照统计（skillsSnapshot 读盘；异常 → null 而非伪造，客户端显示「不可用」） */
async function skillsHealth(state: ServerState): Promise<{ total: number; enabled: number } | null> {
  try {
    const snapshot = await skillsSnapshot(state.settings);
    return {
      total: snapshot.skills.length,
      enabled: snapshot.skills.filter((skill) => skill.enabled).length,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 路由注册（app.ts 在既有 api 路由之后调用一次）
// ---------------------------------------------------------------------------

/** 挂载 /api/analytics/* 三个只读端点（project / health / usage） */
export function registerAnalyticsRoutes(app: Hono, state: ServerState): void {
  // ---- GET /api/analytics/project：上次编译产物的只读分析（不重编译） ----
  app.get("/api/analytics/project", (c) => {
    const session = state.projectSession;
    const compile: CompileResult | null = session?.session.lastCompile ?? null;
    if (session === null || compile === null) {
      const unavailable: ProjectAnalyticsResponse = { available: false };
      return c.json(unavailable);
    }
    const response: ProjectAnalyticsResponse = {
      available: true,
      project: { name: session.project.manifest.name, entry: session.project.manifest.entry },
      summary: summarizeScenes(compile),
      layerTypes: countLayerTypes(compile),
      topColors: collectTopColors(compile),
      fontsUsed: collectFonts(compile),
      complexity: scoreComplexity(compile.vir),
      transitions: collectTransitions(compile),
    };
    return c.json(response);
  });

  // ---- GET /api/analytics/health：进程/运行时/连接/会话/MCP/Skills/Provider/渲染快照 ----
  app.get("/api/analytics/health", async (c) => {
    const settings = state.settings.get();
    const memory = process.memoryUsage();
    const render = state.render;
    const response: HealthAnalyticsResponse = {
      status: "ok",
      uptimeSeconds: round1(process.uptime()),
      memoryMB: {
        rss: bytesToMB(memory.rss),
        heapUsed: bytesToMB(memory.heapUsed),
        heapTotal: bytesToMB(memory.heapTotal),
      },
      runtime: runtimeInfo(),
      wsConnections: state.hub.connections,
      sessions: { count: state.sessions.list().length },
      mcp: {
        servers: settings.mcp.servers.length,
        enabled: settings.mcp.servers.filter((server) => server.enabled).length,
      },
      skills: await skillsHealth(state),
      providers: {
        count: settings.providers.entries.length,
        configured: settings.providers.entries.filter((entry) => entry.enabled !== false).length,
      },
      render: {
        running: render.running,
        startedAt: render.startedAt,
        scene: render.scene,
        progress: render.progress,
        error: render.error,
      },
      version: VIDEOOS_VERSION,
    };
    return c.json(response);
  });

  // ---- GET /api/analytics/usage：EventHub 环形缓冲统计（最近 500 条 + 20 条摘要） ----
  app.get("/api/analytics/usage", (c) => {
    const response: UsageAnalyticsResponse = analyzeEvents(state.hub.recent());
    return c.json(response);
  });
}
