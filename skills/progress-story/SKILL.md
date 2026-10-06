---
name: progress-story
version: 0.1.0
description: 进度环叙事——刻度环从 0 扫到目标的节奏、中心百分比同步计数、旁白四拍与环的四分之一对齐；管「进度怎么讲」。
trigger: The user wants a progress ring or dial story - the ring sweeping from zero toward the goal percentage while narration beats track each quarter of the sweep.
---

# Progress Story

Goal: 进度环叙事（1920x1080、30fps、6-10s）——一圈刻度从 12 点方向顺时针扫向目标值，中心百分比同步计数（kpi-countup 全套），旁白四拍各占环的四分之一，终点定格 >= 1s。
分工边界：progress-story 管**环的叙事**——扫描节奏、中心数字、旁白对齐、达成/差距两种结局；stat-bars 管 before/after 双条；kpi-countup 管中心数字的微节奏（本技能照抄其位数表与定格三件套）；本技能不画条形也不数裸数字——「环」是唯一主角。
引擎真值：DSL v1 没有弧线原语——环由 48 个绕圆排列的刻度 rect 拼成（rotation 使刻度长边沿切线），扫描 = lit 刻度按角度错峰入场；这不是妥协，是本体裁的正宗画法（刻度环比实心弧更可 QA：每一格都能点名）。

## Workflow

1. 收集四件事，缺了就问：
   - 目标百分比（用户给；68% 与 100% 是两种故事，结局写法不同）；
   - 进度的「身份句」（label，<= 14 字，"quarterly goal" / "migration complete"）；
   - 旁白文案四句（各 <= 10 字，对应 0-25/25-50/50-75/75-100 四段；用户给不了就先出占位再确认）；
   - 结局类型：达成（celebrate）还是差距（gap）——决定定格段的语气与配色。
   集合里的百分比、里程碑日期一律问——「季度目标」的季度是哪季，写错就是假进度。
2. `storyboard.plan { intent: "progress ring · <label>", durationSeconds }` -> 收敛为单场景四段：sweep（扫描 2.4-3.2s）-> quarter-beats（旁白四拍，嵌在扫描内）-> settle（定格三件套）-> hold（>= 1s，进度环的呼吸比别的体裁长）。
3. 写 `src/video.ts`（Recipes）：
   - 环几何：环心 (960, 540)、半径 330、48 刻度、刻度 12x36、从 -90 度（12 点）顺时针；
   - lit 刻度数 `n = round(pct x 48 / 100)`，未达刻度 dim 灰（#475569、opacity 0.5）常驻在场；
   - 中心数字 `font: "monospace"`、typewriter，duration 按位数表（两位百分数 1.0s）。
   层命名 `tick-<i>`（lit）/ `dim-<i>`（未达）/ `narr-<k>`（旁白）——刻度是从 1 计数的，QA 断言别写 tick-0。
4. 扫描节奏：每刻度错峰 = sweep 时长 / lit 刻度数（2.4s / 33 格 = 0.073s/格）；刻度 enter 用 `fade 0.3`（scale-pop 48 连发太吵，环要的是匀速感）。
   旁白四拍的 in 时刻对齐扫描的 25/50/75/100% 时刻（不是均分时间——**均分扫描**）。
5. `compile.run` -> 0 errors -> `check.overflow`——中心 170px 百分比与旁白句是 overflow 户；旁白底部 y = 880，与环外缘（540 + 330 + 18 = 888）擦边，旁白句 y 定 920 才安全。
6. `render.preview` 四帧：扫描 25% 帧（第一拍旁白已换）、扫描中段（刻度波均匀）、定格帧（数字、label、结局标签全齐）、hold 尾帧（全静）。
   自查「旁白跟得上环」：每拍旁白 fade 完成 <= 该四分之一的扫描终点——快了配音赶不上，慢了环等人。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调刻度 delay 与旁白窗口）-> `render.final`，交付附目标值、四拍旁白全文与结局类型。
   配音版的旁白轨时长要与 sweep 对齐（音频 2.4s 说不完四句就延长 sweep，不是加速旁白）。

