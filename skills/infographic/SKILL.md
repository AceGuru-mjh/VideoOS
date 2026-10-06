---
name: infographic
version: 0.1.0
description: 信息图版式——图标＋数字＋短句的网格编排与逐格揭示节奏，一屏一个论点，图标全部由 rect/ellipse 原语拼装（零资产）。
trigger: The user wants an infographic-style video - icon-and-caption grid cells, each cell revealing one fact with its number, building one argument screen by screen.
---

# Infographic

Goal: 信息图视频（1920x1080、30fps、8-14s）——「图标 + 数字 + 短句」组成的信息格，按格揭示、按屏立论：一屏一个论点，一格一个事实，格内三拍（图标 pop -> 数字数 -> 短句 fade）。
分工边界：infographic 管信息格的**版式与揭示节奏**；icon-grid 管**纯图标墙**（错峰入场与高亮游走，不带长文案）；data-dashboard 管看板数字叙事（hero -> duo -> trend）；本技能是三者的「带图版的版式家」。
零资产纪律：图标一律 rect/ellipse 原语拼装，不引外部图标字体与图片；数字与事实全部来自用户，缺了就问。

## Workflow

1. 收集四件事，缺了就问：
   - 论点句（每屏一个，<= 12 字，屏标题）；
   - 事实格清单（每格：数字 + 短句 <= 8 字 + 图标语汇，2-6 格/屏）；
   - 数字格式（照 kpi-countup 的格式表原样入层）；
   - 屏数（1-3 屏；每屏 3.5-5s，超预算砍格不砍屏）。
2. `storyboard.plan { intent: "infographic · <topic>", durationSeconds }` -> 屏 scene 序列，每屏一景。
   屏名 `screen-<n>`；每屏内部节奏固定：标题先落（1s 可读）-> 格逐个揭示 -> 屏尾 hold >= 0.8s。
3. 写 `src/video.ts`（Recipes）：
   - 格几何一次计算（格宽/间距/网格中心），同屏复用——格位漂移与 chart-race 的 slot 漂移同罪；
   - 图标层命名 `icon-<cell>`、数字层 `num-<cell>`、短句层 `cap-<cell>`——QA 按名寻址；
   - 数字层 `font: "monospace"`（kpi-countup 抖动规则）。
4. 图标拼装走原语速查表（下）；拼装纪律：2-5 个原语/图标、线感元素宽 >= 6px、一屏一个 accent 色。
   图标尺寸 <= 数字的 0.8 倍高——图标是格的锚，不是格的主角（主角是数字）。
5. `compile.run` -> 0 errors -> `check.overflow`——短句是 overflow 户（8 字 x 52px = 416px 格宽内安全；超 8 字先砍字）。
6. `render.preview` 两帧/屏：格揭示中段（错峰读得出波次）与屏尾定格（全部格齐、无新入场）。
   自查一眼「一屏一论点」：揭示完的屏能被一句话复述吗？不能就回 storyboard 砍格。
7. QA gates -> `test.run` -> repair loop <= 3（`scene.modify` 微调 delay；`transaction.rollback` 兜底）-> `render.final`，交付附屏数、格数与事实清单。

格内三拍合同（cell-local，每格照抄）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| icon（原语组） | 格 d + 0.0s | `scale-pop`（easeOutBack） | 0.4 | 格 d + 0.4s |
| num | 格 d + 0.2s | `typewriter`（easeOutCubic） | 1.0-1.2（位数表） | 格 d + 1.4s |
| cap | 格 d + 1.5s | `fade` | 0.4 | 格 d + 1.9s |
| 格间错峰 | - | - | - | d = 0.3s + i x 0.45s |

原语图标速查（rect = r / ellipse = e；全部画在 96x96 的图标框内，坐标为框内偏移）：

