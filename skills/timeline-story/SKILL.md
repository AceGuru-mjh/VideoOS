---
name: timeline-story
version: 0.1.0
description: 垂直时间线揭示——9:16 竖屏的 spine 分段生长、节点逐个点亮、事件短句与终点金句点睛；管「成长史/大事记」的纵向叙事（roadmap 管横版路线图）。
trigger: The user wants a vertical timeline story - the spine growing segment by segment down the screen, nodes lighting up one by one, ending with an accent punchline node.
---

# Timeline Story

Goal: 垂直时间线叙事（1080x1920、30fps、8-14s）——spine（主轴）自上而下**分段生长**（每段 rect `wipe 0.45s`），段末节点逐个点亮（`scale-pop`），事件短句（年份 + 一句话）跟在节点右侧，终点是 accent 大节点 + 金句点睛 + 相机微推。
分工边界：roadmap 管横版产品路线图（水平轴 + focus carousel，且明言「16:9 里竖时间线浪费横轴」）；timeline-story 管**竖屏垂直时间线**——成长史、大事记、流程链的纵向揭示；short-video 的安全边距纪律在此全量适用（左右各 8%、底部 20% 平台 UI 区）。
数据纪律：每个节点必须带时间标签（年份/月份）——时间线上没有时间的节点是清单不是时间线。

## Workflow

1. 收集四件事，缺了就问：
   - 节点清单（3-5 个，每个：时间标签 + 事件句 <= 10 字）；
   - 终点金句（<= 12 字，点睛句——最后一个节点说什么）；
   - 叙事方向确认（自上而下 = 时间顺序；倒序叙事要先跟用户对齐）；
   - accent 色（终点节点与金句共用一个）。
   超过 5 个节点先问砍谁——竖屏一屏的预算就是 5 节点 x 1.6s。
2. `storyboard.plan { intent: "timeline · <subject>", durationSeconds }` -> 收敛为单场景连续揭示：spine-1 -> node-1 -> event-1 -> spine-2 -> …… -> final-node -> punchline -> hold。
   一个场景走完全程（时间线的「生长感」不能被 crossfade 切断）；16:9 横版例外见 Recipe 4。
3. 写 `src/video.ts`（Recipes）：
   - 竖版几何：spine x = 260（左侧安全边距内）、首节点 y = 380、节距 300、段高 300（含节点位）；
   - 层命名 `spine-<k>`（段）/ `node-<k>` / `year-<k>` / `event-<k>`——QA 按名寻址；
   - 事件文字全部右侧（x 620 起，`align: "left"`）——竖屏单列，不左右交替。
4. 节奏合同：每节点 1.4-1.8s（段 wipe 0.45 + 节点 pop 0.35 + 事件 fade 0.4 + 段间呼吸）；**连线先长、节点后亮**（顺序反了就是「点先亮线再补」，生长感全无）。
   终点节点用 44px accent（普通节点 26px）——尺寸差就是点睛的音量。
5. `compile.run` -> 0 errors -> `check.overflow`——事件句 10 字 x 52px = 520px + x 620 = 1140 > 1080 画宽的 80%（安全边距右缘 994）：**事件句右缘 <= 994 是硬线**，字号超预算先砍字。
6. `render.preview` 三帧：第二节点点亮帧（连线已长、节点刚亮——生长感的存在证明）、终点帧（accent 节点 + 金句齐）、hold 尾帧（全静）。
   自查「读得出先后」：节点的揭示节奏是否允许观众逐个默读——快了是滚屏，慢了是幻灯。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调节距与 delay）-> `render.final`，交付附节点清单（时间标签 + 事件句逐字）与金句。

