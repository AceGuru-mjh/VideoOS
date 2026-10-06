---
name: stat-bars
version: 0.1.0
description: 单指标前后对比条动画——before/after 双横条先后生长、条端差异括线标注、100% 基准线；管「一个指标变了多少」的画法与节奏。
trigger: The user asks to show one metric's before-and-after change - two bars growing from the same baseline, the gap bracketed and labeled, the 100 percent reference line marked.
---

# Stat Bars

Goal: 单指标前后对比动画（1920x1080、30fps、5-8s）——before 条与 after 条同基准先后生长（先后即叙事：先看到旧值），条端差异括线 + delta 标注，必要时 100% 基准线，结论句收底。
分工边界：comparison 管 X vs Y 多回合整体 PK（胜者点、记分条、裁决帧）；data-motion 管条形画法总则（遮罩、easing 语义）；chart-race 管多名次竞速；本技能管**单一指标的 before/after**——双条、差异标注、基准线，就这一个论点。
数字纪律：before/after 两值都来自用户；差值（-42%）由两值算出后**换算回百分数给用户看**，不替用户选口径。

## Workflow

1. 收集四件事，缺了就问：
   - 指标名（<= 14 字，做屏标题）与单位；
   - before 值与 after 值（格式原样，kpi-countup 格式表照抄）；
   - 基准线需求：after 是百分数或增长率时画 100%/0% 基准，否则可省；
   - 结论句（<= 10 字，数字必须从图上读得出）。
2. `storyboard.plan { intent: "stat bars · <metric>", durationSeconds }` -> 收敛为单场景四拍：before -> after -> delta -> conclusion。
   一屏就这两条；要对比三组指标是三个场景或 data-dashboard 的活。
3. 写 `src/video.ts`（Recipes）：
   - 条几何：LEFT = 620（左留 label 区）、条高 90、y_before = 480、y_after = 640——**纵向 slot 固定**，全片不挪；
   - 条长映射 `w = round(value x scale)` 写进注释（data-motion 诚实规则），两值共用一个 scale（各画各的 scale 是说谎）；
   - 值标签在条端右侧 +8px，`font: "monospace"`（kpi-countup 抖动规则）。
4. 缓动按「语气」选：before 条 `easeOutCubic`（旧值，平实）；after 条 `easeOutExpo`（新值，爆发）——after 用 before 同款缓动也可以，但永远**后入场**（先后即叙事）。
5. `compile.run` -> 0 errors -> `check.overflow`——值标签在条端右（4 位值 + 单位约 130px），after 条顶满时标签顶画布右缘是本体裁 overflow 户。
6. `render.preview` 三帧：before 落定帧、after 落定帧（差异括线还没出——观众此刻自己心算差值）、delta 括线 pop 后定格帧。
   自查「一眼读出变化」：定格帧上 -42% 的位置是否正好落在两端的视觉连线中点？不是就 `layer.modify` 对齐。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调括线与标签位）-> `render.final`，交付附两值 + 差值口径（百分点 or 相对%）。

双条节奏合同（scene-local，四拍全图）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| 标题 + 单位 | 0.2s | `fade` | 0.4 | 0.6s |
| before 条 + 标签 | 0.3s | `wipe`（easeOutCubic） | 1.2 | 1.5s |
| after 条 + 标签 | 1.8s | `wipe`（easeOutExpo） | 1.2 | 3.0s |
| 差异括线 + delta | 3.2s | `scale-pop`（easeOutBack） | 0.4 | 3.6s |
| 结论句 | 3.9s | `blur-up` | 0.5 | 4.4s |
| hold | - | - | - | >= 0.8s |

基准线形态表（何时画、怎么画）：

| after 形态 | 基准线 | 画法 |
| --- | --- | --- |
| 百分数（68.4%） | 100% 竖虚线 | 4 段小 rect 拼虚线 + "100%" 小签 |
| 增长率（+38%） | 0% 竖虚线 | 同上，签写 "0%" |
| 绝对值（1.9s） | 可省 | 有行业阈值才画（用户给） |
| before 的 N% | N% 竖虚线 | after 相对 before 的口径时用 |

缓动语气表（双条的「先后」之外的第二个语气维度）：