| 图标语汇 | 拼法 | 语义 |
| --- | --- | --- |
| 上升 | e 小圆点 + r 斜杆（rotation 45） | 增长 |
| 时钟 | e 圆盘 + r 双指针 | 耗时/时限 |
| 盾牌 | r 竖矩形（radius 大）+ e 小圆心 | 安全/可靠 |
| 对话 | r 圆角矩形 + e 三小点 | 反馈/沟通 |
| 闪电 | r 斜杆 x2（rotation 45/-45） | 快/爆点 |
| 堆叠 | r 三横条（等距） | 累计/清单 |

accent 纪律表：

| 元素 | 颜色 | 备注 |
| --- | --- | --- |
| 图标 | accent 或 #94a3b8 | 一屏一个 accent，图标不抢数字 |
| 数字 | #f8fafc | 主角永远是数字 |
| 短句 | #94a3b8 | 配角，52px 上下 |
| 格底板 | #12121f | radius 16，比背景亮一档 |

## Recipes

Recipe 1——2x2 信息格（标准屏）：标题先落，四格按 0.45s 错峰揭示，格内三拍。
格几何：格宽 560、格高 400、列间距 80、行间距 60，网格中心 (960, 590)：

```ts
const CELLS = [
  { x: "29%", y: "40%", icon: "bolt",  num: "1.9s",  cap: "seek latency" },
  { x: "71%", y: "40%", icon: "clock", num: "12,847", cap: "renders / wk" },
  { x: "29%", y: "72%", icon: "stack", num: "96",     cap: "scenes / proj" },
  { x: "71%", y: "72%", icon: "rise",  num: "+38%",   cap: "growth qoq" },
];
v.scene("screen-1", { duration: 4.8, background: "#0a0a12" }, (s) => {
  s.beat("title-in", { at: 0.2, description: "论点句 1s 可读" });
  s.beat("cells-settled", { at: 3.2, description: "末格三拍完成" });
  s.text("title", "WHY TEAMS SWITCH", { size: 56, weight: 800, letterSpacing: 3,
    color: "#f8fafc", at: { x: "50%", y: "16%" },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.2 } });
  for (const [i, c] of CELLS.entries()) {
    const d = 0.3 + i * 0.45;                          // 格间错峰：一波一格
    s.rect(`card-${i + 1}`, { width: 560, height: 400, fill: "#12121f", radius: 16,
      at: { x: c.x, y: c.y },
      enter: { effect: "slide-up", duration: 0.5, delay: d, easing: "easeOutCubic",
        params: { distance: 60 } } });
    s.ellipse(`icon-bg-${i + 1}`, { width: 96, height: 96, fill: "#22d3ee", opacity: 0.16,
      at: { x: c.x, y: parseFloat(c.y) - 100 },
      enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
    s.text(`num-${i + 1}`, c.num, { size: 96, weight: 800, font: "monospace",
      color: "#f8fafc", at: { x: c.x, y: c.y },
      enter: { effect: "typewriter", duration: 1.2, delay: d + 0.2, easing: "easeOutCubic" } });
    s.text(`cap-${i + 1}`, c.cap, { size: 40, color: "#94a3b8",
      at: { x: c.x, y: parseFloat(c.y) + 110 },
      enter: { effect: "fade", duration: 0.4, delay: d + 1.5 } });
  }
});
```

时序账：末格 d = 0.3 + 3 x 0.45 = 1.65s，三拍完成于 1.65 + 1.9 = 3.55s，屏尾 hold 1.25s——四格一屏的完整预算。
图标在本配方里是「发光圆底座 + 语汇」的抽象版；语汇原语拼装见 Recipe 3。

Recipe 2——中心大数字 + 四角支撑格（hub-and-spoke）：一个主事实居中先落，四个支撑格随后点亮。
用于「一个大数字撑论点」的屏——数字是论点，四格是论据：

