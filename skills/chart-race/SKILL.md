---
name: chart-race
version: 0.1.0
description: 条形图竞赛动画——帧内层窗换条长的连续竞速、头名易主交换窗、领先者色带追踪与年份时间轴推进；管「赛」的动效。
trigger: The user asks for an animated bar race where ranks swap and bars overtake each other live, with a leader ribbon tracking the top and a year scrubber pushing the timeline forward.
---

# Chart Race

Goal: 横向条形竞速动画（1920x1080、30fps、12-20s）——条在帧内「长过」对手、头名易主走交换窗、领先者色带只认第一名、底部年份轴逐帧推进，终帧落在一句结论上。
分工边界：chart-story 管单图四幕叙事与**冻结几何的帧轮播 bar race**（离散 crossfade、帧内无动效）；data-motion 管条形画法总则（遮罩顺序、easing-to-semantics 表）；本技能管**连续竞速的动效**——帧内层窗换条长、交换窗节奏、色带追踪、scrubber 推进。
数据纪律：年份之间绝不插值——用户给 2019 与 2024 就只做这两帧，中间年份的值是编造。
竞速体裁的诚实门槛比普通图表高：观众会逐帧比对的不是美学，是名次。

## Workflow

1. 收集四件事，缺了就问：
   - 数据集：每个时间点的**完整排序列表**（标签 + 值 + 单位），不是一个起止值；
   - 时间点标签（年份/季度，>= 2 个）；
   - 头名易主剧本：哪几帧发生换帅（从数据推，不从戏剧性推）；
   - 结论句（一句话，值必须从图里读得出来——chart-story 同款规则）。
2. `storyboard.plan { intent: "bar race · <topic>", durationSeconds }` -> 帧 scene 序列（每时间点一景）+ 终帧结论景。
   每帧 2.2-2.8s；帧数 = 时间点数；总长 12-20s，超了砍时间点（不是加速帧）。
   帧名用 `race-<year>`（chart-story 同款命名），终帧名固定 `finale`——QA 断言靠名字寻址。
3. 写 `src/video.ts`（Recipes）：
   - slot 几何一次计算、全片复用——slot 是名次位不是数据名（`bar-1` 永远是当前第一名）；
   - 条长 = `round(value x scale)`，映射写在注释里（data-motion 规则）；
   - 值标签放条端右侧，`font: "monospace"`（kpi-countup 的抖动规则同样适用）。
4. 交接窗纪律：相邻帧 `crossfade 0.45s`；帧内的条长变化用**层窗换条**（Recipe 2）——旧长条淡出、新长条 wipe 入，同 slot 叠印。
   引擎真值：DSL v1 无逐帧位移、无逐帧改值——「超车」是叠印错觉，几何冻结是错觉成立的前提。
5. `compile.run` -> 0 errors -> `check.overflow`——最长值标签在条端右侧是本体裁 overflow 户（4 位值 + 单位约 130px，条短时标签顶到画布右缘）。
6. `render.preview` 三个时刻：交接中点（0.22s 处两层叠印各半，可读性不许崩）、每帧定格帧、终帧结论。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 修 slot 漂移；`transaction.rollback` 兜底批量误改）-> `render.final`，交付附帧数、时间点清单与结论句。
   交付说明里写清「哪几帧发生头名易主」——这是用户核对剧本的钩子。

单帧节奏合同（scene-local，每帧照抄）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| year tag | 0.1s | `fade` | 0.3 | 0.4s |
| bars（slot-1..N） | 0.2s | `wipe` | 0.9 | 1.1s |
| 值标签（条端） | 1.3s | `fade` | 0.4 | 1.7s |
| leader 色带 + 签 | 1.4s | `slide-left` | 0.4 | 1.8s |
| hold | - | - | - | >= 0.6s（帧尾静止） |

交接窗读感表（相邻帧之间）：