节点节奏合同（scene-local，每节点照抄）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| spine-k（段） | 节点 k 起点 | `wipe` | 0.45 | + 0.45s |
| node-k（节点） | 段落地后 + 0.1 | `scale-pop`（easeOutBack） | 0.35 | + 0.45s |
| year-k（年份） | 节点同时 | `fade` | 0.3 | + 0.3s |
| event-k（事件句） | 节点后 + 0.2 | `fade` | 0.4 | + 0.6s |
| 呼吸 | - | - | - | 节点间 0.3-0.5s 空气 |
| 终点：final-node | 全程 60% 后 | `scale-pop`（easeOutBack） | 0.5 | + 0.5s |
| 终点：punchline | final + 0.3 | `blur-up` | 0.5 | + 0.5s |
| hold | - | - | - | >= 0.8s 无新入场 |

竖版版式表（safe margin 内的全部坐标规则）：

| 元素 | 规格 | 备注 |
| --- | --- | --- |
| spine | x 260、宽 8、radius 4 | 左侧 8% 边距内（86-434） |
| 首节点 y | 380 | 顶部留给标题（y 180） |
| 节距 | 300 | 5 节点到 y 1580（80% 线上） |
| 事件文字 | x 620 起、align left、右缘 <= 994 | 右侧 8% 边距外不吃 |
| 年份 | 节点左侧 x 160、align right | spine 左边的小注 |
| 标题 | y 180、52px | 全片唯一大标题 |

## Recipes

Recipe 1——spine 分段生长 + 节点点亮（标准配方）：四节点成长史，段段 wipe、节点 pop、事件句跟右，终点 accent：

```ts
const NODES = [
  { year: "2019", event: "first render pipeline" },
  { year: "2021", event: "agent kit went public" },
  { year: "2023", event: "42 skills shipped" },
  { year: "2025", event: "the visualization suite" },
];
const SPX = 260, Y0 = 380, PITCH = 300, SEG_H = 300;
v.scene("timeline", { duration: 9.6, background: "#0a0a12" }, (s) => {
  s.beat("title-in", { at: 0.2, description: "标题 1s 可读，spine 待发" });
  s.beat("first-node", { at: 1.0, description: "首段连线先长，节点后亮" });
  s.beat("punchline", { at: 7.4, description: "终点金句点睛" });
  s.text("title", "THE ROAD SO FAR", { size: 52, weight: 800, letterSpacing: 4,
    color: "#f8fafc", at: { x: 620, y: 180 },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.2 } });
  s.ellipse("halo", { width: 700, height: 700, fill: "#22d3ee", opacity: 0.06,
    blur: 150, at: { x: 540, y: "46%" } });            // frame-0 ink，极淡
  for (const [k, n] of NODES.entries()) {
    const ny = Y0 + k * PITCH;
    const t0 = 0.9 + k * 1.5;                          // 节点 k 的发令时刻
    const isLast = k === NODES.length - 1;
    s.rect(`spine-${k + 1}`, { width: 8, height: SEG_H, fill: "#334155", radius: 4,
      at: { x: SPX, y: ny + SEG_H / 2 },
      enter: { effect: "wipe", duration: 0.45, delay: t0, easing: "easeOutCubic" } });
    s.ellipse(`node-${k + 1}`, { width: isLast ? 44 : 26, height: isLast ? 44 : 26,
      fill: isLast ? "#f59e0b" : "#22d3ee", at: { x: SPX, y: ny + SEG_H },
      enter: { effect: "scale-pop", duration: isLast ? 0.5 : 0.35, delay: t0 + 0.55,
        easing: "easeOutBack" } });                    // 节点等段长完才亮
    s.text(`year-${k + 1}`, n.year, { size: 30, weight: 700, font: "monospace",
      color: isLast ? "#f59e0b" : "#64748b", align: "right", at: { x: 160, y: ny + SEG_H },
      enter: { effect: "fade", duration: 0.3, delay: t0 + 0.55 } });
    s.text(`event-${k + 1}`, n.event, { size: 44, weight: 600,
      color: isLast ? "#f8fafc" : "#e2e8f0", align: "left", at: { x: 620, y: ny + SEG_H },
      enter: { effect: "fade", duration: 0.4, delay: t0 + 0.75 } });
  }
});
```