```ts
v.scene("screen-2", { duration: 4.4, background: "#0a0a12" }, (s) => {
  s.beat("hub", { at: 0.2, description: "主数字 1s 落地" });
  s.beat("spokes", { at: 1.6, description: "四角格逐个支撑" });
  s.ellipse("halo", { width: 900, height: 900, fill: "#22d3ee", opacity: 0.10, blur: 150,
    at: { x: "50%", y: "50%" } });                    // frame-0 ink
  s.text("hub-num", "99.98%", { size: 170, weight: 800, font: "monospace",
    color: "#f8fafc", at: { x: "50%", y: "46%" },
    enter: { effect: "typewriter", duration: 1.2, delay: 0.2, easing: "easeOutCubic" } });
  s.text("hub-cap", "uptime, trailing 90 days", { size: 40, color: "#94a3b8",
    at: { x: "50%", y: "62%" }, enter: { effect: "fade", duration: 0.4, delay: 1.5 } });
  const SPOKES = [
    { x: "16%", y: "22%", num: "3",  cap: "regions" },
    { x: "84%", y: "22%", num: "11", cap: "9s of nines" },
    { x: "16%", y: "78%", num: "0",  cap: "data loss" },
    { x: "84%", y: "78%", num: "24/7", cap: "on-call" },
  ];
  for (const [i, p] of SPOKES.entries()) {
    const d = 1.6 + i * 0.35;                         // 支撑格错峰：主数字落地后才开
    s.text(`spoke-num-${i + 1}`, p.num, { size: 64, weight: 800, font: "monospace",
      color: "#22d3ee", at: { x: p.x, y: p.y },
      enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
    s.text(`spoke-cap-${i + 1}`, p.cap, { size: 32, color: "#94a3b8",
      at: { x: p.x, y: parseFloat(p.y) + 70 },
      enter: { effect: "fade", duration: 0.35, delay: d + 0.2 } });
  }
});
```

hub-and-spoke 的纪律：中心数字用主色白、支撑格数字用 accent——主从关系写进颜色；支撑格不摆底板（有底板就成了 2x2，主次消失）。

Recipe 3——原语图标拼装（两个完整示例）：时钟与盾牌，画在 96x96 框内、锚在格坐标。
引擎真值：图标不是一层而是**一组层**，组内共享同一 delay（同时 pop 才是一个图标）：

```ts
function drawClock(s: any, name: string, cx: number, cy: number, d: number): void {
  s.ellipse(`${name}-face`, { width: 96, height: 96, fill: "#0a0a12", at: { x: cx, y: cy },
    enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
  s.ellipse(`${name}-rim`, { width: 96, height: 96, fill: "#22d3ee", opacity: 0.35, blur: 6,
    at: { x: cx, y: cy }, enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
  s.rect(`${name}-hand-h`, { width: 30, height: 6, fill: "#e2e8f0", radius: 3,
    at: { x: cx + 12, y: cy }, enter: { effect: "fade", duration: 0.2, delay: d + 0.2 } });
  s.rect(`${name}-hand-v`, { width: 6, height: 24, fill: "#e2e8f0", radius: 3,
    at: { x: cx, y: cy - 9 }, enter: { effect: "fade", duration: 0.2, delay: d + 0.2 } });
}
function drawShield(s: any, name: string, cx: number, cy: number, d: number): void {
  s.rect(`${name}-body`, { width: 72, height: 84, fill: "#22d3ee", opacity: 0.28,
    radius: 14, at: { x: cx, y: cy },
    enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
  s.ellipse(`${name}-core`, { width: 20, height: 20, fill: "#e2e8f0",
    at: { x: cx, y: cy }, enter: { effect: "fade", duration: 0.2, delay: d + 0.25 } });
}
// 用法（在格循环里）：
// drawClock(s, `icon-${i + 1}`, cellX, cellY - 100, d);
// drawShield(s, `icon-${i + 1}`, cellX, cellY - 100, d);
```