| 交接写法 | 读感 | 判定 |
| --- | --- | --- |
| `crossfade 0.45s` + slot 冻结 | 超车 | 默认 |
| `cut` | 换台 | 禁（丢掉「赛」的连续感） |
| `crossfade >= 0.8s` | 渐变拖沓 | 仅帧 >= 2.8s 的慢速版 |
| slot 几何漂移 | 跳图 | 死罪（chart-story 同判） |
| `fade-black` | 世界重启 | 禁 |

## Recipes

引擎真值三条（竞速全部动效的地基，先背再写）：

- 无逐帧位移、无逐帧改值——一切「动」来自层窗（in/out）叠印与 enter/exit；
- `wipe` 是横条生长的唯一合法效果（从左往右揭示宽度）；
- 叠印错觉成立的前提是几何冻结——slot 错一格，错觉变跳图。

Recipe 1——单帧骨架（横条竞速的标准帧）：三条横条从左 wipe 生长、slot 由名次决定、值标签在条端、色带贴第一名。
条长映射：`w = round(hours x 56)`，注释里写死（data-motion 的诚实规则）：

```ts
const SLOT_Y = [420, 560, 700];                      // slot-1/2/3 的纵向位，全片冻结
const LEFT = 520;                                    // 条左缘（label 区右侧）
const ROWS = [                                        // 本帧排序：slot i = rank i
  { label: "RENDER", value: 7, unit: "h" },
  { label: "TEST", value: 4, unit: "h" },
  { label: "BUILD", value: 2, unit: "h" },
];
v.scene("race-2019", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("frame-land", { at: 0.2, description: "同版式新排序，第一名在 slot-1" });
  s.text("year", "2019", { size: 44, weight: 700, font: "monospace", color: "#94a3b8",
    at: { x: 260, y: 180 }, enter: { effect: "fade", duration: 0.3, delay: 0.1 } });
  for (const [i, r] of ROWS.entries()) {
    const w = Math.round(r.value * 56);              // w = round(hours x 56)
    s.rect(`bar-${i + 1}`, { width: w, height: 88, fill: i === 0 ? "#f59e0b" : "#38bdf8",
      radius: 8, at: { x: LEFT + w / 2, y: SLOT_Y[i] },
      enter: { effect: "wipe", duration: 0.9, delay: 0.2 + i * 0.12, easing: "easeOutCubic" } });
    s.text(`label-${i + 1}`, r.label, { size: 32, color: "#94a3b8", align: "right",
      at: { x: LEFT - 60, y: SLOT_Y[i] },
      enter: { effect: "fade", duration: 0.3, delay: 0.2 + i * 0.12 } });
    s.text(`v-${i + 1}`, `${r.value}${r.unit}`, { size: 36, weight: 700, font: "monospace",
      color: "#e2e8f0", at: { x: LEFT + w + 80, y: SLOT_Y[i] },
      enter: { effect: "fade", duration: 0.4, delay: 1.3 + i * 0.1 } });
  }
  s.rect("leader-ribbon", { width: 10, height: 88, fill: "#f59e0b", radius: 5,
    at: { x: LEFT - 24, y: SLOT_Y[0] },
    enter: { effect: "slide-left", duration: 0.4, delay: 1.4, easing: "easeOutCubic" } });
  s.text("leader-tag", "LEADER", { size: 24, weight: 800, letterSpacing: 3, color: "#f59e0b",
    at: { x: LEFT - 24, y: SLOT_Y[0] - 74 },
    enter: { effect: "fade", duration: 0.3, delay: 1.5 } });
});
```

值标签的 x 绑在**条端**（LEFT + w + 80）而不是 slot 固定位——条长变了标签跟着走，这是「长过对手」读感的一半；另一半在 Recipe 2。

Recipe 2——帧内换条长（连续竞速的引擎核心）：同 slot 两条层，旧长条在 t 时刻淡出、新长条同刻 wipe 入。
观感：条原地变长 = 超车瞬间，不需要换场景。用于「一帧内值在涨」的赛段（如季度推进）：