时序账：末节点 t0 = 0.9 + 3 x 1.5 = 5.4s，节点亮 5.95s、事件句 6.75s 落定；金句 7.4s、定格 7.9s、hold 1.7s——4 节点 9.6s 的完整预算。
「段先长节点后亮」是 delay 的 0.55s 差值——wipe 0.45 + 0.1 呼吸；这个差值没了，时间线就退化成「打点机」。

Recipe 2——终点金句点睛（本技能的签名动作）：accent 大节点之后，金句以终点节点同色 blur-up 收在事件句下方，相机同步微推：
（点睛的「睛」有两笔：颜色 + 尺寸 + 相机——三通道同刻发枪。）

```ts
// 接 Recipe 1 的场景尾部（同 scene 内）：
s.beat("punchline", { at: 7.4, description: "金句与相机同刻点睛" });
s.text("punchline", "and the road keeps growing", { size: 48, weight: 800,
  color: "#f59e0b", align: "left", at: { x: 620, y: Y0 + 3 * PITCH + SEG_H + 120 },
  enter: { effect: "blur-up", duration: 0.5, delay: 7.4 } });
s.rect("punch-rule", { width: 120, height: 4, fill: "#f59e0b", radius: 2,
  at: { x: 680, y: Y0 + 3 * PITCH + SEG_H + 210 },
  enter: { effect: "wipe", duration: 0.4, delay: 7.7 } });   // 金句下的小划线
s.camera("push-in", { from: 1.0, to: 1.04 });        // 微推：点睛的第三通道
```

点睛纪律四条：金句与终点节点同 accent 色（一色到底，点睛不是换色）；金句 y 在末事件句下方 120px（视线沿时间线自然下移的落点）；相机 push 全片**只此一次**（roadmap 的「一推一片」同款纪律）；金句 <= 12 字（点睛是针刺不是演讲）。

Recipe 3——五节点压缩版（节距与节奏的伸缩）：节点多一个不必砍——节距 300 -> 260、节点周期 1.5 -> 1.3s、事件句 44 -> 40px：
（伸缩的底线：每节点 >= 1.2s（pop 0.35 + fade 0.6 + 呼吸 0.25）；低于 1.2s 观众读不完年份。）

```ts
const NODES5 = [
  { year: "2019", event: "first render pipeline" },
  { year: "2020", event: "windows support" },
  { year: "2021", event: "agent kit went public" },
  { year: "2023", event: "42 skills shipped" },
  { year: "2025", event: "the visualization suite" },
];
const PITCH5 = 260, SEG5 = 260, Y05 = 400;
for (const [k, n] of NODES5.entries()) {
  const ny = Y05 + k * PITCH5;
  const t0 = 0.9 + k * 1.3;                           // 节点周期压到 1.3s
  const isLast = k === NODES5.length - 1;
  s.rect(`spine-${k + 1}`, { width: 8, height: SEG5, fill: "#334155", radius: 4,
    at: { x: SPX, y: ny + SEG5 / 2 },
    enter: { effect: "wipe", duration: 0.4, delay: t0, easing: "easeOutCubic" } });
  s.ellipse(`node-${k + 1}`, { width: isLast ? 44 : 24, height: isLast ? 44 : 24,
    fill: isLast ? "#f59e0b" : "#22d3ee", at: { x: SPX, y: ny + SEG5 },
    enter: { effect: "scale-pop", duration: 0.35, delay: t0 + 0.5, easing: "easeOutBack" } });
  s.text(`year-${k + 1}`, n.year, { size: 28, weight: 700, font: "monospace",
    color: isLast ? "#f59e0b" : "#64748b", align: "right", at: { x: 160, y: ny + SEG5 },
    enter: { effect: "fade", duration: 0.3, delay: t0 + 0.5 } });
  s.text(`event-${k + 1}`, n.event, { size: 40, weight: 600,
    color: isLast ? "#f8fafc" : "#e2e8f0", align: "left", at: { x: 620, y: ny + SEG5 },
    enter: { effect: "fade", duration: 0.4, delay: t0 + 0.7 } });
}
```

