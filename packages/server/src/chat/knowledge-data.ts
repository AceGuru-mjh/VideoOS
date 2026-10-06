// 知识工具数据（Task 11-b，v0.2.1）：动效模式库（pattern.search / pattern.get）+ DSL 分主题速查（dsl.reference）。
// 事实来源（源码为准，docs/dsl-reference.md 可能滞后；不一致处以源码为准并已在本文件修正）：
//   - packages/dsl/src/{types,builder,effects,validate}.ts — 选项形状 / 默认值 / 构建期校验
//   - packages/compiler/src/frame-plan.ts — 效果方向语义 / enter/exit 求值 / 默认参数（distance 40 / blur 12）
//   - packages/compiler/src/{timing,transition,diagnostics,assets}.ts — 场景时序 / 过渡重叠 / 诊断码
//   - packages/core/src/easing.ts — 11 个合法缓动名
//   - packages/render-canvas/src/renderer.ts — text 单行绘制 / textAlign 语义（at.x 随 align 变锚点）
// 契约：
//   - MOTION_PATTERNS 每条 code 为真实可编译 DSL 片段，两种形态：
//     A) 场景体（默认）：只含 s.* 调用，首行注释标注「适用场景时长 ≥Ns」，粘贴进 v.scene 回调即可；
//     B) 整程序（cut-on-beat 等跨场景节奏模式与全部 transition 类）：含 v.scene/v.transition/v.audio，
//        粘贴进 defineVideo 的 builder 回调。
//   - DSL_TOPICS 键序即 dsl.reference 的 available 列表顺序（稳定，勿乱序）；每条含 key（=Record 键）/ title（中文）/
//     aliases（大小写不敏感）/ content（markdown ≤3500 字符）/ related（合法键）。

// ---------------------------------------------------------------- 动效模式库

/** 动效模式（可抄 DSL 片段 + 引擎陷阱） */
export interface MotionPattern {
  /** kebab-case 标识（pattern.get 入参） */
  id: string;
  /** 中文名（搜索命中项之一） */
  name: string;
  /** 英文小写标签（含唯一类目标签：hook/rhythm/text/data/visual/transition/ending） */
  tags: string[];
  /** 中文描述 ≤80 字符（搜索命中项之一） */
  description: string;
  /** 真实 DSL 片段 8-30 行（场景体或整程序，见文件头注） */
  code: string;
  /** 1-3 条引擎陷阱（带 why，中文） */
  notes: string;
}