```ts
const t = 1.6;                                        // 换长时刻：帧中段，定格前后各留呼吸
const W_OLD = Math.round(4 * 56), W_NEW = Math.round(8 * 56);   // TEST 条：4h -> 8h
v.scene("overtake", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("overtake", { at: t, description: "slot-2 原地翻倍，长过 slot-1" });
  s.rect("bar-2-old", { width: W_OLD, height: 88, fill: "#38bdf8", radius: 8,
    at: { x: LEFT + W_OLD / 2, y: SLOT_Y[1] }, in: 0.2, out: t + 0.45,
    enter: { effect: "wipe", duration: 0.9, delay: 0.2, easing: "easeOutCubic" },
    exit: { effect: "fade", duration: 0.45 } });     // 旧长淡出
  s.rect("bar-2-new", { width: W_NEW, height: 88, fill: "#38bdf8", radius: 8,
    at: { x: LEFT + W_NEW / 2, y: SLOT_Y[1] }, in: t,
    enter: { effect: "wipe", duration: 0.9, easing: "easeOutExpo" } });   // 新长爆发入
  s.text("v-2-new", "8h", { size: 36, weight: 700, font: "monospace", color: "#e2e8f0",
    at: { x: LEFT + W_NEW + 80, y: SLOT_Y[1] },
    enter: { effect: "fade", duration: 0.4, delay: t + 0.9 } });          // 新值标签等条长完
});
```

三条纪律：旧条 `exit fade` 与新条 `wipe in` 同刻发枪（错 0.1s 就露叠印破绽）；新条 `easeOutExpo` 是「爆发超车」的语气（data-motion 语义表）；新值标签必须等新条 wipe 完（t + 0.9）再 fade——标签先到而条没长完，观众读到假状态。

Recipe 3——年份时间轴推进：底部 track + 每帧一个年份 tick + 进度 fill 分段 wipe。
scrubber 是「时间在走」的唯一持续提示，跨帧在场（每场景声明同几何）：

```ts
const YEARS = ["2019", "2021", "2024"];
const TX = 520, TW = 1080, TY = 880;                 // 轨道几何，全片冻结
v.scene("race-2019", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("scrub", { at: 0.1, description: "年份轴在场，当前年高亮" });
  s.rect("track", { width: TW, height: 4, fill: "#334155", radius: 2,
    at: { x: TX + TW / 2, y: TY } });                // 无 enter：frame-0 ink
  YEARS.forEach((y, i) => {
    const x = TX + (i * TW) / (YEARS.length - 1);
    const now = y === "2019";                        // 本帧年份判定
    s.ellipse(`tick-${i + 1}`, { width: now ? 22 : 14, height: now ? 22 : 14,
      fill: now ? "#f59e0b" : "#475569", at: { x, y: TY } });
    s.text(`yr-${i + 1}`, y, { size: 26, font: "monospace",
      color: now ? "#f59e0b" : "#64748b", at: { x, y: TY + 46 } });
  });
  s.rect("fill-1", { width: 1, height: 4, fill: "#f59e0b", radius: 2,
    at: { x: TX, y: TY } });                          // 帧一：进度在 tick-1 起点
});
```

后续帧把 `fill-i` 换成上一 tick 到本 tick 的整段（`wipe 0.9s` 随帧生长）：观众看到轴上的琥珀色段逐帧铺满——时间轴推进与条形竞速同频。

Recipe 4——终帧结论（竞速的句号）：全条静（无 enter 直接到场）、头名色带常亮、结论句 blur-up，>= 0.8s 全静止：