五节点账：末节点 t0 = 0.9 + 4 x 1.3 = 6.1s，事件句 7.2s；金句 7.8s、定格 8.3s、hold >= 1s、总 9.5-10.5s。末节点 y = 400 + 4 x 260 + 260 = 1700 < 80% 线（1536 + 平台区）？——**超了**：1700 在 80% 线（1536）之下，末节点压进平台 UI 区；五节点版把 Y05 提到 340、PITCH5 压到 240（末节点 y = 340 + 4 x 240 + 240 = 1540，勉强贴线）或砍回四节点。这段「贴线」账是五节点版最常翻的车。

Recipe 4——横版例外（16:9 里确实需要时间线）：spine 压到左侧 1/3（x 420），事件句全部右侧 2/3（x 760 起、宽 1000），节点横向不变仍是纵向时间线：
（roadmap 的反模式条目说「16:9 里竖时间线浪费横轴」——例外是「流程链/成长史」这类**纵向语义**内容：步骤的先后本来就是上下关系。）

```ts
const SPXH = 420, Y0H = 360, PITCHH = 280, SEGH = 280;
v.scene("timeline-h", { duration: 9.0, background: "#0a0a12" }, (s) => {
  s.beat("h-title", { at: 0.2, description: "横版时间线：左轴右文" });
  s.text("title", "THE ROAD SO FAR", { size: 56, weight: 800, letterSpacing: 4,
    color: "#f8fafc", at: { x: 1160, y: 180 },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.2 } });
  s.ellipse("halo", { width: 900, height: 900, fill: "#22d3ee", opacity: 0.05,
    blur: 150, at: { x: 620, y: "52%" } });
  for (const [k, n] of NODES.entries()) {
    const ny = Y0H + k * PITCHH;
    const t0 = 0.9 + k * 1.5;
    const isLast = k === NODES.length - 1;
    s.rect(`spine-${k + 1}`, { width: 8, height: SEGH, fill: "#334155", radius: 4,
      at: { x: SPXH, y: ny + SEGH / 2 },
      enter: { effect: "wipe", duration: 0.45, delay: t0, easing: "easeOutCubic" } });
    s.ellipse(`node-${k + 1}`, { width: isLast ? 44 : 26, height: isLast ? 44 : 26,
      fill: isLast ? "#f59e0b" : "#22d3ee", at: { x: SPXH, y: ny + SEGH },
      enter: { effect: "scale-pop", duration: 0.35, delay: t0 + 0.55, easing: "easeOutBack" } });
    s.text(`year-${k + 1}`, n.year, { size: 32, weight: 700, font: "monospace",
      color: isLast ? "#f59e0b" : "#64748b", align: "right", at: { x: 300, y: ny + SEGH },
      enter: { effect: "fade", duration: 0.3, delay: t0 + 0.55 } });
    s.text(`event-${k + 1}`, n.event, { size: 48, weight: 600,
      color: isLast ? "#f8fafc" : "#e2e8f0", align: "left", at: { x: 760, y: ny + SEGH },
      enter: { effect: "fade", duration: 0.4, delay: t0 + 0.75 } });
  }
});
```

横版例外的纪律：只在**纵向语义**内容上用（流程链、成长史）；产品路线图（日期驱动的排期）仍归 roadmap 横版；事件句右缘 <= 1760（x 760 + 1000 宽）；标题居右半（x 1160）而不是全屏居中——左 1/3 是轴的领地。

变体速查（常见需求 -> 处理法，都在本技能内解决）：

| 需求 | 处理法 | 参考 |
| --- | --- | --- |
| 倒序（新在上） | 节点数组倒排 + 标题注明 "newest first" | Anti-patterns |
| 每节点要配图 | 事件句右列换 `s.image`（宽 360，右缘 <= 994） | Recipe 3 列宽 |
| 节点带小指标 | 年份行右侧加 monospace 小数字（kpi-countup 格式表） | Recipe 1 变体 |
| 双列时间线（甲乙两线） | spine x 260/820 双轴，节点交替点亮 | 几何变体 |
| 循环版 | 首尾帧一致化交 gif-loop | 链路表 |
| 配音版 | `v.audio` 旁白轨按节点时刻分段对齐 | QA 音画门 |