| 组合 | 读感 | 用于 |
| --- | --- | --- |
| cubic + expo | 平实 -> 爆发 | 默认：改善型故事 |
| cubic + cubic | 平实 -> 平实 | 中性对比（不站队） |
| linear + expo | 老实 -> 爆发 | 「积攒 -> 释放」叙事 |
| expo + cubic | 爆发 -> 平实 | 恶化型故事（after 更短时也用） |

## Recipes

Recipe 1——双横条先后生长（标准配方）：before 灰条先长、after accent 条后长，值标签在条端，差异括线在两端之间 pop：
（条长映射：`w = round(seconds x 300)`——两值共用；1.9s -> 570px、3.3s -> 990px。）

```ts
const BEFORE = { v: "3.3s", w: Math.round(3.3 * 300) };   // 旧值：P95 预览耗时
const AFTER  = { v: "1.9s", w: Math.round(1.9 * 300) };   // 新值：优化后
const LEFT = 620, BAR_H = 90, Y_B = 480, Y_A = 640;
v.scene("compare", { duration: 5.6, background: "#0a0a12" }, (s) => {
  s.beat("before-in", { at: 0.3, description: "before 先长：平实" });
  s.beat("after-in", { at: 1.8, description: "after 爆发：新值登场" });
  s.beat("delta-in", { at: 3.2, description: "差异括线 + -42% 落锤" });
  s.text("title", "PREVIEW P95, BEFORE -> AFTER", { size: 44, weight: 800,
    letterSpacing: 3, color: "#f8fafc", at: { x: "50%", y: 240 },
    enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
  s.rect("bar-before", { width: BEFORE.w, height: BAR_H, fill: "#475569", radius: 8,
    at: { x: LEFT + BEFORE.w / 2, y: Y_B },
    enter: { effect: "wipe", duration: 1.2, delay: 0.3, easing: "easeOutCubic" } });
  s.text("v-before", BEFORE.v, { size: 40, weight: 700, font: "monospace", color: "#94a3b8",
    at: { x: LEFT + BEFORE.w + 80, y: Y_B }, enter: { effect: "fade", duration: 0.4, delay: 1.3 } });
  s.text("l-before", "BEFORE", { size: 28, letterSpacing: 2, color: "#94a3b8",
    align: "right", at: { x: LEFT - 60, y: Y_B }, enter: { effect: "fade", duration: 0.3, delay: 0.4 } });
  s.rect("bar-after", { width: AFTER.w, height: BAR_H, fill: "#22c55e", radius: 8,
    at: { x: LEFT + AFTER.w / 2, y: Y_A },
    enter: { effect: "wipe", duration: 1.2, delay: 1.8, easing: "easeOutExpo" } });
  s.text("v-after", AFTER.v, { size: 40, weight: 700, font: "monospace", color: "#22c55e",
    at: { x: LEFT + AFTER.w + 80, y: Y_A }, enter: { effect: "fade", duration: 0.4, delay: 2.8 } });
  s.text("l-after", "AFTER", { size: 28, letterSpacing: 2, color: "#22c55e",
    align: "right", at: { x: LEFT - 60, y: Y_A }, enter: { effect: "fade", duration: 0.3, delay: 1.9 } });
});
```

时序账：before 0.3 + 1.2 = 1.5s 落定，after 1.8 + 1.2 = 3.0s 落定——中间 0.3s 空气是「旧值先被看见」的呼吸；delta 3.2s 落锤，hold 5.6 - 4.4 = 1.2s。
两条**永远不同时生长**：同时长 = 并列陈列，先后长 = 因果叙事。

Recipe 2——差异括线 + delta 落锤（本技能的签名动作）：两条末端之间的竖括线 rect + delta 文本，`scale-pop` 落在两端视觉中点：
（括线画在 after 端右缘、高度跨两 slot 中点——它标注的是「差」，位置跟着 after 走。）