```ts
v.scene("finale", { duration: 3.2, background: "#0a0a12" }, (s) => {
  s.beat("verdict", { at: 0.2, description: "结论句可读，全图已静" });
  const FINAL = [
    { label: "TEST", value: 8, w: Math.round(8 * 56) },
    { label: "RENDER", value: 5, w: Math.round(5 * 56) },
    { label: "BUILD", value: 2, w: Math.round(2 * 56) },
  ];
  for (const [i, r] of FINAL.entries()) {
    s.rect(`bar-${i + 1}`, { width: r.w, height: 88, fill: i === 0 ? "#f59e0b" : "#38bdf8",
      radius: 8, at: { x: LEFT + r.w / 2, y: SLOT_Y[i] } });   // 静：无 enter
    s.text(`v-${i + 1}`, `${r.value}h`, { size: 36, weight: 700, font: "monospace",
      color: "#e2e8f0", at: { x: LEFT + r.w + 80, y: SLOT_Y[i] } });
  }
  s.text("conclusion", "TEST overtook RENDER by 2024", { size: 52, weight: 700,
    color: "#f8fafc", at: { x: "50%", y: 200 },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.6 } });
});
```

结论句里的每个数字必须能在图上找到（"8h"、"2024" 都是图内值）——终帧引入图外数据是本体裁的诱饵调包，chart-story 与 data-dashboard 同判。

Recipe 5——起跑格开场（竞速的钩子）：首帧前 0.8s 全员等长（同宽暗色条）+ 起跑线，然后各条才 wipe 到真长。
引擎真值：等长条是独立的一组层（`grid-*`），与真值条同 slot 叠印；`out` 窗口在发枪时刻统一关闭：

```ts
v.scene("race-2019", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("grid", { at: 0.15, description: "起跑格：全员等长，发枪前 0.8s" });
  s.beat("go", { at: 0.9, description: "发枪：等长条退场，真值条起跑" });
  const GRID_W = 120;                                 // 起跑格宽度：全员的同一读数
  for (let i = 0; i < 3; i++) {
    s.rect(`grid-${i + 1}`, { width: GRID_W, height: 88, fill: "#1e293b", radius: 8,
      at: { x: LEFT + GRID_W / 2, y: SLOT_Y[i] }, in: 0.15, out: 0.9,
      enter: { effect: "fade", duration: 0.3, delay: 0.15 + i * 0.08 } });
  }
  s.rect("start-line", { width: 6, height: 420, fill: "#475569", radius: 3,
    at: { x: LEFT + GRID_W + 12, y: SLOT_Y[1] }, in: 0.15, out: 0.9 });   // 起跑线同窗口退场
  // ……真值条（Recipe 1 的 for 循环）delay 全部从 0.9 起算：0.9 + i x 0.12
});
```

起跑格的纪律：等长条与真值条**同 slot 同高**（叠印才无缝）；发枪时刻统一（`out: 0.9` 三条一律）；起跑线随格同退。
首帧有钩子（全员列阵）但没数据——钩子 0.8s 内必须结束，真值条 1.1s 起跑，帧预算不变。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——轨道 track 无 enter，frame-0 ink 由它承包（起跑格版由 grid-1 承包，轨道退居二线）。
- 起跑格门（Recipe 5）：`toHaveLayers("grid-1", "grid-2", "grid-3", "start-line")`；0.9s 后等长条全部退场（`out` 统一），残留一条就是「幽灵赛手」。
- 每帧定格帧：`toContainText` 命中当年年份与全部值标签（含单位）；值与用户数据逐字符一致（monospace 标签，无四舍五入漂移）。
- slot 几何门：每景 `toHaveLayers("bar-1", "bar-2", "bar-3", "leader-ribbon", "track")`；`bar-1` 的 y 必须等于 SLOT_Y[0]——漂移即跳图。
- 头名门：`leader-ribbon` 的 y 与 `bar-1` 同值（色带只贴第一名）；一帧内头名易主 <= 1 次（换帅两次观众数不过来）。
- Recipe 2 的换长门：`toHaveLayers("bar-2-old", "bar-2-new", "v-2-new")`；`v-2-new` 的 fade delay >= t + 0.9（标签等条长完）。
- 交接门：相邻帧恰一次 `crossfade 0.45s`；`noTextOverflow()` 全景；值标签 x <= 1840（条端右侧留 80px 呼吸）。
- `durationBetween`：每帧 2.2-2.8s、终帧 2.8-3.5s、总 12-20s；终帧最后 0.8s 无新入场。
- 静音规则：年份 + 值 + 结论句静音可读；配乐版才考虑 `v.audio`，节拍对齐帧边界（2.6s/帧 对 116 BPM 半拍不齐，宁可不卡）。
- 四条以上竞速：slot 间隔从 140 压到 110、条高从 88 降到 72、错峰从 0.12 缩到 0.08；值标签只标前三名（其余跟趋势不跟数）。
- 帧数门：时间点 <= 6（6 帧 x 2.6s = 15.6s 已近预算上限）；更多时间点先问用户要不要砍。
- 命名门：帧名一律 `race-<year>`、终帧 `finale`——QA 断言靠名字寻址，帧名成了数据接口。
- 交付门（人工）：帧数、时间点清单、易主剧本、结论句四样写进交付说明，缺一样用户没法核对。