扫描节奏合同（scene-local，四段全图）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| 环底（dim 刻度全环） | 0 | 无 enter 常驻 | - | 0 |
| lit 刻度（tick-i） | i x sweep/n | `fade` | 0.3 | sweep 终点 |
| 中心百分比 | 0.4s | `typewriter`（easeOutCubic） | 1.0-1.2 | 1.6s |
| label（身份句） | 0.2s | `fade` | 0.5 | 0.7s |
| 旁白 beat-k | 扫描 25k% 时刻 | `fade` | 0.4 | 各拍 + 0.4s |
| 结局标签 / 庆祝层 | sweep 终点 + 0.3 | `scale-pop` / `fade` | 0.4-0.6 | + 0.6s |
| hold | - | - | - | >= 1.0s 无新入场 |

扫描速度读感表（sweep 总时长的选择——环的「步速」）：

| sweep | 读感 | 用于 |
| --- | --- | --- |
| 1.8s | 快进 | 竖版短视频、已知的剧透式结局 |
| 2.4s | 匀速偏快 | 默认：多数进度叙事 |
| 3.2s | 沉 | 重大里程碑、配音四拍较长时 |
| > 3.2s | 拖 | 禁（观众开始数刻度而不是读故事） |

旁白四拍表（in 时刻 = 扫描的百分比时刻，非均分时间）：

| 拍 | in（sweep = 2.4s 例） | 文案角色 | 例 |
| --- | --- | --- | --- |
| beat-1 | 0.6s（25%） | 现状 | "migration started" |
| beat-2 | 1.2s（50%） | 过半 | "halfway there" |
| beat-3 | 1.8s（75%） | 收尾 | "the last stretch" |
| beat-4 | 2.4s（100%） | 定性 | "goal met" / "32% to go" |

刻度规格表（环的「字体规范」）：

| 元素 | 规格 | 备注 |
| --- | --- | --- |
| 刻度 | rect 12x36，radius 6 | 长边沿切线（rotation = 角度 + 90） |
| lit 色 | accent（#22d3ee 或 #f59e0b） | 达成用暖、差距用冷 |
| 未达色 | #475569、opacity 0.5 | 常驻：环的「地图」 |
| 刻度数 | 48（4 的倍数，四分位好对齐） | 24 疏、64 密，48 是读感甜点 |
| 起点 | -90 度（12 点）顺时针 | 钟表语义，别逆时针 |

## Recipes

Recipe 1——刻度环扫描（标准配方）：48 刻度绕圆拼环，lit 段顺时针错峰点亮，未达段 dim 常驻；中心百分比同步计数：
（lit 刻度数 n = round(68 x 48 / 100) = 33；扫描 2.4s -> 每格 0.073s。）

```ts
const PCT = 68, N = 48, R = 330, CX = 960, CY = 540;
const LIT = Math.round((PCT * N) / 100);              // 33 格 lit
const SWEEP = 2.4, STEP = SWEEP / LIT;               // 0.073s/格
v.scene("ring", { duration: 8.0, background: "#0a0a12" }, (s) => {
  s.beat("sweep-start", { at: 0.3, description: "12 点起顺时针扫描" });
  s.beat("sweep-done", { at: 2.7, description: "68% 落定，差距标签随后" });
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;  // -90 度起
    const tx = CX + R * Math.cos(ang), ty = CY + R * Math.sin(ang);
    const deg = (i / N) * 360;                        // rotation 用角度制
    if (i < LIT) {                                    // lit 段：错峰点亮
      s.rect(`tick-${i + 1}`, { width: 12, height: 36, fill: "#38bdf8", radius: 6,
        at: { x: Math.round(tx), y: Math.round(ty) }, rotation: deg + 90,
        enter: { effect: "fade", duration: 0.3, delay: 0.3 + i * STEP } });
    } else {                                          // 未达段：dim 常驻
      s.rect(`dim-${i + 1}`, { width: 12, height: 36, fill: "#475569", opacity: 0.5,
        radius: 6, at: { x: Math.round(tx), y: Math.round(ty) }, rotation: deg + 90 });
    }
  }
  s.ellipse("hub-glow", { width: 560, height: 560, fill: "#38bdf8", opacity: 0.08,
    blur: 120, at: { x: CX, y: CY } });               // frame-0 ink + 中心微光
  s.text("pct", "68%", { size: 170, weight: 800, font: "monospace", color: "#f8fafc",
    at: { x: CX, y: CY - 10 },
    enter: { effect: "typewriter", duration: 1.0, delay: 0.4, easing: "easeOutCubic" } });
  s.text("label", "Q3 MIGRATION GOAL", { size: 40, weight: 700, letterSpacing: 4,
    color: "#94a3b8", at: { x: CX, y: CY + 110 },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
});
```