```ts
// 接 Recipe 1 的场景尾部追加（同 scene 内）：
s.rect("bracket", { width: 6, height: 260, fill: "#f59e0b", radius: 3,
  at: { x: LEFT + AFTER.w + 24, y: (Y_B + Y_A) / 2 },
  enter: { effect: "scale-pop", duration: 0.4, delay: 3.2, easing: "easeOutBack" } });
s.rect("bracket-cap-t", { width: 26, height: 6, fill: "#f59e0b", radius: 3,
  at: { x: LEFT + AFTER.w + 24 + 10, y: Y_B - 90 },
  enter: { effect: "fade", duration: 0.2, delay: 3.4 } });   // 上端帽，指向 before 端
s.rect("bracket-cap-b", { width: 26, height: 6, fill: "#f59e0b", radius: 3,
  at: { x: LEFT + AFTER.w + 24 + 10, y: Y_A + 90 },
  enter: { effect: "fade", duration: 0.2, delay: 3.4 } });   // 下端帽，指向 after 端
s.text("delta", "-42%", { size: 56, weight: 800, font: "monospace", color: "#f59e0b",
  at: { x: LEFT + AFTER.w + 130, y: (Y_B + Y_A) / 2 },
  enter: { effect: "scale-pop", duration: 0.4, delay: 3.5, easing: "easeOutBack" } });
s.text("conclusion", "same renders, half the wait", { size: 44, weight: 700,
  color: "#f8fafc", at: { x: "50%", y: 860 },
  enter: { effect: "blur-up", duration: 0.5, delay: 3.9 } });
```

括线纪律三条：括线 x 绑**after 端**（差异是相对新值而言）；端帽分别指向两 slot 的条端（y 用条端外扩 90px，别压条）；delta 带符号（-42% 不是 42%——符号是语义，颜色是第二通道，kpi-countup 同规）。
delta 的口径写死在括线旁：相对变化（(after-before)/before）是默认；百分点差（68% -> 71%）时签写 "+3pt"——两种口径混用是本体裁最常见的诚实事故。

Recipe 3——100% 基准线 + 超基准分段：after 是百分数（如 68.4% vs 基准 100%）时，画基准虚线；after 超过基准的场合，条分两段拼（达标段 + 超出段更亮）：
（虚线 = 4 段小 rect；分段 = 两 rect 同 y 同高拼接，共享 wipe 节奏但超出段用更亮 fill。）

```ts
const PCT = 68, W100 = 980;                            // w = round(pct x 9.8)
const W_P = Math.round(PCT * 9.8);
v.scene("baseline", { duration: 5.4, background: "#0a0a12" }, (s) => {
  s.beat("baseline-in", { at: 0.3, description: "基准虚线先立：参照物先于数据" });
  s.beat("bar-in", { at: 1.2, description: "68% 条从 0 长到基准的 68% 处" });
  const X100 = LEFT + W100;
  for (let i = 0; i < 4; i++) {                        // 100% 竖虚线：4 段小 rect
    s.rect(`dash-${i + 1}`, { width: 5, height: 40, fill: "#8b8ba7", opacity: 0.7,
      at: { x: X100, y: Y_A - 150 + i * 100 },
      enter: { effect: "fade", duration: 0.3, delay: 0.3 + i * 0.08 } });
  }
  s.text("base-tag", "100%", { size: 26, font: "monospace", color: "#8b8ba7",
    at: { x: X100, y: Y_A + 90 }, enter: { effect: "fade", duration: 0.3, delay: 0.5 } });
  s.rect("bar-pct", { width: W_P, height: BAR_H, fill: "#38bdf8", radius: 8,
    at: { x: LEFT + W_P / 2, y: Y_A },
    enter: { effect: "wipe", duration: 1.2, delay: 1.2, easing: "easeOutCubic" } });
  s.text("v-pct", "68.4%", { size: 40, weight: 700, font: "monospace", color: "#38bdf8",
    at: { x: LEFT + W_P + 80, y: Y_A }, enter: { effect: "fade", duration: 0.4, delay: 2.2 } });
  s.text("gap-tag", "32% to goal", { size: 34, weight: 600, color: "#f59e0b",
    at: { x: LEFT + (W_P + W100) / 2, y: Y_A - 90 },
    enter: { effect: "fade", duration: 0.4, delay: 2.8 } });   // 缺口标注：差多少到基准
});
```

基准线纪律：**参照物先于数据**（虚线 0.3s 立、条 1.2s 长——倒过来就是先下结论后给参照）；超基准分段时超出段更亮而非更大（高度不变、fill 提亮，+8% 亮度足够读出差）；缺口标注（"32% to goal"）写在缺口中点，这比 delta 括线更适合「还差多少」的叙事。

Recipe 4——竖版 9:16 双条（feed 版）：条改为**纵向**（自底向上长），slot 横向固定，delta 括线改横向：
（纵向条画法走 data-motion 的 slide-up + mask 总则；这里给版式换算。）