export const MOTION_PATTERNS: MotionPattern[] = [
  // ------------------------------------------------ 开场 / hook（5）
  {
    id: "typewriter-title",
    name: "打字机标题",
    tags: ["hook", "typewriter", "opening", "title"],
    description: "打字机主标题：全大写词 1 秒打完，副标题随后淡入，1 秒钩子成立",
    code: `// 适用场景时长 ≥4s：主标题 linear 打字 1.0s 完成，副标题延迟淡入
s.beat("title-done", { at: 1.0, description: "主标题打完" });
s.ellipse("glow", { width: 900, height: 500, fill: "#22d3ee", opacity: 0.12, blur: 140, at: { x: "50%", y: "40%" } });
s.text("title", "SHIP IT TODAY", { size: 120, weight: 800, letterSpacing: 6, color: "#f8fafc",
  at: { x: "50%", y: "40%" }, enter: { effect: "typewriter", duration: 1.0, easing: "linear" } });
s.text("subtitle", "from agent to mp4", { size: 44, color: "#7dd3fc",
  at: { x: "50%", y: "56%" }, in: 1.3, enter: { effect: "fade", duration: 0.5 } });
s.rect("rule", { width: 420, height: 3, fill: "#22d3ee", radius: 1.5,
  at: { x: 960, y: 640 }, in: 1.6, enter: { effect: "fade", duration: 0.4 } });`,
    notes:
      "1) typewriter 仅 text 层可表达，rect/ellipse 上会得 EFFECT_UNSUPPORTED 警告且动画被忽略；" +
      "2) 打字期间 toContainText 只能看到前缀，QA 断言全文要放在 in+delay+duration 之后；" +
      "3) linear 最像「真打字」，easeOutCubic 是「先快后慢的计数感」。",
  },
  {
    id: "blur-up-hero",
    name: "模糊上浮主视觉",
    tags: ["hook", "hero", "blur", "opening"],
    description: "主词模糊上浮落定，底部强调线用背景色遮罩右移实现左到右生长",
    code: `// 适用场景时长 ≥4s：主词 blur-up 落定后，强调线靠「背景色遮罩右移」从左向右生长
s.beat("hero-land", { at: 0, description: "主词落定" });
s.text("hero", "AGENT VIDEO", { size: 150, weight: 800, letterSpacing: 8, color: "#f8fafc",
  at: { x: "50%", y: "40%" }, enter: { effect: "blur-up", duration: 0.7, params: { distance: 60 } } });
s.rect("accent-line", { width: 720, height: 4, fill: "#22d3ee", radius: 2, at: { x: 960, y: 540 } });
// 遮罩：背景色 rect 盖住线条右段（初始中心 1260/宽 1800 恰好全遮 [360,2160]），exit slide-left 向右滑走
s.rect("line-mask", { width: 1800, height: 12, fill: "#0a0a12", at: { x: 1260, y: 540 },
  in: 0, out: 1.5, exit: { effect: "slide-left", duration: 0.8, easing: "easeOutCubic", params: { distance: 1200 } } });`,
    notes:
      "1) rect 上没有 wipe（仅 text 层）——线条生长只能靠背景色遮罩滑走，遮罩 fill 必须等于场景背景色；" +
      "2) 遮罩必须声明在线条之后（painter's order：后声明者绘制在上层）；" +
      "3) exit 的起点是 out−delay−duration（本例 0.7s 处开始揭示、1.5s 完成）。",
  },
  {
    id: "big-number-impact",
    name: "大数字冲击",
    tags: ["hook", "number", "scale-pop", "impact"],
    description: "巨大数字 scale-pop 砸下 + 光环同拍脉冲，第一帧就有冲击力",
    code: `// 适用场景时长 ≥3s：340px 数字 0.45s 落地，光环与说明随后到
s.beat("impact", { at: 0, description: "数字砸下" });
s.ellipse("shock", { width: 1100, height: 1100, fill: "#f59e0b", opacity: 0.16, blur: 120,
  at: { x: "50%", y: "44%" }, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutCubic" } });
s.text("number", "99%", { size: 340, weight: 800, color: "#f8fafc",
  at: { x: "50%", y: "44%" }, enter: { effect: "scale-pop", duration: 0.45, easing: "easeOutBack" } });
s.text("caption", "faster renders", { size: 48, color: "#fbbf24",
  at: { x: "50%", y: "68%" }, in: 0.35, enter: { effect: "fade", duration: 0.4 } });`,
    notes:
      "1) scale-pop 本体不过冲（缩放 0.6 到 1.0 的线性因子）——弹性来自 easing（easeOutBack/spring 输出可大于 1）；" +
      "2) scale-pop 的 opacity 以双倍速率爬升（min(1, e*2)），约 0.25s 就可读，适合 1 秒钩子；" +
      "3) 数字要 ≥240px 才有「事件感」，小了像组件不像海报。",
  },
  {
    id: "logo-stamp",
    name: "徽标落章",
    tags: ["hook", "logo", "stamp", "brand"],
    description: "徽标自上方快速落下盖章，冲击光环只在落点后存活 0.7 秒",
    code: `// 适用场景时长 ≥3s：字标自上方 260px 落下，底板先弹、光环只在落点后存活 0.7s
s.beat("stamp", { at: 0.25, description: "徽标落章" });
s.ellipse("plate", { width: 460, height: 460, fill: "#1e1b4b", at: { x: "50%", y: "44%" },
  enter: { effect: "scale-pop", duration: 0.35, easing: "easeOutBack" } });
s.text("mark", "VO", { size: 170, weight: 800, letterSpacing: 4, color: "#f8fafc",
  at: { x: "50%", y: "44%" }, enter: { effect: "slide-down", duration: 0.3, easing: "easeOutExpo", params: { distance: 260 } } });
s.ellipse("impact-ring", { width: 620, height: 620, fill: "#8b5cf6", opacity: 0.22, blur: 60,
  at: { x: "50%", y: "44%" }, in: 0.25, out: 0.95, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutCubic" } });`,
    notes:
      "1) slide-down 入场=自上方下落（offsetY 从 −distance 起）；但 exit slide-down 是「原路返回」=向上升离，方向词描述的是进入路径；" +
      "2) 光环用 in/out 窗口限定生命周期（0.25-0.95s），不需要动画结束也能「消失」；" +
      "3) easeOutExpo 极快起手，适合「砸下」的重感。",
  },
  {
    id: "question-hook",
    name: "提问式钩子",
    tags: ["hook", "question", "engagement"],
    description: "以问句开场抓人：正文模糊聚焦，问号延迟重击，答案留给下一场景",
    code: `// 适用场景时长 ≥3s：安静开场——问句 blur-in，问号延迟 scale-pop，尾巴吊一句预告
s.beat("question-land", { at: 0, description: "问题出现" });
s.text("question", "Still rendering overnight?", { size: 88, weight: 700, color: "#f8fafc",
  at: { x: "50%", y: "42%" }, enter: { effect: "blur-in", duration: 0.6, params: { blur: 18 } } });
s.text("mark", "?", { size: 200, weight: 800, color: "#f59e0b",
  at: { x: "78%", y: "28%" }, in: 0.45, enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutBack" } });
s.text("tease", "answer in 10 seconds", { size: 40, color: "#8b8ba7",
  at: { x: "50%", y: "62%" }, in: 1.0, enter: { effect: "fade", duration: 0.5 } });`,
    notes:
      "1) blur-in 不位移只聚焦，适合安静开场；blur-up 才带 60px 上浮；" +
      "2) 文本是单行绘制——长问句拆两个 text 层做 y 阶梯（约 size*1.3px 一行），不要指望换行符；" +
      "3) 问号单独一层才能给它独立的 enter delay。",
  },

  // ------------------------------------------------ 节奏（5）
  {
    id: "stagger-list",
    name: "交错列表",
    tags: ["rhythm", "stagger", "list", "slide-up"],
    description: "列表逐条上浮入场，0.35 秒步进，用 in 窗口控错拍（slide 不动 opacity）",
    code: `// 适用场景时长 ≥4s：三行卡片 0.35s 步进上浮；注意错拍写在 in 窗口而不是 delay
s.beat("list-start", { at: 0.15, description: "首条入场" });
const ITEMS = ["Zero setup", "Deterministic frames", "Agent-native QA"];
ITEMS.forEach((label, i) => {
  const t = 0.15 + i * 0.35;              // 第 i 条的入场时刻（错拍=步进 in 窗口）
  s.rect("row-bg-" + i, { width: 760, height: 96, fill: "#12122a", radius: 12,
    at: { x: 960, y: 360 + i * 150 }, in: t,
    enter: { effect: "slide-up", duration: 0.45, easing: "easeOutCubic", params: { distance: 60 } } });
  s.text("row-" + i, label, { size: 44, weight: 600, color: "#e2e8f0",
    at: { x: 960, y: 360 + i * 150 }, in: t,
    enter: { effect: "slide-up", duration: 0.45, easing: "easeOutCubic", params: { distance: 60 } } });
});`,
    notes:
      "1) slide 系入场不动 opacity（frame-plan 只改 offset）——若用 delay 控错拍，图层会在 in 起点前就「悬停」在偏移处可见；错拍必须写进 in 窗口；" +
      "2) fade/scale-pop 系会动 opacity（e=0 时不可见），用 delay 控错拍则安全；" +
      "3) 步进 0.3-0.45s 是全技能库的节奏推荐区间，快于 0.2s 读不过来。",
  },
  {
    id: "beat-pop",
    name: "节拍弹跳",
    tags: ["rhythm", "beat", "pop", "words"],
    description: "120BPM 节拍网格逐词弹入，每拍一词一点，末词换强调色收束",
    code: `// 适用场景时长 ≥4s：120BPM 一拍 0.5s=15 帧；每拍一词 + 编号点，末词换强调色
const WORDS = ["PLAN", "WRITE", "COMPILE", "SHIP"];
WORDS.forEach((w, i) => {
  const t = i * 0.5;                       // 落在整拍上（量化，禁 0.37 这类漂移值）
  s.beat("beat-" + i, { at: t, description: w + " 落地" });
  s.ellipse("dot-" + i, { width: 26, height: 26, fill: "#22d3ee",
    at: { x: "14%", y: 300 + i * 160 }, in: t,
    enter: { effect: "scale-pop", duration: 0.3, easing: "easeOutBack" } });
  s.text("word-" + i, w, { size: 96, weight: 800, color: i === WORDS.length - 1 ? "#f59e0b" : "#f8fafc",
    at: { x: "26%", y: 300 + i * 160 }, in: t,
    enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutCubic" } });
});`,
    notes:
      "1) beat 与 layer 是两个命名空间（id 前缀 beat_/layer_ 不同），同名不冲突；" +
      "2) 30fps 下 0.5s=15 帧是整数，半拍 0.25s=7.5 帧不是整数——事件落半拍时帧断言要取 7 或 8 并注明；" +
      "3) 编号点用 ellipse（直径 26px），文字前的视觉锚点比纯文字列表更有节奏感。",
  },
  {
    id: "ticker-window",
    name: "跑马灯窗口轮换",
    tags: ["rhythm", "ticker", "window", "rotation"],
    description: "固定节奏信息轮换：slide-left 入 + slide-right 出，连续左移传送带观感",
    code: `// 适用场景时长 ≥4s：1.2s/条固定 cadence；slide-left 入（自右移入）+ slide-right 出（向左退场）
const NEWS = ["Market up 2.4%", "Renders 3x faster", "Zero dropped frames"];
NEWS.forEach((line, i) => {
  const start = i * 1.2;
  const anim = { enter: { effect: "slide-left", duration: 0.3, easing: "easeOutCubic", params: { distance: 320 } },
    exit: { effect: "slide-right", duration: 0.3, easing: "easeInQuad", params: { distance: 320 } } };
  s.rect("chip-" + i, { width: 820, height: 90, fill: "#12122a", radius: 45,
    at: { x: 960, y: 540 }, in: start, out: start + 1.2, ...anim });
  s.text("headline-" + i, line, { size: 52, weight: 700, color: "#f8fafc",
    at: { x: 960, y: 540 }, in: start, out: start + 1.2, ...anim });
});
s.beat("rotate", { at: 1.2, description: "第 2 条滑入" });`,
    notes:
      "1) 方向语义（frame-plan 源码）：slide-left 入场=自右向左移入；slide-right 退场=向左离场——组合出「连续左移传送带」；" +
      "2) exit 从 out−delay−duration 提前开始（本例 0.9s 处已在退场），新条正好在 1.2s 接棒；" +
      "3) 进出共用一个 anim 对象（结构展开）可保证几何完全同槽，避免错位。",
  },
  {
    id: "pulse-loop",
    name: "心跳脉冲",
    tags: ["rhythm", "pulse", "halo", "loop"],
    description: "v1 无 loop 动画，用同位短窗口光环堆叠模拟每拍一次的心跳脉冲",
    code: `// 适用场景时长 ≥4s：v1 DSL 只有 enter/exit（loop 类型未暴露）——脉冲=同位多窗口光环堆叠
s.text("label", "LIVE NOW", { size: 110, weight: 800, letterSpacing: 10, color: "#f8fafc",
  at: { x: "50%", y: "46%" }, enter: { effect: "blur-in", duration: 0.5 } });
for (let k = 0; k < 4; k++) {
  s.ellipse("pulse-" + k, { width: 900, height: 900, fill: "#ef4444", opacity: 0.14, blur: 100,
    at: { x: "50%", y: "46%" }, in: k * 1.0, out: k * 1.0 + 0.8,
    enter: { effect: "scale-pop", duration: 0.6, easing: "easeOutCubic" },
    exit: { effect: "fade", duration: 0.2 } });
  s.beat("tick-" + k, { at: k * 1.0, description: "第 " + (k + 1) + " 拍" });
}`,
    notes:
      "1) 图层动画槽只有 enter/exit 两个（CommonLayerOptions）——loop 动画存在于内部 AST 但 DSL 不暴露，别去找 s.loop；" +
      "2) 每个 ellipse 的可见窗口 [in, in+0.8) 首尾相接，视觉上「每秒跳一次」；" +
      "3) exit fade 从 out−0.2 开始，让脉冲尾部自然散去而不是硬切。",
  },
  {
    id: "cut-on-beat",
    name: "卡点硬切",
    tags: ["rhythm", "cut", "beat", "sync"],
    description: "双场景卡点硬切：A 蓄力 exit、B 下拍即炸，cut 边界落在节拍上",
    code: `// 整程序片段（含 v.scene/v.transition，粘贴进 defineVideo 的 builder 回调）：
// A 的收尾动作与 B 的第一动作落在同一边界秒，cut 不重叠、总时长=两场景之和
v.scene("a", { duration: 2 }, (s) => {
  s.beat("a-final", { at: 1.8, description: "蓄力到最后 0.2s" });
  s.text("buildup", "READY", { size: 120, weight: 800, color: "#8b8ba7",
    at: { x: "50%", y: "50%" }, enter: { effect: "fade", duration: 0.3 },
    exit: { effect: "scale-pop", duration: 0.2 } });
});
v.scene("b", { duration: 2 }, (s) => {
  s.beat("b-hit", { at: 0, description: "下拍即炸" });
  s.text("drop", "GO", { size: 300, weight: 800, color: "#f59e0b",
    at: { x: "50%", y: "50%" }, enter: { effect: "scale-pop", duration: 0.3, easing: "easeOutExpo" } });
});
v.transition("cut", { between: ["a", "b"] });`,
    notes:
      "1) cut 不产生重叠（timing.ts：后场景 start=前场景 end），B 的 beat at:0 就是全局边界拍；" +
      "2) exit scale-pop 会把图层缩回 0.6 倍并双速淡走（e 反向重放）；" +
      "3) 想要重叠混叠感改 crossfade，但下拍瞬发力会稀释——卡点首选硬切。",
  },

  // ------------------------------------------------ 文字（6）
  {
    id: "word-wave",
    name: "逐词波浪",
    tags: ["text", "wave", "stagger", "words"],
    description: "一句话逐词波浪上浮入场，词距 0.3 秒，末词落定后整句静止",
    code: `// 适用场景时长 ≥4s：逐词 x 网格 + 0.3s 波浪步进，关键词单独换色
const WORDS = ["Ship", "video", "at", "the", "speed", "of", "chat"];
const X0 = 480, GAP = 130;                 // 逐词 x 网格（1920 画布居中排布）
WORDS.forEach((w, i) => {
  s.text("w-" + i, w, { size: 72, weight: 700, color: i === 3 ? "#f59e0b" : "#f8fafc",
    at: { x: X0 + i * GAP, y: 540 }, in: 0.2 + i * 0.3,
    enter: { effect: "slide-up", duration: 0.5, easing: "easeOutCubic", params: { distance: 90 } } });
});
s.beat("wave-done", { at: 2.5, description: "末词落定（0.2+6*0.3+0.5）" });`,
    notes:
      "1) 词间距用固定网格最稳（估算词宽 chars*size*0.62）；中文逐词同理按字数排格；" +
      "2) 波浪幅度 distance 90 比列表入场的 60 大——波浪要的就是能看出「先后」；" +
      "3) slide-up 不动 opacity，错拍写在 in 窗口（同 stagger-list 陷阱）。",
  },
  {
    id: "keyword-punch",
    name: "关键词重击",
    tags: ["text", "keyword", "emphasis", "scale-pop"],
    description: "平句先行、关键词大字号二次重击，两级字号拉开信息层级",
    code: `// 适用场景时长 ≥3s：小字平句先到，关键词 2.7 倍字号砸下 + 色条收边
s.text("line", "the new default is", { size: 56, color: "#8b8ba7",
  at: { x: "50%", y: "38%" }, enter: { effect: "fade", duration: 0.4 } });
s.beat("punch", { at: 0.4, description: "关键词砸下" });
s.text("keyword", "VIDEO FIRST", { size: 150, weight: 800, letterSpacing: 6, color: "#f8fafc",
  at: { x: "50%", y: "56%" }, in: 0.4, enter: { effect: "scale-pop", duration: 0.45, easing: "easeOutBack" } });
s.rect("keyword-bar", { width: 560, height: 10, fill: "#f59e0b", radius: 5,
  at: { x: 960, y: 660 }, in: 0.7, enter: { effect: "slide-up", duration: 0.4, params: { distance: 30 } } });`,
    notes:
      "1) 两级字号比至少 2.5:1（56 对 150）才有「重击」层级，1.5:1 只是排版不是强调；" +
      "2) easeOutBack 会过冲（输出大于 1）再回落，比 easeOutCubic 更「砸」；" +
      "3) 色条入场用 slide-up 小位移（distance 30）低调补位，别抢关键词的拍。",
  },
  {
    id: "same-position-swap",
    name: "同位换句",
    tags: ["text", "swap", "window", "rotation"],
    description: "同位换句：三句文案共享一个位置，靠 in/out 窗口硬切轮换",
    code: `// 适用场景时长 ≥4s：三句共享同一 at，窗口 [in,out) 首尾相接；首句带入场其余硬切
const LINES = ["Plan the storyboard", "Write the DSL", "Ship the MP4"];
LINES.forEach((line, i) => {
  const start = 0.3 + i * 1.1;
  if (i === 0) {
    s.text("line-0", line, { size: 76, weight: 700, color: "#f8fafc",
      at: { x: "50%", y: "46%" }, in: start, out: start + 1.1,
      enter: { effect: "blur-up", duration: 0.4 } });
  } else {
    s.text("line-" + i, line, { size: 76, weight: 700, color: "#f8fafc",
      at: { x: "50%", y: "46%" }, in: start, out: start + 1.1 });
  }
  s.beat("swap-" + i, { at: start, description: "第 " + (i + 1) + " 句" });
});`,
    notes:
      "1) 窗口是半开区间 [in,out)：旧句在 out 当帧即消失，QA 断言旧句要卡在边界前一帧；" +
      "2) 新句不写 enter 就是硬切换句（无动画即动画），比每句都淡入更干脆；" +
      "3) 末句想定格到场景尾就把最后一句的 out 写成场景时长。",
  },
  {
    id: "quote-reveal",
    name: "引文揭示",
    tags: ["text", "quote", "typewriter", "attribution"],
    description: "巨引号家具低透明压场，正文打字机揭示，署名最后淡入",
    code: `// 适用场景时长 ≥5s：巨引号（U+201C）低透明度做「家具」，正文 linear 打字，署名压轴
s.text("quote-mark", "\\u201C", { size: 420, weight: 800, color: "#6d28d9", opacity: 0.35,
  at: { x: "18%", y: "30%" }, enter: { effect: "fade", duration: 0.5 } });
s.text("quote", "The best render is the one you can replay.", { size: 58, weight: 600, color: "#e2e8f0",
  at: { x: "50%", y: "48%" }, enter: { effect: "typewriter", duration: 1.6, delay: 0.4, easing: "linear" } });
s.beat("quote-done", { at: 2.0, description: "引文打完（0.4+1.6）" });
s.text("author", "- playback engineer", { size: 40, color: "#8b8ba7",
  at: { x: "50%", y: "64%" }, in: 2.2, enter: { effect: "fade", duration: 0.5 } });`,
    notes:
      "1) 单行绘制——长引文拆两层用同位窗口轮换（same-position-swap），别指望自动换行（maxWidth 不换行，只触发 OVERFLOW_RISK）；" +
      "2) 引文是用户原话时禁改写（verbatim 原则），翻译要注明；" +
      "3) 引号层 opacity 0.35 做「家具」，永远别跟正文抢对比度。",
  },
  {
    id: "highlight-underline",
    name: "下划线强调",
    tags: ["text", "underline", "rect", "geometry"],
    description: "关键词下划线：用 chars×size×0.62 估宽公式算 rect 宽度，fade 入场",
    code: `// 适用场景时长 ≥4s：下划线宽度=估宽公式（与溢出诊断/wipe 同源的启发式）
const KEYWORD = "DETERMINISTIC";
const SIZE = 88, LS = 8;                   // 字号 / letterSpacing
const EST = Math.round(KEYWORD.length * SIZE * 0.62 + (KEYWORD.length - 1) * LS);
s.text("line-a", "Everything here is", { size: 56, color: "#8b8ba7",
  at: { x: "50%", y: "40%" }, enter: { effect: "fade", duration: 0.4 } });
s.text("keyword", KEYWORD, { size: SIZE, weight: 800, letterSpacing: LS, color: "#f8fafc",
  at: { x: "50%", y: "52%" }, enter: { effect: "blur-in", duration: 0.5 } });
s.beat("underline-in", { at: 0.6, description: "下划线出现" });
s.rect("underline", { width: EST, height: 8, fill: "#22d3ee", radius: 4,
  at: { x: 960, y: 600 }, in: 0.6, out: 3.4,
  enter: { effect: "fade", duration: 0.4 }, exit: { effect: "fade", duration: 0.4 } });`,
    notes:
      "1) 估宽公式 chars*size*0.62 是引擎同款启发式（OVERFLOW_RISK 诊断与 wipe 裁剪盒都用它），配 (len−1)*letterSpacing 补间距；" +
      "2) rect 上不能用 wipe（EFFECT_UNSUPPORTED，动画被忽略）——想要「生长」感用 progress-bar-grow 的遮罩法；" +
      "3) 下划线 y 放关键词中心下方约 size 的 0.4-0.5 倍处（本例关键词中心 562 → 下划线 600，间距 38px），别贴字。",
  },
  {
    id: "rolling-counter",
    name: "翻牌计数",
    tags: ["text", "counter", "roll", "flip"],
    description: "翻牌计数：旧数字 exit slide-down 向上飞离 + 新数字自下补位，整版上滚",
    code: `// 适用场景时长 ≥4s：数字 k 占 [4-k, 5-k) 秒窗口；exit slide-down（向上飞离）+ enter slide-up（自下来）
for (let k = 3; k >= 1; k--) {
  const start = 3 - k;                     // 3 -> 0s, 2 -> 1s, 1 -> 2s
  s.beat("roll-" + k, { at: start, description: "数字 " + k });
  s.text("digit-" + k, String(k), { size: 300, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "44%" }, in: start, out: start + 1,
    enter: { effect: "slide-up", duration: 0.3, easing: "easeOutCubic", params: { distance: 220 } },
    exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
}
s.text("go", "GO", { size: 200, weight: 800, color: "#f59e0b",
  at: { x: "50%", y: "44%" }, in: 3, enter: { effect: "scale-pop", duration: 0.3, easing: "easeOutBack" } });`,
    notes:
      "1) 方向口诀（源码）：exit 沿入场路径反向重放——exit slide-down=向上升离，配 enter slide-up（自下来）=整版上滚；" +
      "2) 反模式：exit slide-up + enter slide-up——两者走同一条偏移曲线，翻牌瞬间完全重叠糊成一团；" +
      "3) 窗口边界秒即节拍秒（整数对齐），每秒一拍读得清。",
  },

  // ------------------------------------------------ 数据（5）
  {
    id: "count-up-kpi",
    name: "KPI 计数",
    tags: ["data", "count-up", "kpi", "typewriter"],
    description: "KPI 打字机计数 + 标签次第入场，等宽字体让数字稳如仪表盘",
    code: `// 适用场景时长 ≥5s：数值 typewriter 揭示（读作计数），标签与标尺随后到
s.text("value", "1,284,096 frames", { size: 110, weight: 800, font: "monospace", color: "#f8fafc",
  at: { x: "50%", y: "42%" }, enter: { effect: "typewriter", duration: 1.4, easing: "easeOutCubic" } });
s.beat("count-done", { at: 1.4, description: "计数完成" });
s.text("label", "rendered this month", { size: 46, color: "#7dd3fc",
  at: { x: "50%", y: "56%" }, in: 1.6, enter: { effect: "fade", duration: 0.5 } });
s.rect("rule", { width: 420, height: 3, fill: "#22d3ee", radius: 1.5,
  at: { x: 960, y: 640 }, in: 1.8, enter: { effect: "fade", duration: 0.4 } });`,
    notes:
      "1) 一层 typewriter 就是计数动画——别用多个文本层轮换数字（层数爆炸且 QA 难写）；" +
      "2) 位数多时 duration 放大到 1.2-1.6s；easeOutCubic 让高位数先出（快起慢收=先粗后细）；" +
      "3) monospace 等宽数字位对位稳定，sans 会随字符宽度抖动。",
  },
  {
    id: "progress-bar-grow",
    name: "进度条生长",
    tags: ["data", "progress", "bar", "mask"],
    description: "进度条生长：背景色遮罩 exit slide-left 右移，填充从左向右推进",
    code: `// 适用场景时长 ≥4s：填充条完整存在，靠背景色遮罩右移「擦出」——声明序=层级（fill 底、遮罩中、半透明轨顶）
s.rect("fill", { width: 1200, height: 36, fill: "#22d3ee", radius: 18, at: { x: 960, y: 540 } });
s.rect("fill-mask", { width: 1800, height: 48, fill: "#0a0a12", at: { x: 1260, y: 540 },
  in: 0, out: 2.5, exit: { effect: "slide-left", duration: 1.6, easing: "easeInOutCubic", params: { distance: 1200 } } });
s.rect("track", { width: 1200, height: 36, fill: "#22d3ee", opacity: 0.18, radius: 18,
  at: { x: 960, y: 540 }, enter: { effect: "fade", duration: 0.4 } });
s.text("pct", "78%", { size: 60, weight: 800, color: "#f8fafc",
  at: { x: 960, y: 440 }, in: 1.2, enter: { effect: "fade", duration: 0.5 } });
s.beat("grow-done", { at: 2.5, description: "填充到位（exit 0.9s 起、2.5s 完）" });`,
    notes:
      "1) rect 没有 wipe——「擦出式生长」唯一解是背景色遮罩滑走（fill 必须等于场景背景色）；" +
      "2) 遮罩初始几何要全遮目标（中心 1260/宽 1800 恰盖 [360,2160]），exit 距离=需要推进的像素；" +
      "3) 半透明 track 声明在最顶常显——被遮住的填充段看起来就是「未填充轨道」。",
  },
  {
    id: "bar-chart-rise",
    name: "柱状图升起",
    tags: ["data", "chart", "bars", "mask"],
    description: "柱状图从基线生长：slide-up 位移=柱高 + 基线下方背景色遮罩兜底",
    code: `// 适用场景时长 ≥5s：柱最终中心坐在基线上，slide-up 距离=自身高度 → 从基线下方整根顶出
const BASELINE = 760;                      // 1920x1080 画布的横轴 y
const BARS = [                             // height = round(value × 60)
  { name: "bar-q1", value: "3.2", height: 192, x: 620, fill: "#6366f1" },
  { name: "bar-q2", value: "5.8", height: 348, x: 880, fill: "#22d3ee" },
  { name: "bar-q3", value: "4.4", height: 264, x: 1140, fill: "#a78bfa" },
  { name: "bar-q4", value: "7.6", height: 456, x: 1400, fill: "#f59e0b" },
];
BARS.forEach((b, i) => {
  s.rect(b.name, { width: 150, height: b.height, fill: b.fill, radius: 6,
    at: { x: b.x, y: BASELINE - b.height / 2 }, in: 0.3 + i * 0.2,
    enter: { effect: "slide-up", duration: 1.2, easing: "easeOutCubic", params: { distance: b.height } } });
  s.text("val-" + i, b.value, { size: 40, weight: 700, color: "#e2e8f0",
    at: { x: b.x, y: BASELINE - b.height - 46 }, in: 1.7 + i * 0.2,
    enter: { effect: "fade", duration: 0.4 } });
});
s.rect("mask", { width: 1920, height: 320, fill: "#0a0a12", at: { x: 960, y: 920 } });  // 遮基线以下（必须声明在柱后）
s.rect("axis", { width: 1000, height: 4, fill: "#8b8ba7", opacity: 0.7, radius: 2, at: { x: 1010, y: BASELINE } });
s.beat("bars-done", { at: 3.5, description: "末柱到顶（0.9+1.2+标注）" });`,
    notes:
      "1) 遮罩必须声明在柱之后（painter's order）——先罩后柱会把整根柱盖住，技巧静默失效；" +
      "2) distance=柱高才是「从基线长出」；distance 偏小=柱从半空出现，偏大=从画面外飞入；" +
      "3) v1 没有负值/非零基线图——负数改用 delta 徽章（delta-badge）或换算说明。",
  },
  {
    id: "staged-percent",
    name: "分段百分比",
    tags: ["data", "percent", "segments", "stages"],
    description: "分段百分比：10 段方块逐段点亮，点亮数即数值，末段高亮定格",
    code: `// 适用场景时长 ≥5s：点亮数即数据（7/10）——比单根进度条更有"里程碑"感
const TOTAL = 10, FILLED = 7;
for (let i = 0; i < TOTAL; i++) {
  s.rect("seg-" + i, { width: 120, height: 44, radius: 8,
    fill: i < FILLED ? "#22d3ee" : "#1e1e3a",
    at: { x: 260 + i * 150, y: 620 }, in: 0.3 + i * 0.12,
    enter: { effect: "scale-pop", duration: 0.3, easing: "easeOutCubic" } });
}
s.text("pct", "70%", { size: 180, weight: 800, color: "#f8fafc",
  at: { x: "50%", y: "42%" }, enter: { effect: "blur-in", duration: 0.5 } });
s.beat("all-lit", { at: 1.7, description: "全部段点亮（0.3+9*0.12+0.3）" });
s.text("caption", "7 of 10 stages shipped", { size: 44, color: "#7dd3fc",
  at: { x: "50%", y: "72%" }, in: 1.8, enter: { effect: "fade", duration: 0.5 } });`,
    notes:
      "1) 段宽 120px、间距 30px（150 网格）×10 段恰占 [200,1730]，1920 画布居中留白对称；" +
      "2) 填充/未填充色用亮度差（#22d3ee 对 #1e1e3a），别只靠色相差（可访问性）；" +
      "3) scale-pop 双速 opacity 让每段「啪」地出现，0.12s 步进读起来像倒数。",
  },
  {
    id: "delta-badge",
    name: "涨跌徽章",
    tags: ["data", "badge", "delta", "updown"],
    description: "涨跌徽章：数字滑入 + 色块箭头弹出，升绿降红一眼可辨",
    code: `// 适用场景时长 ≥3s：指标名常驻，涨跌值与徽章错半拍弹出（升绿降红双编码：色 + 方向）
s.rect("card", { width: 640, height: 240, fill: "#12122a", radius: 20,
  at: { x: 960, y: 480 }, enter: { effect: "fade", duration: 0.4 } });
s.text("metric", "Weekly active", { size: 44, color: "#8b8ba7",
  at: { x: 960, y: 420 }, enter: { effect: "fade", duration: 0.4 } });
s.text("delta", "+12.4%", { size: 96, weight: 800, color: "#34d399",
  at: { x: 850, y: 520 }, in: 0.3,
  enter: { effect: "slide-up", duration: 0.5, easing: "easeOutCubic", params: { distance: 50 } } });
s.rect("badge", { width: 60, height: 60, radius: 12, fill: "#34d399",
  at: { x: 1080, y: 520 }, in: 0.3, enter: { effect: "scale-pop", duration: 0.35, easing: "easeOutBack" } });
s.text("arrow", "\\u2191", { size: 44, weight: 800, color: "#052e22",
  at: { x: 1080, y: 520 }, in: 0.35, enter: { effect: "fade", duration: 0.2 } });
s.beat("delta-in", { at: 0.3, description: "涨跌徽章弹出" });`,
    notes:
      "1) 跌向直接反转三处：delta 文本（负号/红色 #f87171）、badge 底色、箭头字符（\\u2193）；" +
      "2) 箭头用 Unicode 箭头字符（\\u2191/\\u2193）而非画三角——rect 没有旋转 45 度切角的原语，字符最稳；" +
      "3) 数字与徽章同一 in 窗口 + 不同 enter 效果，同拍弹出层次更足。",
  },

  // ------------------------------------------------ 画面（5）
  {
    id: "ken-burns-push",
    name: "Ken Burns 推镜",
    tags: ["visual", "camera", "push-in", "image"],
    description: "Ken Burns 推镜：图片慢推 1.0 到 1.05，暗带压底字幕（相机会推整帧）",
    code: `// 适用场景时长 ≥4s：图片声明宽高（不声明默认整画布）+ 全屏慢推 + 底部渐变暗带字幕
s.image("photo", "assets/images/hero.jpg", { width: 1920, height: 1080, at: { x: 960, y: 540 } });
s.rect("scrim", { width: 1920, height: 420, fill: "#0a0a12", opacity: 0.55,
  at: { x: 960, y: 890 }, enter: { effect: "fade", duration: 0.5 } });
s.text("caption", "Golden hour, repo bay", { size: 54, weight: 600, color: "#f8fafc",
  at: { x: 960, y: 880 }, in: 0.4, enter: { effect: "slide-up", duration: 0.5, params: { distance: 40 } } });
s.beat("settle", { at: 1.0, description: "字幕落定" });
s.camera("push-in", { from: 1.0, to: 1.05 });`,
    notes:
      "1) 相机作用于整帧全部图层——字幕会跟着被推；想要「图动字幕不动」必须拆两场景（图场景推镜 + cut 到字幕场景）；" +
      "2) push-in 在全场景时长上按 easeOutCubic 推进——前 30% 时间就走完大半（快起慢收），4s 场景 1.2s 后基本静止；" +
      "3) 推镜幅度 1.0 到 1.05 起步（>1.15 文字开始糊、边缘裁切明显）。",
  },
  {
    id: "split-screen",
    name: "分屏对比",
    tags: ["visual", "split", "compare", "layout"],
    description: "左右分屏对比：中缝分隔，两侧标题从外沿滑向中缝错拍入场",
    code: `// 适用场景时长 ≥4s：两块 950px + 6px 中缝；两侧标题从外沿滑向中缝（相向入场）
s.rect("left-bg", { width: 950, height: 1080, fill: "#0f172a", at: { x: 475, y: 540 } });
s.rect("right-bg", { width: 950, height: 1080, fill: "#1a1030", at: { x: 1445, y: 540 } });
s.rect("divider", { width: 6, height: 1080, fill: "#f8faf4", opacity: 0.9, at: { x: 960, y: 540 } });
s.text("left-title", "BEFORE", { size: 92, weight: 800, color: "#f8fafc",
  at: { x: 475, y: "44%" }, in: 0.2, enter: { effect: "slide-right", duration: 0.5, params: { distance: 120 } } });
s.text("right-title", "AFTER", { size: 92, weight: 800, color: "#f59e0b",
  at: { x: 1445, y: "44%" }, in: 0.5, enter: { effect: "slide-left", duration: 0.5, params: { distance: 120 } } });
s.text("left-sub", "manual cuts", { size: 44, color: "#8b8ba7",
  at: { x: 475, y: "58%" }, in: 0.7, enter: { effect: "fade", duration: 0.4 } });
s.text("right-sub", "agent loop", { size: 44, color: "#fbbf24",
  at: { x: 1445, y: "58%" }, in: 1.0, enter: { effect: "fade", duration: 0.4 } });
s.beat("both-in", { at: 1.4, description: "两侧齐整" });`,
    notes:
      "1) 方向词陷阱（源码）：slide-right=自左向右移入、slide-left=自右向左移入——别按直觉当「向右/向左滑走」；" +
      "2) rect 的 at 是中心：left-bg 中心 x=475 的 950px 块恰好占 [0,950]，中缝 6px，right-bg 占 [970,1920]；" +
      "3) 两侧错拍 0.3s（left 先 right 后）形成「发问-回答」的观看顺序。",
  },
  {
    id: "vignette-pulse",
    name: "暗角",
    tags: ["visual", "vignette", "blur", "corners"],
    description: "四角暗角：背景色系深色大模糊椭圆压角，中心保持亮，声明序在上",
    code: `// 适用场景时长 ≥4s：内容先声明、暗角后声明（压在内容上）；深色大模糊椭圆坐四角
s.text("center", "FOCUS", { size: 100, weight: 800, letterSpacing: 12, color: "#f8fafc",
  at: { x: "50%", y: "48%" }, enter: { effect: "blur-in", duration: 0.6, params: { blur: 16 } } });
s.beat("vignette-on", { at: 0.6, description: "暗角就位" });
const CORNERS = [{ x: 60, y: 60 }, { x: 1860, y: 60 }, { x: 60, y: 1020 }, { x: 1860, y: 1020 }];
CORNERS.forEach((c, i) => {
  s.ellipse("corner-" + i, { width: 900, height: 900, fill: "#05050f", opacity: 0.75, blur: 160,
    at: { x: c.x, y: c.y }, in: 0.2 + i * 0.08, enter: { effect: "fade", duration: 0.5 } });
});`,
    notes:
      "1) v1 没有暗角滤镜——用背景色系更深色（#05050f 对 #0a0a12）的大模糊椭圆模拟；" +
      "2) 暗角必须声明在内容之后（painter's order），声明在先会被内容盖住，技巧失效；" +
      "3) ellipse 的 blur 是高斯模糊不是发光——想要光晕用亮色 + blur + 低 opacity（见 spotlight-follow）。",
  },
  {
    id: "spotlight-follow",
    name: "聚光灯巡览",
    tags: ["visual", "spotlight", "scrim", "tour"],
    description: "聚光灯巡览：全屏暗罩 + 亮椭圆叠加挖亮，in/out 窗口逐点巡视",
    code: `// 适用场景时长 ≥4s：暗罩常驻，亮椭圆 1s/点窗口巡视（v1 无真遮罩挖洞——叠加亮化是等效做法）
s.rect("scrim", { width: 1920, height: 1080, fill: "#05050f", opacity: 0.66,
  at: { x: 960, y: 540 }, enter: { effect: "fade", duration: 0.4 } });
const SPOTS = [{ x: 480, y: 420 }, { x: 960, y: 620 }, { x: 1440, y: 420 }];
SPOTS.forEach((p, i) => {
  const start = 0.4 + i * 1.0;
  s.beat("focus-" + i, { at: start, description: "聚光要点 " + (i + 1) });
  s.ellipse("spot-" + i, { width: 560, height: 560, fill: "#f8faf4", opacity: 0.16, blur: 70,
    at: { x: p.x, y: p.y }, in: start, out: start + 1.0,
    enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutCubic" } });
  s.text("point-" + i, "POINT " + (i + 1), { size: 54, weight: 700, color: "#f8fafc",
    at: { x: p.x, y: p.y }, in: start + 0.15, out: start + 1.0, enter: { effect: "fade", duration: 0.3 } });
});`,
    notes:
      "1) 亮椭圆是「叠加提亮」不是挖洞——真挖洞用背景色块盖（progress-bar-grow 遮罩思路反用）；" +
      "2) 巡览节奏 1s/点 + 0.15s 文字延迟——先看到光再读到字，符合注意力顺序；" +
      "3) 每点窗口 [start, start+1.0) 首尾相接，光斑 scale-pop 入场自带「打开手电」感。",
  },
  {
    id: "grid-features",
    name: "特性网格",
    tags: ["visual", "grid", "cards", "features"],
    description: "特性网格 2×2 卡片对角错拍入场，0.35 秒步进，编号次第点亮",
    code: `// 适用场景时长 ≥5s：2×2 卡片（520 宽 / 300 高），对角顺序 0.35s 步进入场
const FEATURES = [
  { name: "f1", title: "Compile", x: 660, y: 400 },
  { name: "f2", title: "Preview", x: 1260, y: 400 },
  { name: "f3", title: "Test", x: 660, y: 780 },
  { name: "f4", title: "Ship", x: 1260, y: 780 },
];
FEATURES.forEach((f, i) => {
  const t = 0.3 + i * 0.35;               // 卡片入场时刻（slide 系→错拍写 in）
  s.rect("card-" + f.name, { width: 520, height: 300, fill: "#12122a", radius: 18,
    at: { x: f.x, y: f.y }, in: t,
    enter: { effect: "slide-up", duration: 0.5, easing: "easeOutCubic", params: { distance: 70 } } });
  s.text("title-" + f.name, f.title, { size: 64, weight: 800, color: "#f8fafc",
    at: { x: f.x, y: f.y - 40 }, in: t + 0.1, enter: { effect: "fade", duration: 0.4 } });
  s.text("num-" + f.name, "0" + (i + 1), { size: 34, weight: 700, color: "#22d3ee",
    at: { x: f.x - 200, y: f.y - 100 }, in: t + 0.15, enter: { effect: "fade", duration: 0.3 } });
});
s.beat("grid-done", { at: 1.95, description: "四卡齐整（0.3+3*0.35+0.6）" });`,
    notes:
      "1) 卡内元素（标题/编号）跟卡同 in 窗口 +0.1~0.15s 微延迟，别单独设 beat；" +
      "2) 2×2 限制在 4 张卡——6 格以上改两屏轮换（认知负载）；" +
      "3) 步进 0.35s + slide-up 70px：卡片群比列表需要更明显的「块感」位移。",
  },

  // ------------------------------------------------ 转场（4，整程序形态）
  {
    id: "crossfade-scene",
    name: "交叉溶接",
    tags: ["transition", "crossfade", "dissolve"],
    description: "交叉溶接：后场景提前 0.6 秒渐显叠在前场景上，氛围延续换挡",
    code: `// 整程序片段：粘贴进 defineVideo 的 builder 回调；后场景自带背景与内容
v.scene("old", { duration: 3 }, (s) => {
  s.text("title", "Draft cut", { size: 90, weight: 700, color: "#8b8ba7",
    at: { x: "50%", y: "48%" }, enter: { effect: "fade", duration: 0.4 } });
});
v.scene("new", { duration: 3 }, (s) => {
  s.text("title", "Final cut", { size: 90, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "48%" }, enter: { effect: "fade", duration: 0.4, delay: 0.6 } });
  s.rect("bar", { width: 420, height: 8, fill: "#22d3ee", radius: 4,
    at: { x: 960, y: 620 }, in: 0.6, enter: { effect: "fade", duration: 0.5 } });
});
v.transition("crossfade", { duration: 0.6, between: ["old", "new"] });`,
    notes:
      "1) crossfade 使后场景 start=前场景 end−0.6（重叠吃时长）：3+3−0.6=5.4s 总长；" +
      "2) duration 必须 < 两侧场景时长（构建期 DSL_INVALID_TRANSITION 拦截）；" +
      "3) 后场景背景以整幅 rect（layerId 后缀 \":bg\"）按 progress 渐显——后场景务必声明自己的 background 与首内容。",
  },
  {
    id: "slide-handoff",
    name: "滑动交接",
    tags: ["transition", "slide", "handoff", "conveyor"],
    description: "滑动交接：A 尾元素向左退场跨 cut，B 头元素自右入场，观感连续左移",
    code: `// 整程序片段：cut 不重叠，连续感来自「同向同速」——A 出 B 入都朝左
v.scene("a", { duration: 2.5 }, (s) => {
  s.text("a-line", "Chapter 1", { size: 110, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "48%" }, enter: { effect: "fade", duration: 0.4 },
    exit: { effect: "slide-right", duration: 0.35, easing: "easeInQuad", params: { distance: 500 } } });
});
v.scene("b", { duration: 2.5 }, (s) => {
  s.text("b-line", "Chapter 2", { size: 110, weight: 800, color: "#22d3ee",
    at: { x: "50%", y: "48%" }, in: 0,
    enter: { effect: "slide-left", duration: 0.4, easing: "easeOutCubic", params: { distance: 500 } } });
});
v.transition("cut", { between: ["a", "b"] });`,
    notes:
      "1) 语义对照（源码）：exit slide-right=向左退场（offsetX 从 0 到 −distance）；enter slide-left=自右移入（offsetX 从 +distance 到 0）——同向组合成传送带；" +
      "2) cut 边界前后各留 0.35-0.4s 的出入窗口，速度感（distance/时长）两侧要一致；" +
      "3) 若改 crossfade，出入动画会与透明度叠加，观感变「溶接」而非「传递」。",
  },
  {
    id: "flash-cut",
    name: "闪光硬切",
    tags: ["transition", "cut", "flash", "impact"],
    description: "闪光硬切：B 场景开头 0.12 秒全屏白闪模拟爆闪，下拍即炸",
    code: `// 整程序片段：白闪=B 场景第一个图层（全屏 rect + 0.12s 窗口 + fade 退场）
v.scene("a", { duration: 2 }, (s) => {
  s.text("tease", "one more thing", { size: 80, weight: 700, color: "#8b8ba7",
    at: { x: "50%", y: "50%" }, enter: { effect: "fade", duration: 0.4 },
    exit: { effect: "fade", duration: 0.2 } });
});
v.scene("b", { duration: 2 }, (s) => {
  s.rect("flash", { width: 1920, height: 1080, fill: "#f8faf4",
    at: { x: 960, y: 540 }, in: 0, out: 0.12,
    exit: { effect: "fade", duration: 0.12, easing: "linear" } });
  s.beat("drop", { at: 0.05, description: "爆闪后即炸" });
  s.text("drop", "NOW SHIPPING", { size: 130, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: "50%", y: "50%" }, in: 0.05, enter: { effect: "scale-pop", duration: 0.35, easing: "easeOutExpo" } });
});
v.transition("cut", { between: ["a", "b"] });`,
    notes:
      "1) 白闪窗口别超 0.15s（光敏风险 + 廉价感）；0.12s 约 4 帧（30fps）；" +
      "2) 真单帧闪写 out: 1/30（约 0.033s）——窗口 [in,out) 半开，out 当帧已不可见；" +
      "3) flash 是 B 的第一个图层（声明最底也无妨——全屏不透明盖一切，后续内容声明在它上面）。",
  },
  {
    id: "dip-to-black",
    name: "黑场沉入",
    tags: ["transition", "fade-black", "dip", "audio"],
    description: "黑场沉入：fade-black 前场景压黑、后场景浮起，配乐淡入淡出收束",
    code: `// 整程序片段：fade-black = 经过黑场的换挡（crossfade 是互溶）；配乐同窗淡出淡入
v.scene("a", { duration: 3, background: "#111827" }, (s) => {
  s.text("a-title", "The problem", { size: 100, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "48%" }, enter: { effect: "blur-up", duration: 0.6 } });
});
v.scene("b", { duration: 3, background: "#05070d" }, (s) => {
  s.text("b-title", "The fix", { size: 100, weight: 800, color: "#22d3ee",
    at: { x: "50%", y: "48%" }, enter: { effect: "blur-in", duration: 0.6, delay: 0.5 } });
});
v.transition("fade-black", { duration: 0.5, between: ["a", "b"] });
v.audio("bgm", "assets/audio/strings.mp3", { volume: 0.7, fadeIn: 0.8, fadeOut: 1.0 });`,
    notes:
      "1) fade-black 语义（源码）：前场景整体 ×(1−progress) 压黑（含其背景 rect）、后场景 ×progress 浮起；" +
      "2) v.audio 挂在 v 上（顶层、非场景内）；fadeIn/fadeOut 是时长秒数不是目标点；" +
      "3) 0.4-0.6s 是「呼吸」档，>1s 变拖沓；章节断点比信息换挡更适合 dip。",
  },

  // ------------------------------------------------ 结尾（4）
  {
    id: "cta-end-card",
    name: "CTA 尾卡",
    tags: ["ending", "cta", "card", "still"],
    description: "CTA 尾卡：三行信息 0.6 秒内落定，随后至少 1 秒全静止收尾",
    code: `// 适用场景时长 ≥4s：落定要快（0.6s 内），静止要够（≥1s）——结尾纪律
s.rect("card", { width: 1100, height: 520, fill: "#12122a", radius: 24,
  at: { x: 960, y: 540 }, enter: { effect: "fade", duration: 0.4 } });
s.text("headline", "Start building today", { size: 84, weight: 800, color: "#f8fafc",
  at: { x: 960, y: 430 }, in: 0.1, enter: { effect: "slide-up", duration: 0.4, params: { distance: 40 } } });
s.text("cta", "videoos.dev - free tier", { size: 56, weight: 700, color: "#22d3ee",
  at: { x: 960, y: 560 }, in: 0.25, enter: { effect: "fade", duration: 0.3 } });
s.text("legal", "No card required - cancel anytime", { size: 32, color: "#8b8ba7",
  at: { x: 960, y: 660 }, in: 0.35, enter: { effect: "fade", duration: 0.3 } });
s.beat("still", { at: 1.0, description: "进入静止（≥1s）" });`,
    notes:
      "1) 结尾静止 ≥0.8s（QA：60% 时长后不再有新入场，用 toHaveBeat 锚 still）；" +
      "2) CTA 文案禁编造链接/价格——占位符或用户给的原文；" +
      "3) 三行信息字号 84/56/32 递减，视觉权重集中在动作句。",
  },
  {
    id: "freeze-fade-out",
    name: "定格淡出",
    tags: ["ending", "freeze", "fade", "outro"],
    description: "定格淡出：内容定住不动，最后 0.5 秒集体 fade 退场优雅收尾",
    code: `// 适用场景时长 4s：OUT 跟场景时长走——全体层同 out 同 exit，同拍一起散场
const OUT = 4;                             // = 场景时长；换场景时长记得同步改
s.ellipse("halo", { width: 1000, height: 640, fill: "#f59e0b", opacity: 0.12, blur: 120,
  at: { x: "50%", y: "46%" }, out: OUT, exit: { effect: "fade", duration: 0.5 } });
s.text("headline", "SHIP CONF", { size: 120, weight: 800, letterSpacing: 6, color: "#f8fafc",
  at: { x: "50%", y: "44%" }, enter: { effect: "blur-up", duration: 0.5 },
  out: OUT, exit: { effect: "fade", duration: 0.5 } });
s.text("date", "2026-06-06", { size: 48, color: "#7dd3fc",
  at: { x: "50%", y: "58%" }, in: 0.3, enter: { effect: "fade", duration: 0.4 },
  out: OUT, exit: { effect: "fade", duration: 0.5 } });
s.beat("freeze", { at: 1.0, description: "定格开始" });
s.beat("fade-out", { at: 3.5, description: "集体淡出（OUT−0.5）" });`,
    notes:
      "1) 集体退场=所有层同 out + 同 exit duration/delay（exit 起点统一在 OUT−0.5）；" +
      "2) fade 完最后一帧是纯背景色——再往后接场景就是干净交接，或让渲染结束在黑场；" +
      "3) 别给结尾加 slide 退场——方向性运动会把视线带出画面，fade 才是「落幕」。",
  },
  {
    id: "qr-panel",
    name: "二维码面板",
    tags: ["ending", "qr", "panel", "image"],
    description: "二维码收尾面板：QR 图 scale-pop 弹入 + 行动句并排，长静止可扫",
    code: `// 适用场景时长 ≥4s：浅底深字反差面板 + QR 图双声明宽高 + 长静止给扫码时间
s.rect("panel", { width: 1000, height: 560, fill: "#f8faf4", radius: 24,
  at: { x: 960, y: 540 }, enter: { effect: "fade", duration: 0.4 } });
s.image("qr", "assets/images/qr.png", { width: 420, height: 420, radius: 12,
  at: { x: 700, y: 540 }, in: 0.15, enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutBack" } });
s.text("scan-line", "Scan to watch", { size: 60, weight: 800, color: "#0a0a12",
  at: { x: 1210, y: 470 }, in: 0.3, enter: { effect: "fade", duration: 0.4 } });
s.text("scan-sub", "full demo - 90 seconds", { size: 38, color: "#3f3f5a",
  at: { x: 1210, y: 560 }, in: 0.4, enter: { effect: "fade", duration: 0.4 } });
s.beat("qr-still", { at: 1.0, description: "静止收尾（扫码窗口）" });`,
    notes:
      "1) QR 必须是真实生成的码（asset.add 写入真图）——禁占位假码/编造短链；" +
      "2) image 不声明 width/height 会默认整画布——QR 图必须双声明保住方形；" +
      "3) 浅底面板上文字用深色（#0a0a12/#3f3f5a）——默认白字会在浅底上消失。",
  },
  {
    id: "logo-lockup-still",
    name: "标志定版",
    tags: ["ending", "logo", "lockup", "still"],
    description: "标志组合定版：图形与字标一次成型，静止收尾，尾帧可当封面",
    code: `// 适用场景时长 ≥3s：图形（圆底+字母）一次弹成，字标自左靠拢，尾帧全静止
s.ellipse("mark-bg", { width: 300, height: 300, fill: "#6d28d9", at: { x: 760, y: 480 },
  enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutBack" } });
s.text("mark-glyph", "V", { size: 150, weight: 800, color: "#f8fafc",
  at: { x: 760, y: 480 }, in: 0.05, enter: { effect: "fade", duration: 0.25 } });
s.text("wordmark", "VideoOS", { size: 110, weight: 800, letterSpacing: 4, color: "#f8fafc",
  at: { x: 1180, y: 480 }, in: 0.15, enter: { effect: "slide-right", duration: 0.4, params: { distance: 90 } } });
s.text("tagline", "agent-native video", { size: 40, color: "#8b8ba7",
  at: { x: 960, y: 650 }, in: 0.4, enter: { effect: "fade", duration: 0.4 } });
s.beat("lockup-still", { at: 0.9, description: "全部落定（尾帧=封面帧）" });`,
    notes:
      "1) slide-right=自左向右移入——字标「向图形靠拢」的方向感（语义见 effects 主题）；" +
      "2) mark-bg 右缘 910、wordmark 左缘约 930（估宽公式 7×110×0.62+6×4≈501，中心 1180），紧凑间隙 ≈ 20px；" +
      "3) 尾帧静止可截帧当封面/缩略图——这也是 render.preview 的必查帧。",
  },
];