## QA gates

- `expect(frame(0)).not.toBeBlack()`——halo（极淡）或标题入场起点保住 frame-0 ink。
- `expect(frame(30)).toContainText("THE ROAD SO FAR")`——1s 钩子，标题先于 spine。
- 生长门：`spine-k` 的 wipe delay + 0.45 <= `node-k` 的 pop delay（连线先长节点后亮——顺序倒了即违例）。
- 节点门：`toHaveLayers("spine-1", "spine-4", "node-1", "node-4", "year-4", "event-4")`；每个节点的时间标签逐字符等于用户清单。
- 终点门：`node-4` 尺寸 44px 且 fill accent；`punchline` 与 `punch-rule` 在末事件句 settled 后 >= 0.3s 才入场。
- 相机门：全片恰一次 `push-in`（from 1.0 to 1.04），时刻与金句同步（roadmap「一推一片」同款）。
- 安全区门：全部文字层 y <= 1536（80% 线）；事件句右缘 <= 994（竖版）；五节点版末节点 y 复算（贴线账是本体裁最常翻的车）。
- `noTextOverflow()`；`durationBetween(8, 14)`；hold >= 0.8s 无新入场。
- 静音规则：年份 + 事件句 + 金句静音可读——竖屏 feed 默认无声，时间线的「先后」靠节奏不靠配音。
- 交付门：节点清单（时间标签 + 事件句逐字）与金句写进交付说明；叙事方向（正序/倒序）明确标注。
- 配图门（变体）：`s.image` 宽 <= 360 且右缘 <= 994；图片入场用 fade（blur 入场读作「加载」，gradient-flow 静帧版同判）。
- 双轴门（变体）：两根 spine 的节点交替点亮（甲 0.9s、乙 1.65s 起，周期 1.5 不变）；同刻双亮读作并列不是交替。

## Anti-patterns

- 16:9 里硬用全宽竖时间线——roadmap 原判「浪费横轴」；横版只在纵向语义内容上用左轴右文（Recipe 4）。
- 全长 spine 先出现——生长感是本体裁的全部动效价值；整条先躺在那里，节点再逐个亮，就只是「打点机」。
- 节点先亮线后补——顺序反了生长感全无；wipe 先、pop 后是铁序。
- 节点无时间标签——时间线上没时间的节点是清单；年份/月份必填（数据纪律第一条）。
- 超过 5 节点还硬排——末节点压进平台 UI 区（五节点已贴 80% 线）；第六个节点是第二个视频。
- 金句先于终点节点——点睛必须是最后一拍；金句早到，终点节点就成了补丁。
- 每个节点都 accent——accent 只归终点；中间节点全部 cyan 系，最后一点 amber 才「睛」得住。
- 事件句超 10 字——竖版右列宽 374px（620-994），10 字 x 40px 是满格；超字先砍字。
- 相机逐节点推——一推一片；时间线的推只发生在金句时刻。
- 倒序不做说明——自下而上读时间线（新事件在上）要先跟用户对齐并在标题里注明（"newest first"）。
- 时间标签编造——年份/月份必须来自用户；「大约那年」不是时间标签，问不到就占位到底。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 竖屏垂直时间线（成长史/流程链） | 本技能 | 纵向揭示 |
| 横版产品路线图（排期驱动） | roadmap | 水平轴 + focus carousel |
| 竖屏安全边距与节奏总则 | short-video | 边距表全量适用 |
| 里程碑带状态（shipped/planned） | roadmap | 状态色系是它的 |
| 流程步骤教学化 | tutorial | 步骤要讲解时 |
| 年度回顾（KPI + 高光时刻） | year-review | 回顾体裁的完整体 |

接出本技能时带走三样：连线先长节点后亮的铁序、五节点贴线账（Y0/PITCH 复算）、点睛三通道（色 + 尺寸 + 相机同刻）。节点清单与金句在交付说明里逐字复述。