几何账：lit 末格 delay 0.3 + 32 x 0.073 = 2.64s，fade 完成 2.94s——扫描在场景 3s 处收口；中心数字 1.4s 就定格了（数字先完、环后完是常态，观众读数字比跟刻度快）。
刻度 rotation = deg + 90 是关键一行：rect 长边默认竖直，+90 转到切线方向——不加 rotation 的环是「针刺放射盘」，加了才是「刻度环」。

Recipe 2——旁白四拍（嵌在扫描里）：四句 caption 在底部按**扫描的百分比时刻**换句，in/out 窗口互斥：
（caption 用同一层位（y 920）换内容 = 四个独立层，窗口错开；配音版同时挂 `v.audio`。）

```ts
const BEATS = [
  { text: "migration started",   at: 0.6 },           // 25% 时刻
  { text: "halfway there",       at: 1.2 },           // 50%
  { text: "the last stretch",    at: 1.8 },           // 75%
  { text: "68% and holding",     at: 2.4 },           // 100% = lit 终点
];
for (const [k, b] of BEATS.entries()) {
  const end = k < BEATS.length - 1 ? BEATS[k + 1]!.at : 4.2;   // 末拍多停 1.8s
  s.beat(`narr-${k + 1}`, { at: b.at, description: `旁白第 ${k + 1} 拍` });
  s.text(`narr-${k + 1}`, b.text, { size: 44, weight: 600, color: "#e2e8f0",
    at: { x: 960, y: 920 }, in: b.at, out: end,
    enter: { effect: "fade", duration: 0.4 },
    exit: { effect: "fade", duration: 0.4 } });
}
v.audio("narration", "assets/audio/progress-narration.mp3", { volume: 0.9, fadeIn: 0.3 });
```

旁白纪律四条：窗口互斥（上一句 out = 下一句 in，fade 交叠 0.4s 内完成换句）；末拍多停 1.8s（定性句是全片最重要的一句）；in 时刻跟**百分比**不跟均分时间（sweep 变长时四拍同步重算）；`v.audio` 的旁白轨是可选叠加——静音版必须已经成立（caption 本身就是旁白的字幕版）。

Recipe 3——两种结局（celebrate vs gap）：达成用暖色 + 全环提亮 + 庆祝定格；差距用冷色 + 缺口标签 + 老实陈述：
（同一骨架，只换结局段——这是本技能的「体裁主张」：进度的视频不是图表，是有立场的叙事。）

```ts
// 结局 A：celebrate（PCT = 100）——追加在扫描景尾部：
s.beat("goal-met", { at: 3.0, description: "全环提亮，庆祝定格" });
s.ellipse("boost-ring", { width: 760, height: 760, fill: "#f59e0b", opacity: 0.10,
  blur: 130, at: { x: CX, y: CY }, in: 3.0,
  enter: { effect: "fade", duration: 0.5 } });        // 全环提亮一档
s.text("verdict", "GOAL MET", { size: 64, weight: 800, letterSpacing: 6,
  color: "#f59e0b", at: { x: 960, y: 920 },
  enter: { effect: "scale-pop", duration: 0.45, delay: 3.1, easing: "easeOutBack" } });

// 结局 B：gap（PCT = 68）——替换定格段：
s.beat("gap-honest", { at: 3.0, description: "缺口标注：32% 没到就是没到" });
s.text("verdict", "32% TO GO", { size: 56, weight: 800, letterSpacing: 4,
  color: "#38bdf8", at: { x: 960, y: 920 },
  enter: { effect: "blur-up", duration: 0.5, delay: 3.0 } });
s.text("sub", "next milestone: Q4", { size: 30, color: "#94a3b8",
  at: { x: 960, y: 980 }, enter: { effect: "fade", duration: 0.4, delay: 3.4 } });
```