拼装纪律四条：一组层共享同一 delay（组同时 pop 才是一个图标，错峰就散架）；线感元素宽 >= 6px（压缩后还活得下来）；face 与 rim 同尺寸叠印出「描边感」（v1 无 stroke，叠印就是描边）；图标组总层数 <= 5（再多渲染与 QA 都受罪）。

Recipe 4——竖版 9:16 信息格（两列改单列）：格宽 840（安全边距内）、四格纵向排、错峰压到 0.35s：
（版式规则同 kpi-countup 竖版：底 20% 是平台 UI 区。）

```ts
const CELLS_V = [
  { y: "26%", icon: "bolt",  num: "1.9s",  cap: "seek latency" },
  { y: "43%", icon: "clock", num: "12,847", cap: "renders / wk" },
  { y: "60%", icon: "stack", num: "96",     cap: "scenes / proj" },
  { y: "77%", icon: "rise",  num: "+38%",   cap: "growth qoq" },
];
v.scene("screen-v", { duration: 4.8, background: "#0a0a12" }, (s) => {
  s.beat("v-title", { at: 0.2, description: "竖版论点句 1s 可读" });
  s.text("title", "WHY TEAMS SWITCH", { size: 64, weight: 800, letterSpacing: 2,
    color: "#f8fafc", at: { x: "50%", y: "12%" },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.2 } });
  for (const [i, c] of CELLS_V.entries()) {
    const d = 0.3 + i * 0.35;                         // 竖版错峰更快：视线纵扫本就快
    s.rect(`card-${i + 1}`, { width: 840, height: 230, fill: "#12121f", radius: 16,
      at: { x: "50%", y: c.y },
      enter: { effect: "slide-up", duration: 0.45, delay: d, easing: "easeOutCubic",
        params: { distance: 50 } } });
    s.text(`num-${i + 1}`, c.num, { size: 76, weight: 800, font: "monospace",
      color: "#f8fafc", align: "left", at: { x: 200, y: c.y },
      enter: { effect: "typewriter", duration: 1.0, delay: d + 0.2, easing: "easeOutCubic" } });
    s.text(`cap-${i + 1}`, c.cap, { size: 34, color: "#94a3b8", align: "left",
      at: { x: 200, y: parseFloat(c.y) + 70 },
      enter: { effect: "fade", duration: 0.4, delay: d + 1.3 } });
  }
});
```

竖版单列纪律：格高 230 而不是 400（四格纵向共 920 + 间距，1920 高里刚好）；图标省略或右缘小尺寸（竖版格内主角只剩数字与短句）；末格 y = 77% + 格高半 115px = 仍在 80% 线以上。

Recipe 5——无数字事实格（icon + cap 两拍版）：不是每个事实都有数字——没数字的格砍掉 num 拍，icon pop -> cap fade，格高压到 300：
（两拍格与三拍格混排时，两拍格的 cap delay 对齐三拍格的 num delay——混排屏的错峰仍是一条波。）

```ts
const FACTS = [
  { x: "30%", icon: "shield", cap: "SOC2, audited" },
  { x: "70%", icon: "chat",  cap: "open roadmap" },
];
v.scene("screen-3", { duration: 3.6, background: "#0a0a12" }, (s) => {
  s.beat("facts-in", { at: 0.3, description: "两拍格：icon pop 后短句紧跟" });
  s.text("title", "TRUST, IN TWO LINES", { size: 56, weight: 800, letterSpacing: 3,
    color: "#f8fafc", at: { x: "50%", y: "18%" },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.2 } });
  for (const [i, f] of FACTS.entries()) {
    const d = 0.3 + i * 0.45;
    s.rect(`card-${i + 1}`, { width: 560, height: 300, fill: "#12121f", radius: 16,
      at: { x: f.x, y: "56%" },
      enter: { effect: "slide-up", duration: 0.5, delay: d, easing: "easeOutCubic",
        params: { distance: 60 } } });
    s.ellipse(`icon-bg-${i + 1}`, { width: 110, height: 110, fill: "#22d3ee", opacity: 0.16,
      at: { x: f.x, y: "44%" },
      enter: { effect: "scale-pop", duration: 0.4, delay: d, easing: "easeOutBack" } });
    s.text(`cap-${i + 1}`, f.cap, { size: 48, weight: 600, color: "#e2e8f0",
      at: { x: f.x, y: "62%" }, enter: { effect: "fade", duration: 0.4, delay: d + 0.6 } });
  }
});
```