## Anti-patterns

- 年份间插值——用户给 2019 与 2024，就只有这两帧；2021 的值是编的，竞速视频的数字会被逐帧比对。
- 一帧两次头名易主——「赛」的张力来自一次换帅一帧；双换帅读成闪烁。
- slot 几何漂移——条位置动了，crossfade 读成新图不是新名次；几何一次算好全片复用（chart-story 死罪同款）。
- 无结论的轮播——竞速是过程不是观点；终帧一句结论是本体裁的最低交付物。
- 色带跟着旧头名走——换帅帧里 ribbon 必须贴新 slot-1；贴旧王是叙述谎言。
- `cut` 交接帧——硬切换台丢了连续感；`crossfade 0.45s` 是交换窗的全部答案。
- 值标签先于条长完——标签与新值同步入场是假状态；标签永远等条（Recipe 2 纪律三条）。
- 拿本技能做单图四幕叙事——establish/annotate/reveal/takeaway 是 chart-story 的四幕；这里只有「赛」。
- 起跑格拖过 1.2s——钩子是钩子不是正片；发枪晚一分钟，观众已经划走。
- 双指标竞赛共用一套值标签位——上下两值各自贴各自条端，共用一位必撞。

## 链路与交接

变体速查（常见需求 -> 处理法，都在本技能内解决）：

| 需求 | 处理法 | 参考 |
| --- | --- | --- |
| 四条以上同场竞速 | 条高 72、slot 间隔 110、只标前三值 | QA gates 条目 |
| 双指标竞赛（量 vs 率） | 同 slot 双色双条（叠半高 44px），值标签分居条端上下 | Recipe 1 变体 |
| 倒放（从终局倒回起点） | 帧序列倒序 + 交接窗不变；结论句放首帧 | storyboard 重排 |
| 循环 gif 版 | 终帧尾接回首帧，走 gif-loop | 链路表 |
| 只有两个时间点 | 两帧 + 终帧合并（第二帧即 finale，结论句同景） | 预算重算 |
| 要音效发枪 | `v.audio` 挂一记短音效在发枪时刻 0.9s，音画同点 | Recipe 5 |

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 连续竞速（帧内换长、色带、scrubber） | 本技能 | 「赛」的动效 |
| 离散帧轮播（冻结几何 crossfade） | chart-story | 帧内无动效的静态重排 |
| 单图四幕叙事 | chart-story | establish -> takeaway |
| 条形画法（遮罩、easing 语义、值标签） | data-motion | 画法总则，竞速照抄 |
| 头名数值的计数微节奏 | kpi-countup | 终帧大数字计数可搭一景 |
| 竖屏版竞速 | short-video + aspect-reframe | 重锚后 slot_Y 重算，规则不变 |
| 单指标前后对比（不是竞速） | stat-bars | 两条不用赛 |
| 环形进度叙事 | progress-story | 环不是条 |

接出本技能时带走三样：slot 冻结纪律、交换窗 0.45s、值标签等条长完。时间点清单与结论句在交付说明里原样复述。
竞速是数字体裁里最容易被逐帧比对的一种——诚实纪律优先于一切动效。