// ---------------------------------------------------------------- DSL 分主题速查

/** markdown 代码围栏（模板字面量里逐个转义太噪，提取常量插值） */
const F = "```";

/** 单个 DSL 速查主题（content ≤3500 字符，密集表格优先） */
export interface DslTopic {
  /** 主题键（= Record 键；dsl.reference 的 available 列表序） */
  key: string;
  /** 中文标题（搜索/展示用） */
  title: string;
  /** 别名（大小写不敏感精确匹配，键之外的第二入口） */
  aliases: string[];
  /** markdown 正文 */
  content: string;
  /** 相关主题键（必为合法键） */
  related: string[];
}

export const DSL_TOPICS: Record<string, DslTopic> = {
  builder: {
    key: "builder",
    title: "构建器与全量 API",
    aliases: ["api", "dsl", "definevideo", "define-video", "scene-builder"],
    related: ["text", "effects", "timing", "workflow"],
    content: `defineVideo(meta, builder) 全量入口（默认 meta：1920x1080 / fps 30 / background #0a0a12 / seed 42）：

${F}ts
defineVideo({ title: "demo" }, (v) => {
  v.scene("intro", { duration: 4, background: "#0a0a12" }, (s) => {
    s.beat("land", { at: 0, description: "锚点" });
    s.text("title", "Hello", { size: 96, at: { x: "50%", y: "40%" }, enter: { effect: "fade", duration: 0.5 } });
    s.rect("bar", { width: 300, height: 6, fill: "#22d3ee", at: { x: "50%", y: "55%" } });
    s.ellipse("halo", { width: 600, height: 400, fill: "#6d28d9", opacity: 0.2, blur: 90, at: { x: "50%", y: "42%" } });
    s.image("logo", "assets/images/logo.png", { width: 200, height: 200 });
    s.camera("push-in", { from: 1.0, to: 1.06 });   // 每场景至多一次
  });
  v.transition("crossfade", { duration: 0.5, between: ["intro", "outro"] }); // 仅相邻场景对
  v.audio("bgm", "assets/audio/bgm.mp3", { volume: 0.8, fadeIn: 1 });        // 挂 v 上（顶层，非场景内）
});
${F}

SceneBuilder 方法：text(name, content, opts?) / rect(name, {width,height,fill,radius?,blur?}) / ellipse(name, {width,height,fill,blur?}) / image(name, src, {width?,height?,radius?,blur?}) / camera(type, params?) / beat(name, {at, description?})。VideoBuilder：scene(name, {duration, background?}, build) / transition(type, {duration?, between:[a,b]}) / audio(name, src, {start?,volume?,fadeIn?,fadeOut?,loop?})。

v1 没有（别找，附等效做法）：
- s.group / v.output —— 不存在；组合=多层同 at
- z-index —— 层级=声明序（painter's order，后声明绘制在上）
- 遮罩原语 —— 背景/场景色 rect 声明在目标层之后盖上（进度条生长、柱图基线都靠它）
- loop 动画 —— AnimInput 只有 enter/exit（内部 AST 有 loop 但 DSL 不暴露）；脉冲=同位短窗口堆叠（pattern.search: pulse-loop）
- 多行文本 —— 单行绘制；多行=拆层 y 阶梯
- 独立 x/y 缩放 —— scale 均匀（文本只认 scale.x）
- 图层内动画曲线复用 / 关键帧 —— 只有 enter + exit 两个动画槽

跨场景「演化」（变灰/放大/换数据）：v1 无属性补间——新场景重声明同几何改属性 + crossfade，就是动画。

校验：builder 期即抛 DslError（DSL_*）；名称须匹配 ^[Unicode 字母或数字][字母数字_-]*$（无空格）；场景/音频名全局唯一，图层/节拍名场景内唯一，layer id=layer_场景_层名 全局唯一（拼下划线会撞 DSL_DUPLICATE_ID）。`,
  },
  text: {
    key: "text",
    title: "文字层",
    aliases: ["s.text", "typography", "font", "fonts"],
    related: ["effects", "geometry", "builder"],
    content: `s.text(name, content, opts?) 选项全表（types.ts 实读）：

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| size | number | 64 | 字号 px |
| font | string | "sans-serif" | 族名（Linux 渲染为 DejaVu Sans；自定义字体=文件名去扩展名） |
| weight | number | 400 | CSS 字重（700/800 常用） |
| color | string | "#ffffff" | 仅 #rgb/#rrggbb/#rrggbbaa |
| align | "left"/"center"/"right" | "center" | 决定 at.x 锚点含义（见引擎事实 2） |
| letterSpacing | number | 0 | 每字符后追加 px（宽度约 +(len−1)×ls） |
| lineHeight | number | 1.2 | 倍数；单行下只影响 wipe 裁剪盒高度 |
| maxWidth | number | 无 | 溢出检查边界（OVERFLOW_RISK 诊断与 noTextOverflow 断言的依据；不做自动换行） |

公共项（所有层共享）：at / in / out / opacity / scale / rotation / enter / exit。

引擎事实（renderer 源码实读，v1）：
1) 单行绘制：content 换行符不生效。多行=拆多个 text 层做 y 阶梯（一行约 size×1.3px）。
2) at.x 含义随 align（canvas textAlign 语义）：left=左边缘、center=水平中心（默认）、right=右边缘；at.y 恒为垂直中点（textBaseline=middle）。做左对齐版式时把 at.x 当左边缘排，别再套居中直觉。
3) typewriter / wipe 仅 text 层可表达；上在 rect/ellipse 会得 EFFECT_UNSUPPORTED 警告且动画被忽略。
4) 宽度估算启发式：引擎（溢出诊断与 wipe 裁剪盒）用 width ≈ chars × size × 0.62（不含 letterSpacing）；排版几何再自行补 (chars−1) × letterSpacing。算下划线/遮罩几何用它。
5) typewriter 进行中 toContainText 只见前缀——全文断言放在 in+delay+duration 之后。

${F}ts
s.text("title", "SHIP IT", { size: 120, weight: 800, letterSpacing: 6,
  at: { x: "50%", y: "40%" }, enter: { effect: "typewriter", duration: 1.0, easing: "linear" } });
s.text("sub", "from agent to mp4", { size: 44, at: { x: "50%", y: "56%" },
  in: 1.2, enter: { effect: "fade", duration: 0.5 } });
${F}

排版纪律：主标题 96-170px、正文 40-64px、注释 28-36px；同级信息同字号；1 秒钩子=主文字 30 帧内可读。`,
  },
  effects: {
    key: "effects",
    title: "动画效果与缓动",
    aliases: ["effect", "animation", "animations", "enter", "exit", "easing", "easings"],
    related: ["timing", "text", "camera"],
    content: `enter/exit: { effect, duration=0.5, delay=0, easing="easeOutCubic", params? }（窗口语义见 timing；exit 从 out−delay−duration 开始，e 由 1→0 原路返回）

效果全表（VIDEO_EFFECTS，frame-plan.ts 逐条实读；方向词=入场路径）：

| effect | 行为（入场时） | params |
| --- | --- | --- |
| fade | opacity ×e | — |
| slide-up | 自下方上浮（offsetY += (1−e)·d） | distance=40 |
| slide-down | 自上方下落（offsetY −= (1−e)·d） | distance=40 |
| slide-left | 自右侧向左移入（offsetX += (1−e)·d） | distance=40 |
| slide-right | 自左侧向右移入（offsetX −= (1−e)·d） | distance=40 |
| blur-up | 上浮+失焦+淡入三合一 | blur=12, distance=40 |
| blur-in | 原地聚焦+淡入（不位移） | blur=12 |
| scale-pop | 缩放 0.6→1.0（无过冲）+ opacity 双速爬升 min(1, e×2) | — |
| typewriter | 仅 text：可见字符 ceil(len·e) | — |
| wipe | 仅 text：左→右揭示（裁剪盒宽=naturalWidth·e） | — |

关键事实：
1) slide-* 不动 opacity——滑行全程可读；也因此「未入场」态图层仍画在偏移处，slide 系错拍用 in 窗口控，fade/scale-pop 系才可用 delay。
2) exit 反向重放：exit slide-down=向上升离、exit slide-up=向下沉离。翻牌=exit slide-down + enter slide-up（整版上滚）；exit slide-up + enter slide-up 会同曲线重叠（经典反模式）。
3) typewriter/wipe 上非 text 层 → EFFECT_UNSUPPORTED 警告 + 动画忽略（矩形「擦出」用背景色遮罩滑走）。
4) 想要弹跳过冲：easing 换 easeOutBack/spring（过冲来自 easing，scale-pop 本体不过冲）。

合法 easing（easing.ts 全量 11 个）：linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic, easeOutExpo, easeOutBack, spring, bounce
- 缺省 easeOutCubic（快起缓收最百搭）；机械感/打字机用 linear；柱子飞升 easeOutExpo；俏皮弹跳 easeOutBack、spring（输出可>1——精确数据图禁用）；bounce 落地弹（不超过目标值，柱图安全）。
- spring 可带参数（与效果参数共用同一 params 对象）：enter: { effect: "slide-up", easing: "spring", params: { stiffness: 120, damping: 8, distance: 60 } }（默认 stiffness 100 / damping 10）。`,
  },
  camera: {
    key: "camera",
    title: "相机",
    aliases: ["zoom", "push-in", "pull-out", "pan", "cameras"],
    related: ["transition", "geometry", "builder"],
    content: `s.camera(type, params) — 场景级（每场景至多一次，第二次抛 DSL_DUPLICATE_CAMERA），作用于整帧全部图层、以画面中心为原点、全场景时长按 easeOutCubic 推进：

| type | 参数（默认） | 语义 |
| --- | --- | --- |
| static | — | 恒等（缺省行为，可不声明） |
| push-in | from(1), to(1.05) | 放大（景别推近） |
| pull-out | from(1.05), to(1) | 缩小（景别拉远） |
| pan | fromX/toX/fromY/toY（均 0） | 平移 px（正 translateX=画面内容右移） |

${F}ts
s.camera("push-in", { from: 1.0, to: 1.06 });
s.camera("pan", { fromX: -60, toX: 60 });   // 横移巡视
${F}

事实与纪律：
1) 相机推整帧——字幕/水印会被一起推走。想要「图动字不动」：拆两场景（图场景相机 + cut 到字幕场景）。
2) easeOutCubic 全场景推进：前 30% 时间就完成大半位移——4s 场景约 1.2s 后基本静止，别指望全程匀速。
3) 缩放无硬钳制（from/to 任意正数），但 push-in 目标 >1.15 文字发糊、边缘裁切明显；<1 会露出背景色边框（画面缩小）。pan 建议在 ±10% 画布（±200px 横 / ±110px 竖）内。
4) 过渡重叠段沿用主（先启动）场景的相机（两场景图层同帧绘制，但相机只取主场景）。
5) 相机是「场景属性」不是图层——不能只推某一层。单层放大=跨场景重声明该层 scale 更大的版本 + crossfade。`,
  },
  transition: {
    key: "transition",
    title: "场景过渡",
    aliases: ["transitions", "crossfade", "fade-black", "cut"],
    related: ["timing", "builder", "camera"],
    content: `v.transition(type, { duration = 0.5, between: [前场景, 后场景] }) — 仅相邻场景对（声明序），每对至多一条：

| type | 语义（timing.ts + frame-plan.ts 实读） |
| --- | --- |
| cut | 硬切：不重叠，后场景 start = 前场景 end |
| crossfade | 互溶：后场景提前 duration 启动、整体 ×progress 渐显叠在前场景上（其背景以整幅 rect 渐显，layerId 后缀 ":bg"） |
| fade-black | 黑场：同样重叠；前场景 ×(1−progress) 压黑、后场景 ×progress 浮起 |

规则：
- duration 必须 < 两侧场景时长：构建期 DSL_INVALID_TRANSITION 拦截；编译期 TRANSITION_TOO_LONG（start 被钳到前场景 start）
- between 非相邻 → DSL_NON_ADJACENT_TRANSITION（构建期抛）
- 同对重复 → DSL_DUPLICATE_TRANSITION；不匹配任何相邻对 → 编译警告 TRANSITION_UNMATCHED
- 总时长 = 末场景 end − 首场景 start：重叠吃时长（A 3s + B 3s + crossfade 0.6s = 5.4s）
- 重叠段相机沿用主（先启动）场景；两场景图层同时绘制（后场景内容声明序在其背景 rect 之上）

${F}ts
v.transition("crossfade", { duration: 0.5, between: ["intro", "features"] });
${F}

选型：信息换挡用 cut（干净）；氛围延续用 crossfade 0.4-0.6s；情绪断点/章节感用 fade-black 0.4-0.6s。过渡叠加不存在——每对场景一条；卡点瞬发力首选硬 cut，crossfade 会稀释下拍。`,
  },
  timing: {
    key: "timing",
    title: "时间与节奏",
    aliases: ["time", "window", "windows", "in-out", "frames"],
    related: ["transition", "effects", "workflow"],
    content: `时间单位：图层/节拍用场景内秒数（audio.start 是全局秒）；fps 默认 30；帧号 = round(秒 × fps)（1s=30 帧、0.5s=15 帧、3.5s=105 帧）。

图层窗口（半开区间 [in, out)，frame-plan 实测）：
- in 默认 0，必须 < scene.duration（等于也抛 DSL_INVALID_TIME）
- out 默认 scene.duration，必须 > in 且 ≤ scene.duration
- 边界帧：旧层 out 当帧即消失——QA 断言旧内容要卡在边界前一帧

动画窗：
- enter：从 in+delay 开始，in+delay+duration 完成（p=(t−(in+delay))/duration 截到 [0,1]）
- exit：止于 out；起点 = out − delay − duration；e 从 1→0（入场路径反向重放）
- delay 的作用点：enter 推迟起点；exit 推迟完成点（起点=out−delay−duration）

场景时序（timing.ts）：
- 按声明序播放；cut/未声明 → 后场景 start = 前场景 end（不重叠）
- crossfade/fade-black → 后场景 start = 前场景 end − transition.duration（重叠段两场景同帧绘制）
- 总时长 = 末场景 end − 首场景 start；totalFrames = round(总时长 × fps)
- beat.at ∈ [0, duration]（场景内秒，可等于 duration）

节奏速查（30fps）：1 秒钩子=30 帧内主信息可读；stagger 步进 0.3-0.45s；120BPM 一拍 0.5s=15 帧、半拍 0.25s（7.5 帧非整数——半拍事件的帧断言取 7 或 8 并注明）；结尾静止 ≥0.8s=24 帧；typewriter 时长 ≈ 字符数 × 0.04-0.06s/字。

纪律：一切事件时刻量化到节拍网格（整数秒或半拍），1.37s 这类漂移值会在音画同步上累积误差；QA 里把关键完成点写成 beat（toHaveBeat）而不是魔法帧号。`,
  },
  geometry: {
    key: "geometry",
    title: "几何与布局",
    aliases: ["position", "positions", "layout", "canvas", "safe-area", "anchor", "at"],
    related: ["text", "builder", "camera"],
    content: `坐标系：左上原点，x 向右、y 向下；画布默认 1920×1080（16:9）；竖屏项目 1080×1920（9:16）。

各层 at 的含义（全部是「层中心」，text 的 x 例外）：

| 层 | at 含义 |
| --- | --- |
| rect | 中心（绘制框 x=cx−w/2, y=cy−h/2；radius 圆角、blur 模糊） |
| ellipse | 中心（width/height 是直径，半径=直径/2） |
| image | 中心（不声明 width/height 默认整画布——必须双声明保宽高比） |
| text | at.y=垂直中点；at.x 随 align：left=左边缘 / center=水平中心 / right=右边缘 |

位置语法：number=绝对 px；"50%"=百分比字符串（引号必须，支持 "-10%" 负值=画布外）；可混用 { x: "50%", y: 88 }。rotation 绕层中心（度，anchor 固定 0.5,0.5）；scale 均匀缩放。

文本宽度估算（溢出诊断/wipe/几何排版同源公式）：width ≈ chars × size × 0.62 + (chars−1) × letterSpacing。

安全区（平台 UI 会盖住，内容让位）：
- 9:16 竖屏（1080×1920）：底部 20%（y>1536）被字幕/互动栏覆盖；左右 12%（≥130px）、顶部 14% 让边；主内容带 x∈["20%","80%"]、y∈["14%","80%"]
- 16:9（1920×1080）：底部 10%（y>972）留给字幕/台标——lower-thirds 条底边 ≤939px
- 关键信息放中心带，四边留 5-8% 呼吸

常用几何（1920×1080）：全屏 rect at { x: 960, y: 540 } 尺寸 1920×1080；居中两栏 x=480/1440；2×2 卡片 520 宽、y=400/780；标题带 y="40%"；底部条 y="88%"；竖屏改 1080×1920 后按比例重算（别直接抄 16:9 数值）。`,
  },
  diagnostics: {
    key: "diagnostics",
    title: "诊断码速查",
    aliases: ["diagnostic", "errors", "error-codes", "warnings", "codes"],
    related: ["workflow", "timing", "text"],
    content: `两类问题通道：

A) 构建期 DslError（defineVideo 回调内即抛、编译不发生——修 DSL 代码本身）：
DSL_INVALID_NAME（名称须 Unicode 字母/数字开头 + 字母/数字/_/-，无空格）/ DSL_INVALID_COLOR（仅 #rgb #rrggbb #rrggbbaa）/ DSL_INVALID_POSITION（number 或 "50%" 引号字符串）/ DSL_INVALID_TIME（in < duration；out > in 且 ≤ duration）/ DSL_INVALID_ANIMATION / DSL_UNKNOWN_EFFECT / DSL_UNKNOWN_EASING / DSL_UNKNOWN_CAMERA / DSL_UNKNOWN_TRANSITION / DSL_DUPLICATE_SCENE / DSL_DUPLICATE_LAYER / DSL_DUPLICATE_BEAT / DSL_DUPLICATE_AUDIO / DSL_DUPLICATE_CAMERA（一景一相机）/ DSL_DUPLICATE_TRANSITION（一对场景一条）/ DSL_DUPLICATE_ID（layer_场景_层名 全局撞名）/ DSL_NON_ADJACENT_TRANSITION / DSL_INVALID_TRANSITION（时长须 < 两侧场景）/ DSL_EMPTY_VIDEO / DSL_INVALID_SCENE / DSL_INVALID_DURATION / DSL_INVALID_TEXT / DSL_INVALID_RECT / DSL_INVALID_ELLIPSE / DSL_INVALID_IMAGE / DSL_INVALID_AUDIO / DSL_INVALID_META / DSL_INVALID_TRANSFORM（opacity 出 [0,1]、scale/rotation 非法）/ DSL_INVALID_BEAT（at 越界或缺 options）/ DSL_INVALID_CAMERA（params 非数字对象）/ DSL_UNKNOWN_SCENE（transition 引用未声明场景）

B) 编译期 Diagnostic（不抛错；compile.run / compile.diagnostics 返回，带 scene/layer 定位）：

| code | 级别 | 原因 → 修法 |
| --- | --- | --- |
| NO_SCENES | error | 空 → 至少一个 v.scene |
| DUPLICATE_ID | error | 场景/图层/节拍/音频/资产 id 撞 → 改名 |
| INVALID_COLOR | error | 颜色串非法 → 换 #hex |
| INVALID_POSITION | error | at.x/y 类型错 → number 或 "50%" |
| INVALID_TIME_WINDOW | error | out ≤ in → 修窗口 |
| LAYER_BEYOND_SCENE | warning | 窗口超场景时长（渲染时被裁）→ out 收到 ≤ duration |
| OVERFLOW_RISK | warning | 估宽 chars×size×0.62 > maxWidth → 减字号/字数 |
| IMAGE_NO_SRC | warning | image 层无 src → 补 src 或删层 |
| UNKNOWN_EASING / UNKNOWN_EFFECT | warning | 回退 linear / 动画被忽略（builder 正常已前置拦截）→ 用合法名 |
| EFFECT_UNSUPPORTED | warning | typewriter/wipe 上非 text 层 → 换 fade/slide 或遮罩法 |
| UNUSED_ASSET | info | 注册资产未被引用 → 清理 |
| AUDIO_OUT_OF_RANGE | warning | 音频 start ≥ 总时长 → 移进时长内 |
| ASSET_MISSING | error | 文件不存在（assetRoot 提供时）→ 补文件/改 src |
| ASSET_ID_COLLISION | warning | 两个 src 清洗成同 id → 改文件名 |
| TRANSITION_TOO_LONG | error | 过渡 ≥ 场景时长（start 被钳）→ 缩 duration |
| TRANSITION_UNMATCHED | warning | between 不相邻/被更早声明覆盖 → 改 between |

error 级使编译 CLI 退出码 1，warning/info 不会。agent 门禁：compile.run 后 0 error 是硬条件，warning 也应清零再 render。`,
  },
  workflow: {
    key: "workflow",
    title: "代理工作流",
    aliases: ["loop", "agent-loop", "process", "how-to-work"],
    related: ["builder", "diagnostics", "timing"],
    content: `标准代理工作流（全部为已注册 VAP 工具名，按此顺序；禁发明工具名）：

1. storyboard.plan { intent, durationSeconds } → 骨架（简单视频可跳过直写 DSL）
2. 写 src/video.ts（defineVideo）——动效抄 pattern.search / pattern.get，API 疑问查 dsl.reference，品类方法读 skill.read
3. compile.run → 0 error 硬门禁；有诊断 → compile.diagnostics 看明细 → 改源码 → 再 compile.run
4. check.overflow（文本溢出）+ check.missingAssets（资产缺失）
5. render.preview { scene, beat } 逐关键帧检查（beat 是锚点；也可 render.range 看一段）
6. 写 tests/*.test.ts（@videoos/qa：describe/it/expect/frame/scene + toContainText/toBeBlack/noTextOverflow/toHaveBeat/toHaveLayers/durationBetween）→ test.run 全绿
7. render.final → 交付 MP4 路径

修复循环纪律：
- ≤3 轮；每轮只改一个变量（时长/字号/几何/时序其一），改前改后各 compile.run 对比诊断数
- 结构手术用 scene.modify / layer.modify（锚点编辑写回源码）；风险改动包 transaction.begin → 编译失败 transaction.rollback（源码回滚）→ 成功 transaction.commit
- 导航摸底：scene.list / scene.inspect / layer.inspect 先看再改；inspect.frame / diff.frames 看具体帧

铁律：
- 禁 Math.random / Date.now（破坏确定性渲染与缓存命中）；随机只用 defineVideo({ seed }) + createRng
- 禁编造数据/引文/日期/薪资——占位符优先，缺信息问用户
- 结尾静止 ≥0.8s；muted 也要成立（声音只是增强）
- 每个叙事事件打 beat（0.8-1.5s 一拍读感最好）——QA 与预览都以 beat 寻址`,
  },
};

/** 主题键序（available 列表与遍历顺序，稳定） */
export const DSL_TOPIC_KEYS: string[] = Object.keys(DSL_TOPICS);