两拍格的纪律：格高 300（比三拍格矮 100——没有数字就不需要那么高的房子）；cap 升到 48px 与 weight 600（没有数字当主角，短句自己当主角）；图标圆底座放大到 110（锚更重才压得住两拍节奏）。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——halo 或首格底板保住 frame-0 ink（screen-1 无 halo 时首格 slide-up 起点也算 ink，但静态 halo 更稳）。
- `expect(frame(30)).toContainText("WHY TEAMS SWITCH")`——1s 钩子，论点句先于一切格。
- 每格三拍门：`toHaveLayers("num-1", "cap-1", "card-1")`（原语图标版再加 `icon-*-face`）；num 逐字符等于用户值（kpi-countup 格式门同款）。
- 错峰门：相邻格 d 差值 0.35-0.5s（横版 0.45、竖版 0.35）；`render.preview` 揭示中段帧能数出波次。
- 末格三拍完成 <= 屏 duration - 0.8；`noTextOverflow()` 每屏（短句 8 字是红线）。
- `durationBetween`：每屏 3.5-5s、总 8-14s；`transition` 全部 crossfade 0.4s。
- hub-and-spoke 门：中心数字 color #f8fafc、支撑格数字 accent——主从颜色不倒置。
- 图标组门：组内全部层同名前缀、同 delay；QA 抽查一组（`toHaveLayers("icon-2-face", "icon-2-rim", "icon-2-hand-h")`）。
- 静音规则：数字 + 短句静音可读；论点句是屏的「旁白替代」，不得依赖配音才通顺。
- 一屏一论点门（人工）：每屏揭示完，用一句话复述；复述不出 = 回 storyboard 砍格。

## Anti-patterns

- 六格以上一屏——一屏一个论点、一格一个事实；第七格是第二屏（或该砍）。
- 全格同时揭示——错峰是「读」的节奏；同时 pop 是烟花，读完什么也没留下。
- 图标比数字抢——图标 <= 0.8 x 数字高、opacity <= 0.9；主角永远是数字。
- 引外部图标字体/图标图片——零资产是本技能的根基；原语拼不出的语汇就换语汇（速查表六选一）。
- 格内三拍乱序（短句先于数字）——icon -> num -> cap 的顺序就是「锚 -> 主角 -> 注解」。
- 每屏换 accent 色——一屏一个 accent、全片 <= 2 个；换色勤了等于没有 accent。
- 短句写满两行——8 字红线；第二行说明这格装的是两个事实。
- 编造「约数」凑格——数字必须是用户给的；没数字的事实格改用纯短句版式（icon + cap 两拍）。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 图标+数字+短句的信息格 | 本技能 | 带图版的版式与揭示 |
| 纯图标墙（无文案、高亮游走） | icon-grid | 图标矩阵本身 |
| 看板数字叙事（hero -> duo -> trend） | data-dashboard | 叙事编排 |
| 格内数字的计数微节奏 | kpi-countup | 位数表与定格照抄 |
| 一屏单图四幕（图表为主） | chart-story | 图是主体时 |
| 竖版交付 | short-video + aspect-reframe | Recipe 4 已给单列版 |

接出本技能时带走三样：格内三拍合同、原语图标速查表、一屏一论点门。图标拼装函数（Recipe 3）可整体拷给 icon-grid 用。