结局纪律：celebrate 的提亮只加**一层** boost（opacity 0.10 叠加在 hub-glow 上，总亮 <= 0.2——kpi-countup 的 glow 门同款）；gap 的措辞不许软化（"32% TO GO" 不是 "almost there"——进度视频的第一美德是不粉饰）；两种结局的中心数字都不再动（定格三件套已收，结局标签是收尾不是新故事）。

Recipe 4——竖版 9:16 进度环（feed 版）：环缩到 R = 300、环心上移 (540, 760)，旁白 caption 上移到 y 1240，label 在环下 120：
（竖版纪律同族：底 20% 平台 UI 区不进内容；环是主角所以整体上移留出下方 caption。）

```ts
const CVX = 540, CVY = 760, RV = 300, NV = 48;
const LITV = Math.round((PCT * NV) / 100);
v.scene("ring-v", { duration: 7.6, background: "#0a0a12" }, (s) => {
  s.beat("v-sweep", { at: 0.3, description: "竖版环：扫描节奏不变" });
  for (let i = 0; i < NV; i++) {
    const ang = (i / NV) * Math.PI * 2 - Math.PI / 2;
    const tx = CVX + RV * Math.cos(ang), ty = CVY + RV * Math.sin(ang);
    const deg = (i / NV) * 360;
    if (i < LITV) {
      s.rect(`tick-${i + 1}`, { width: 12, height: 34, fill: "#38bdf8", radius: 6,
        at: { x: Math.round(tx), y: Math.round(ty) }, rotation: deg + 90,
        enter: { effect: "fade", duration: 0.3, delay: 0.3 + i * (SWEEP / LITV) } });
    } else {
      s.rect(`dim-${i + 1}`, { width: 12, height: 34, fill: "#475569", opacity: 0.5,
        radius: 6, at: { x: Math.round(tx), y: Math.round(ty) }, rotation: deg + 90 });
    }
  }
  s.text("pct", "68%", { size: 150, weight: 800, font: "monospace", color: "#f8fafc",
    at: { x: CVX, y: CVY - 10 },
    enter: { effect: "typewriter", duration: 1.0, delay: 0.4, easing: "easeOutCubic" } });
  s.text("label", "Q3 MIGRATION GOAL", { size: 40, weight: 700, letterSpacing: 3,
    color: "#94a3b8", at: { x: CVX, y: CVY + 110 },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("narr-4", "68% and holding", { size: 42, weight: 600, color: "#e2e8f0",
    at: { x: 540, y: 1240 }, in: 2.4, out: 4.2,
    enter: { effect: "fade", duration: 0.4 }, exit: { effect: "fade", duration: 0.4 } });
});
```

竖版纪律：环心 (540, 760) + R 300 => 环底缘 1060 + 刻度 17 = 1077，caption 1240 有 160px 呼吸；百分比字号 150（两位数在 1080 宽里绰绰有余，不用降到 kpi-countup 竖版的 128——环内空间是圆的，宽裕）；旁白只保 beat-4（竖版 8s 内塞四拍太挤，保首尾两拍是折中——beat-1 + beat-4 的做法见变体速查）。

变体速查（常见需求 -> 处理法，都在本技能内解决）：

| 需求 | 处理法 | 参考 |
| --- | --- | --- |
| 多里程碑（25/50/75/100 四档） | 四档各一景，同环几何，每档一拍旁白 | 预算重算 |
| 目标是绝对值（1,142/1,500） | 中心数字改绝对值，环按比例扫描，label 写分母 | Recipe 1 |
| 倒退叙事（进度回落） | 逆时针 + 显式说明文案；默认仍顺时针 | Anti-patterns |
| 双环（本季+年度） | 同心双环（R 330/260），内环后扫；label 分色 | 几何变体 |
| 竖版要四拍旁白 | sweep 延长到 3.2s，四拍窗口各压到 0.7s | Recipe 4 |

## QA gates