```ts
const BASE = 1560;                                     // 纵向基线 y（安全区之上）
v.scene("compare-v", { duration: 5.4, background: "#0a0a12" }, (s) => {
  s.beat("v-before", { at: 0.3, description: "竖版：before 左条先长" });
  s.beat("v-after", { at: 1.8, description: "after 右条爆发" });
  const BW = Math.round(3.3 * 300), AW = Math.round(1.9 * 300);
  s.rect("bar-before", { width: 160, height: BW, fill: "#475569", radius: 8,
    at: { x: 400, y: BASE - BW / 2 },
    enter: { effect: "slide-up", duration: 1.2, delay: 0.3, easing: "easeOutCubic",
      params: { distance: BW } } });
  s.rect("mask-before", { width: 360, height: 260, fill: "#0a0a12",
    at: { x: 400, y: BASE + 130 } });                  // 遮罩：条从基线长出（data-motion 总则）
  s.rect("bar-after", { width: 160, height: AW, fill: "#22c55e", radius: 8,
    at: { x: 680, y: BASE - AW / 2 },
    enter: { effect: "slide-up", duration: 1.2, delay: 1.8, easing: "easeOutExpo",
      params: { distance: AW } } });
  s.rect("mask-after", { width: 360, height: 260, fill: "#0a0a12",
    at: { x: 680, y: BASE + 130 } });
  s.text("v-before", "3.3s", { size: 36, weight: 700, font: "monospace", color: "#94a3b8",
    at: { x: 400, y: BASE - BW - 70 }, enter: { effect: "fade", duration: 0.4, delay: 1.3 } });
  s.text("v-after", "1.9s", { size: 36, weight: 700, font: "monospace", color: "#22c55e",
    at: { x: 680, y: BASE - AW - 70 }, enter: { effect: "fade", duration: 0.4, delay: 2.8 } });
  s.text("delta", "-42%", { size: 60, weight: 800, font: "monospace", color: "#f59e0b",
    at: { x: 540, y: 420 },
    enter: { effect: "scale-pop", duration: 0.4, delay: 3.2, easing: "easeOutBack" } });
});
```

竖版纪律：mask 声明在条**之后**（painter's order，data-motion 死规矩）；delta 上移到 420（竖版视线中上区，条顶之上）；纵向条的值标签在**条顶之上** 70px（不是条端右）。

Recipe 5——多指标排队（metric queue）：用户要对比 2-3 组指标时，不是同屏塞六条——是**同几何串行多景**，每景一对双条、错峰只换值与标题：
（几何常量（LEFT/BAR_H/Y_B/Y_A）提到场景外定义一次，三景共用——与 chart-race 的 slot 冻结同一纪律。）

```ts
const QUEUE = [
  { metric: "P95 PREVIEW", before: "3.3s", after: "1.9s", bw: 990, aw: 570, delta: "-42%" },
  { metric: "COST / RENDER", before: "$0.42", after: "$0.26", bw: 840, aw: 520, delta: "-38%" },
];
for (const [qi, q] of QUEUE.entries()) {
  v.scene(`pair-${qi + 1}`, { duration: 5.0, background: "#0a0a12" }, (s) => {
    s.beat("q-before", { at: 0.3, description: `${q.metric}：before 先长` });
    s.beat("q-delta", { at: 3.2, description: "括线落锤后进下一对" });
    s.text("title", `${q.metric}, BEFORE -> AFTER`, { size: 44, weight: 800,
      letterSpacing: 3, color: "#f8fafc", at: { x: "50%", y: 240 },
      enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
    s.rect("bar-before", { width: q.bw, height: BAR_H, fill: "#475569", radius: 8,
      at: { x: LEFT + q.bw / 2, y: Y_B },
      enter: { effect: "wipe", duration: 1.2, delay: 0.3, easing: "easeOutCubic" } });
    s.text("v-before", q.before, { size: 40, weight: 700, font: "monospace", color: "#94a3b8",
      at: { x: LEFT + q.bw + 80, y: Y_B }, enter: { effect: "fade", duration: 0.4, delay: 1.3 } });
    s.rect("bar-after", { width: q.aw, height: BAR_H, fill: "#22c55e", radius: 8,
      at: { x: LEFT + q.aw / 2, y: Y_A },
      enter: { effect: "wipe", duration: 1.2, delay: 1.8, easing: "easeOutExpo" } });
    s.text("v-after", q.after, { size: 40, weight: 700, font: "monospace", color: "#22c55e",
      at: { x: LEFT + q.aw + 80, y: Y_A }, enter: { effect: "fade", duration: 0.4, delay: 2.8 } });
    s.text("delta", q.delta, { size: 56, weight: 800, font: "monospace", color: "#f59e0b",
      at: { x: LEFT + q.aw + 130, y: (Y_B + Y_A) / 2 },
      enter: { effect: "scale-pop", duration: 0.4, delay: 3.2, easing: "easeOutBack" } });
  });
  if (qi === 0) v.transition("crossfade", { duration: 0.4, between: ["pair-1", "pair-2"] });
}
```