- `expect(frame(0)).not.toBeBlack()`——hub-glow 与 dim 刻度常驻在场（未达段从 frame 0 就是「地图」）。
- `expect(frame(30)).toContainText("Q3 MIGRATION GOAL")`——1s 钩子，label 先于环完成。
- 扫描门：`toHaveLayers("tick-1", "tick-16", "tick-33", "dim-34", "dim-48")`——lit 首末与未达段点名；lit 数 = round(pct x 48 / 100)，差一格就是百分比错了。
- 中心门：`toContainText("68%")` 于 >= 1.4s（0.4 + 1.0）；typewriter 逐字符等于用户原值（kpi-countup 格式门）。
- 旁白门：四拍 `narr-1..4` 的 in 时刻分别 = 扫描的 25/50/75/100% 时刻（sweep 变则重算）；窗口互斥（上句 out = 下句 in）。
- 结局门：celebrate 版 `toHaveLayers("boost-ring", "verdict")` 且 boost opacity <= 0.10；gap 版 verdict 文案含缺口数（"32%"），与 100 - pct 一致。
- 环底门：旁白 caption y >= 920（环外缘 888 + 32 呼吸）；`noTextOverflow()` 全景。
- `durationBetween(6, 10)`；hold >= 1.0s（进度环的定格比别家长一档——观众要数一遍刻度）。
- 竖版门：全部文字 y <= 80% 画幅；caption 与环底缘间距 >= 120px。
- 静音规则：中心数字 + label + 四拍 caption 静音可读；`v.audio` 旁白轨是增强不是依赖。
- 交付门：目标值、四拍旁白全文、结局类型三样写进交付说明——gap 结局的措辞要用户确认（「没到」的措辞是立场问题）。
- 双环门（变体）：内外环刻度数都用 48 的约数（48/24），四分位刻度重合对齐；内环 delay 全体系后移 sweep。
- 音画门（配音版）：`v.audio` 旁白轨的总时长 >= sweep + 0.6s（末拍说完还有定格呼吸）；不然末拍被切。

## Anti-patterns

- 用 ellipse 描边当环——v1 无弧线，实心椭圆只会盖住中心；刻度环才是正路，且每格可 QA。
- 逆时针扫描——钟表语义是顺时针；逆时针读作「倒退」，除非叙事真的是回退（那要显式说明）。
- 扫描快过旁白——旁白没说完环就满了，四拍对齐的是百分比时刻，不是图省事的均分时间。
- 无目标的百分比——"68%" 是什么的 68%？label 必填；裸百分比是谜语不是进度。
- 中心数字非 monospace——kpi-countup 抖动规则在环心同样成立（还叠加圆形边界的放大效应）。
- 从非零起扫——开场先亮 0%（数字从 "0%" 数起）；直接从 30% 开始的环像中途插入。
- gap 结局粉饰——"almost there" / "nearly done" 都是粉饰；差 32% 就写 32% TO GO。
- celebrate 用双倍 glow——提亮一层 0.10 到顶；两层 boost 是曝光过度，环纹全糊。
- 拿本技能画仪表盘——多环并置是 data-dashboard 的看板版式；本技能一屏一环一故事。
- 目标值不整——用户说「快到了」不是数字；拿到具体百分比/绝对值才开写，占位到底。
- 刻度命名从 0 计数——`tick-0..tick-47` 与 `tick-1..tick-48` 混用一套就断言错位；本技能统一 1 起 48 止。
- 旁白句长于 10 字——四拍每拍只有四分之一 sweep（约 0.6s 入场 + 停留）；长句在窗口里读不完，砍字不是改字。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 进度环叙事（扫描+旁白+结局） | 本技能 | 环是主角 |
| 中心数字的计数微节奏 | kpi-countup | 位数表与定格三件套照抄 |
| before/after 双条对比 | stat-bars | 条不是环 |
| 看板多指标并置 | data-dashboard | 编排归它 |
| 竖屏交付 | short-video + aspect-reframe | Recipe 4 已给竖版 |
| 环形加载动画（纯 loop） | gif-loop | 无叙事的 loop 不是 story |

接出本技能时带走三样：刻度环几何公式（角度、rotation = deg + 90）、旁白对齐百分比时刻、两种结局的措辞纪律。目标值与四拍旁白在交付说明里原样复述。
刻度环的几何公式被 timeline-story 的节点环引用过同源思路——先算角度再算坐标，两个技能共享这一课。