排队的纪律：每对一景、同几何（LEFT/Y_B/Y_A 全片不变——crossfade 换的是值，不是坐标）；两对之间 crossfade 0.4s（快切会丢「同一把尺」的错觉）；三对是上限，第四对去 data-dashboard 排 trend 幕。
队尾加一景总结（结论句 + 两个 delta 并排静态复现）是加分项，不是必选项。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——标题或静态 halo 保住 frame-0 ink；纯黑开场即违例。
- `expect(frame(30)).toContainText("PREVIEW P95")`——1s 钩子，标题先于条。
- before 门：`toHaveLayers("bar-before", "v-before", "l-before")`；v-before 逐字符等于用户旧值。
- after 门：`toHaveLayers("bar-after", "v-after", "l-after")`；after 的 wipe delay > before 落定时刻（先后即叙事的断言形态）。
- 括线门：`toHaveLayers("bracket", "bracket-cap-t", "bracket-cap-b", "delta")`；delta 带符号、口径标注在旁（"-42%" 或 "+3pt"，不裸写数字）。
- 基准门（Recipe 3）：`toHaveLayers("dash-1", "dash-4", "base-tag", "bar-pct", "gap-tag")`；虚线 fade 完成 < 条 wipe 开始（参照物先于数据）。
- 竖版门（Recipe 4）：mask 层名存在且声明顺序在条后；全部文字 y <= 80% 画幅（平台 UI 区红线）。
- `noTextOverflow()` 全景；`durationBetween(4.5, 8)`；最后 0.8s 无新入场。
- 同 scale 门（人工）：两条用同一映射常量（代码里一个 scale 变量），两个魔法数字并列就是各画各的谎。
- 静音规则：两值 + delta + 结论句静音可读；「少了 42%」这层意思不许依赖配音才成立。

## Anti-patterns

- 双条同时生长——并列陈列没有叙事；先后长（0.3s / 1.8s 错峰）才是「因为改了，所以变了」。
- 各画各的 scale——before 用 300、after 用 500，视觉上 after 更短但值更大；一个 scale 变量是诚实底线。
- 截断坐标轴不标注——条不从 0 起就要在屏上写明（data-motion 同款规则）；本体裁的条默认从基线起。
- delta 裸写数字不带符号与口径——"-42%" 与 "+3pt" 是两种话；42% 一个光数字是谜语。
- 括线压在条上——括线在条端外 24px；压条读作「测量工具挡住被测物」。
- 结论句引入图外数字——图上只有 3.3s -> 1.9s，结论句写 "half the team's time" 就是调包（chart-story 同判）。
- 三条以上同屏——第三个指标是第二个场景；双条的「双」是版式也是论点。
- 竖版忘 mask——纵向 slide-up 的条会从画布底缘滑入而不是从基线长出（data-motion 的 mask 总则，竖版最容易忘）。
- before 用 accent 色——accent 永远留给 after（新值、变化、结论）；旧值是灰的。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 单指标 before/after 双条 | 本技能 | 「变了多少」 |
| X vs Y 多回合 PK | comparison | 整体对比与裁决 |
| 名次竞速（多实体多时刻） | chart-race | 「赛」 |
| 条形画法总则（mask、easing 语义） | data-motion | 画法地基 |
| 双值各自的计数微节奏 | kpi-countup | 值标签照抄其合同 |
| 三组以上指标并置 | data-dashboard / infographic | 编排与版式 |

接出本技能时带走三样：先后即叙事的错峰、同 scale 变量、括线绑 after 端。差值口径（相对% vs pt）在交付说明里写死。
