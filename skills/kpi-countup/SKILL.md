---
name: kpi-countup
version: 0.1.0
description: 单个大数字计数动画的微节奏——字宽抖动修法、缓动打字语气、位数定时表与结束定格三件套；只管「一个数字怎么数」。
trigger: The user asks how one big number should count up on screen - roll feel, easing choice, duration by digit count, and the frozen settle frame.
---

# KPI Count-up

Goal: 一个大数字从零数到目标值的微节奏——位数决定时长（1.0-1.4s），等宽字型与锚点策略决定字位不抖，缓动曲线决定「数的语气」，结尾 >= 0.8s 定格决定可信度。
分工边界：data-dashboard 管看板叙事（哪个数字先落地、hero -> duo -> trend 三幕节奏）；data-motion 管图表与计数层的画法总则；本技能只管**一个数字本身**——字宽抖动、缓动选择、格式排版、定格收束。
目标值永远来自用户：缺了就问，不编、不凑整、不替用户换单位；本体裁的数字会被截图引用回公司群，写错一个逗号都是事故。

## Workflow

1. 收集三件事，任何一样缺失就问、占位"[N]"直到用户给出：
   - 目标值与**格式**（"12,847" 还是 "12847"，小数几位，带不带 %/$/s 后缀）；
   - 数字的身份句 label（<= 14 字，全大写配 letterSpacing 3-6）；
   - 可选 delta（必须带符号，正负都接受；没有就不做 delta 层，别硬凑）。
2. `storyboard.plan { intent: "count-up · <label>", durationSeconds }` -> 收敛为单场景单焦点：label -> number -> suffix -> delta -> hold。
   一屏只数一个数；两个数字要同时数是 data-dashboard 的 duo 节奏，本技能不管多数字编排。
3. 写 `src/video.ts`（Recipes）：数字层必须 `font: "monospace"`；锚点二选一——「左锚零漂移」（Recipe 1，默认）或「固定位逐列落定」（Recipe 2）。
   proportional 字体 + 居中 typewriter 的组合直接禁（字宽抖动，见 Anti-patterns 第一条）。
4. 按位数定时表选 duration（下表）；小数每多一位 +0.1s。
   读感校准：更短像闪现（观众没跟上），更长像老虎机（3s+ 是赌场不是汇报）。
   位数同时也是 QA 断言的一部分：位数错 = 数字错，`toHaveLayers` 里逐列点名（Recipe 2 的 d-0..d-4）。
5. `compile.run` -> 0 errors -> `check.overflow`——170px 大数字是本体裁的 overflow 重灾区：
   6 位含千分位约宽 6 x 0.6 x 170 = 612px（安全）；8 位以上先降字号（每减 10px 宽度省 ~48px），再谈别的。
6. `render.preview` 两个时刻：
   - 计数中段（0.8-1.2s）——逐帧看数字重心是否横向漂移，这是本技能存在的理由；
   - 定格帧——数字、suffix、delta 三件全齐、无新入场、glow 不抢字；
   - 竖版另加一帧 80% 高度检查——平台 UI 遮挡区（底部 20%）内不得有任何文字。
7. QA gates -> `test.run` -> repair loop <= 3（`scene.modify` 微调 delay 与字号）-> `render.final`。
   交付时把目标值与格式**原样复述**给用户："12,847" 不能交付成 "12847"。

数字微节奏合同（scene-local，每个计数块照抄）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| label | 0.2s | `fade` | 0.5 | 0.7s |
| number | 0.4s | `typewriter`（语气表选 easing） | 1.0-1.4s（位数表） | 1.8s |
| suffix | 1.9s | `fade` | 0.3 | 2.2s |
| delta chip | 2.3s | `scale-pop`（easeOutBack） | 0.4 | 2.7s |
| hold | - | - | - | >= 0.8s 无新入场 |

缓动 = 打字语气。typewriter 只改字符出现的节奏、不改数值——中途看到的前缀永远低于真值，无编造风险；但节奏本身就是语气：

| easing | 读感 | 用于 |
| --- | --- | --- |
| `linear` | 匀速、机械、老实 | 累计值、里程表、库存 |
| `easeOutCubic` | 先冲后缓，落得住 | 默认：绝大多数 KPI |
| `easeOutExpo` | 前 0.3s 冲到九成 | 破纪录、里程碑、爆点数（Recipe 4） |
| `easeOutBack` | 末字回弹，像口吃 | 禁用于数字层（节奏怪、QA 不稳） |

位数 -> 时长 -> 字号速查（1080p 横版；9:16 竖版走 short-video 边距再缩一档字号）：

| 位数 | duration | 建议字号 | 例 |
| --- | --- | --- | --- |
| 1-3 位 | 1.0s | 200-240 | "96"、"412" |
| 4-5 位 | 1.2s | 170-200 | "8,412" |
| 6 位 | 1.4s | 150-170 | "128,470" |
| 7 位+ | 1.4s + 每位 +0.05s，上限 1.8s | <= 130 | "1,204,896" |
| 带小数 | +0.1s/小数位 | 同位数档 | "68.4%" |

格式排版规则（数值在层里怎么写，全由用户格式决定，Agent 不改写）：

| 输入形态 | 层内写法 | 备注 |
| --- | --- | --- |
| 12,847 | 原样，千分位保留 | 逗号占一格等宽列 |
| 68.4% | 原样，百分号同行 | "%" 与数字同层，别拆 |
| 1.9s | 原样 | 单位短就跟数字同层 |
| 12,847 renders | 拆两层 | 长后缀走 suffix 层（Recipe 3） |
| $1.2M | 原样 | 货币符占一格，monospace 下与数字同宽 |
| 1,142 sessions | 拆两层 | 同上：后缀词长就走独立层 |
| "96" 带引号 | 去引号入层 | 引号是文案不是数字格式；label 里已有语境 |

## Recipes

Recipe 1——左锚零漂移计数（默认配方）。引擎真值：居中锚定的 typewriter 每敲一个字，已敲前缀整体平移半格——等宽字体下是均匀步进，proportional 下是不规则跳动；左锚 + 按**最终串长**预算起点后，敲字只向右生长，全程零漂移：

```ts
const VALUE = "12,847";                              // 用户给的，格式原样保留
const SIZE = 170, ADV = SIZE * 0.6;                  // 等宽 advance ~= 0.6 em
const LEFT = 960 - ((VALUE.length - 1) * ADV) / 2;   // 按最终串长预算左锚，视觉仍居中
v.scene("count", { duration: 4.2, background: "#0a0a12" }, (s) => {
  s.beat("count-open", { at: 0.2, description: "label 可读于 1s" });
  s.beat("settle", { at: 1.8, description: "数字定格，suffix 与 delta 随后落地" });
  s.ellipse("glow", { width: 1100, height: 520, fill: "#22d3ee", opacity: 0.12, blur: 150,
    at: { x: "50%", y: "44%" } });                   // frame-0 ink，无 enter
  s.text("label", "WEEKLY RENDERS", { size: 40, weight: 700, letterSpacing: 5, color: "#94a3b8",
    at: { x: "50%", y: "30%" }, enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("number", VALUE, { size: SIZE, weight: 800, font: "monospace", color: "#f8fafc",
    align: "left", at: { x: LEFT, y: "46%" },
    enter: { effect: "typewriter", duration: 1.4, delay: 0.4, easing: "easeOutCubic" } });
  s.text("suffix", "renders / week", { size: 34, color: "#94a3b8",
    at: { x: "50%", y: "60%" }, enter: { effect: "fade", duration: 0.3, delay: 1.9 } });
  s.text("delta", "+38% vs last quarter", { size: 34, weight: 600, color: "#22c55e",
    at: { x: "50%", y: "70%" },
    enter: { effect: "scale-pop", duration: 0.4, delay: 2.3, easing: "easeOutBack" } });
  s.camera("push-in", { from: 1.0, to: 1.04 });      // <= 4% 的呼吸推，数字不动声色
});
```

时序账：数字 0.4 + 1.4 = 1.8s 定格，suffix 2.2s、delta 2.7s 落齐，剩余 1.5s 是阅读 hold——整段没有一个多余的动效层。
位数换成 4 位时 duration 取 1.2s，其余不动；位数表是合同不是建议。

Recipe 2——固定位逐列落定。完全免疫字体度量的做法：每位数字一个独立层，列位由等宽 advance 固定，**右起**逐列 delay，末列落定时一条 settle 扫描线横扫而过。
「个位先落」是计数轮停住的读感（完整 split-flap 翻轮属于 number-flow，这里只做轻量落定）：

```ts
const DIGITS = "12847".split("");                    // 逐列版不带千分位逗号
const SIZE2 = 150, ADV2 = SIZE2 * 0.6;
const START = 960 - ((DIGITS.length - 1) * ADV2) / 2;
v.scene("digits", { duration: 3.8, background: "#0a0a12" }, (s) => {
  s.beat("roll-settle", { at: 0.3, description: "右起逐列落定，末位 flash" });
  for (const [i, ch] of DIGITS.entries()) {
    const col = DIGITS.length - 1 - i;               // 列序从右往左：个位先落
    s.text(`d-${i}`, ch, { size: SIZE2, weight: 800, font: "monospace", color: "#f8fafc",
      at: { x: START + i * ADV2, y: "46%" },
      enter: { effect: "slide-up", duration: 0.3, delay: 0.3 + col * 0.14,
        easing: "easeOutCubic", params: { distance: 46 } } });
  }
  s.rect("settle-flash", { width: DIGITS.length * ADV2 + 40, height: 8, fill: "#22d3ee",
    radius: 4, at: { x: "50%", y: "56%" }, in: 1.4, out: 1.75,
    enter: { effect: "wipe", duration: 0.3, easing: "easeOutCubic" } });   // 一闪即走
  s.text("value-label", "WEEKLY RENDERS", { size: 40, weight: 700, letterSpacing: 5,
    color: "#94a3b8", at: { x: "50%", y: "30%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
});
```

末列 delay = 0.3 + (n-1) x 0.14 = 1.0s（5 位），flash 在 1.4-1.75s 窗口一掠——落定时刻被那条线「盖章」。
位数更长时列距缩到 0.10-0.12s，总落定别超 1.6s；逐列版没有逗号，正式交付优先 Recipe 1（格式保真）。

Recipe 3——定格三件套（收束纪律）。数字定格后**数字层不再有任何动作**；后续 0.5s 内只允许 suffix 与 delta 两个小件入场，然后 >= 0.8s 全静止。
定格是数字的句号——用独立收尾场景时，数字原样再现、无 enter：

```ts
v.scene("settle-card", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("frozen", { at: 0.1, description: "数字无 enter 直接在场——定格复述" });
  s.text("number-rest", "12,847", { size: 170, weight: 800, font: "monospace",
    color: "#f8fafc", at: { x: "50%", y: "44%" } });   // 定格：直接在，零动画
  s.text("suffix", "renders / week", { size: 34, color: "#94a3b8",
    at: { x: "50%", y: "60%" }, enter: { effect: "fade", duration: 0.3, delay: 0.1 } });
  s.text("delta", "+38% vs last quarter", { size: 34, weight: 600, color: "#22c55e",
    at: { x: "50%", y: "70%" },
    enter: { effect: "scale-pop", duration: 0.4, delay: 0.5, easing: "easeOutBack" } });
});
```

三件套入场总预算 <= 0.9s（0.1 -> 0.5 -> 0.4），剩余 >= 1.4s 全静。
若计数场景与收尾场景同用，用 `v.transition("crossfade", { duration: 0.4, between: ["count", "settle-card"] })` 连接；不要 `cut`——数字没变却硬切，观众会以为数错了。

Recipe 4——里程碑爆点（easeOutExpo）。爆点数字的语气：前 0.3s 冲到九成、后 0.7s 极慢收尾，配一次 scale-pop 的「落锤」与全屏 glow 提亮（opacity 0.12 -> 0.2 靠两层椭圆叠加实现「提亮」）：

```ts
const MILESTONE = "1,000,000";
const SIZE4 = 130, ADV4 = SIZE4 * 0.6;               // 9 格宽 -> 720px，1080p 内安全
const LEFT4 = 960 - ((MILESTONE.length - 1) * ADV4) / 2;
v.scene("milestone", { duration: 4.0, background: "#0a0a12" }, (s) => {
  s.beat("burst", { at: 0.3, description: "easeOutExpo：0.3s 冲到九成" });
  s.beat("hammer", { at: 1.5, description: "落锤 pop + glow 提亮" });
  s.ellipse("glow-base", { width: 1200, height: 560, fill: "#f59e0b", opacity: 0.10, blur: 160,
    at: { x: "50%", y: "44%" } });                   // 常亮底光
  s.ellipse("glow-boost", { width: 1400, height: 640, fill: "#f59e0b", opacity: 0.10, blur: 170,
    at: { x: "50%", y: "44%" }, in: 1.5, out: 2.6,
    enter: { effect: "fade", duration: 0.5, delay: 1.5 } });   // 叠加 = 提亮一档
  s.text("number", MILESTONE, { size: SIZE4, weight: 800, font: "monospace",
    color: "#f8fafc", align: "left", at: { x: LEFT4, y: "46%" },
    enter: { effect: "typewriter", duration: 1.1, delay: 0.3, easing: "easeOutExpo" } });
  s.text("label", "RENDERS SHIPPED", { size: 40, weight: 700, letterSpacing: 5,
    color: "#94a3b8", at: { x: "50%", y: "30%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
});
```

爆点配方的纪律：没有 delta 层（里程碑不需要环比）、没有 suffix（数字自带「达成」语气）、glow 提亮只发生在落锤时刻——全片就亮这一次，观众才知道这是爆点。

Recipe 5——竖版 9:16 计数（短视频版）。1080x1920 画幅：字号降一档（150 -> 128），label 上移到 22%，delta 收进数字下方 12% 行距，全部内容压在 short-video 的安全边距内（左右各 8%、底部 20% 留给平台 UI）：

```ts
const VALUE_V = "12,847";
const SZ = 128, ADVV = SZ * 0.6;                     // 六格宽 = 384px，竖版宽 1080 内很宽裕
const LEFTV = 540 - ((VALUE_V.length - 1) * ADVV) / 2;
v.scene("count-v", { duration: 4.0, background: "#0a0a12" }, (s) => {
  s.beat("v-open", { at: 0.2, description: "竖版钩子：label 1s 可读" });
  s.ellipse("glow-v", { width: 900, height: 700, fill: "#22d3ee", opacity: 0.12, blur: 150,
    at: { x: "50%", y: "40%" } });                   // 竖版光斑更圆、更集中
  s.text("label", "WEEKLY RENDERS", { size: 44, weight: 700, letterSpacing: 4,
    color: "#94a3b8", at: { x: "50%", y: "22%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("number", VALUE_V, { size: SZ, weight: 800, font: "monospace", color: "#f8fafc",
    align: "left", at: { x: LEFTV, y: "42%" },
    enter: { effect: "typewriter", duration: 1.4, delay: 0.4, easing: "easeOutCubic" } });
  s.text("delta", "+38% vs last quarter", { size: 40, weight: 600, color: "#22c55e",
    at: { x: "50%", y: "54%" },                      // 数字下方 12% 行：竖版视线不跨屏
    enter: { effect: "scale-pop", duration: 0.4, delay: 2.3, easing: "easeOutBack" } });
});
```

竖版纪律三条：delta 换行不换屏（观众拇指停在哪，视线就在哪）；不叠 camera 推（竖版全屏本来就满）；底 20% 是平台 UI 区，任何文字层 y 不得 >= 80%。
9:16 交付如需双版本，16:9 的场景用 aspect-reframe 的重锚表换算，别手动平移。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——glow 椭圆保住 frame-0 ink。
- `expect(frame(30)).toContainText("WEEKLY RENDERS")`——1s 钩子，label 先于数字可读。
- `expect(frame(HERO_SETTLED)).toContainText("12,847")`，HERO_SETTLED >= 0.4 + 1.4 = 1.8s scene-local；且**逐字符等于用户原值**（含千分位与百分号，格式漂移即失败）。
- 漂移门（手工 + preview）：`render.preview` 计数中段帧，数字重心横向不得逐帧跳动——优先级高于一切文本断言。
- `expect(frame(SETTLED_ALL)).toContainText("+38% vs last quarter")`，>= 2.7s scene-local；delta 必须带符号（色盲与静音自动播放的第二通道规则，同 data-dashboard）。
- Recipe 2 的逐列门：`toHaveLayers("d-0", "d-1", "d-2", "d-3", "d-4", "settle-flash", "value-label")`——列层一个都不能少，少一列就是数字位数错了。
- Recipe 4 的爆点门：`toHaveLayers("glow-base", "glow-boost", "number", "label")`；glow-boost 的 in/out 窗口 (1.5, 2.6) 之外不得提亮。
- `noTextOverflow()`（170px 六位数是本库 overflow 最大户之一）；`durationBetween(3.5, 5)`。
- 定格门：最后 0.8s 无任何层入场（末次入场 settled 2.7s + hold >= 0.8 => duration >= 3.5）。
- 静音规则：数字 + 带符号 delta 静音可读；配音版才考虑 `v.audio` 挂旁白，文本层不得因此减配。
- 竖版门（Recipe 5）：`durationBetween(3.5, 4.6)`；所有文字层 y <= 80%；字号 <= 132（六位内）。
- glow 门：椭圆 opacity <= 0.14（爆点配方的 boost 叠加后总亮 <= 0.2），光斑亮度永远输给数字一档——同 tech-intro 的「纹理不抢字」。
- 数字层 font 门：全场景 `font: "monospace"` 唯一例外是 suffix/delta 短语；label 与 suffix 用默认 sans，不是数字就不用等宽。
- 交付复述门（人工）：`render.final` 前把值抄回对话，用户确认格式后才算完成——这一步省了，格式错误要到截图发出才被发现。

## 链路与交接

本技能是「数字动效族」的叶子节点——只产出数字，不编排故事。入口与出口：

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 一个数字怎么数（抖动/缓动/定格） | 本技能 | 单数字微节奏 |
| 多数字看板叙事（hero -> duo -> trend） | data-dashboard | 编排归它，数字块照抄本文合同 |
| 图表里的计数标签 | data-motion | 条形值标签的 delay 规则归它 |
| 机场翻牌轮/里程表整机 | number-flow | 机械翻轮是它的语气 |
| 数字翻完要接金句/CTA | end-card / quote-motion | 计数场景 crossfade 出去即可 |
| 倒计时到事件 lockup | countdown | 一秒一翻的节拍器不是计数 |
| 一指标前后对比（差值叙事） | stat-bars | 条长叙事归它，数字写法归本文 |
| 环形进度里的中心百分比 | progress-story | 中心数字照抄本文合同 |

接出本技能时只带走两样：位数定时表与定格三件套。其余（编排、图表、翻轮）都有更专门的家。
位数表与定格三件套被 data-dashboard / chart-race / progress-story 引用——改这两处等于改半个数字动效族，先想清楚。

## Anti-patterns

- proportional 字体 + 居中 typewriter——每敲一字整串前缀平移半格，等宽下均匀步进、非等宽下不规则跳动；要么 monospace 左锚（Recipe 1），要么固定位逐列（Recipe 2）。
- 3s+ 老虎机或 0.4s 闪现——位数定时表是读感契约；每个数字必须在场景最后 0.8s 前完成。
- 定格阶段又给数字加动效（呼吸、微推、二次 pop）——定格之后数字层是遗照，不许动。
- 编造或「顺手凑整」目标值——12,847 不许变 13,000；占位就占位到底，交付前原样复述。
- delta 只给颜色不给符号——绿色不是语义，+/- 才是；颜色是第二通道，永远不是唯一通道。
- 同屏数两个数——焦点归零；第二个数字是 data-dashboard duo 的活，或者排队下一个场景。
- easeOutBack 用在数字层——末字回弹像口吃，且 QA 断言不稳；回弹只留给 delta chip 的 scale-pop。
- 拿本技能画图表——条形、坐标轴、遮罩顺序是 data-motion 的地盘；这里只有数字，没有图。
- 竖版沿用横版字号——150px 六位在 1080 宽里能塞下，但加上 label 与 delta 后全屏没有呼吸；竖版一律降一档。
- 给计数挂音效节拍（tick-tick-tick）却没挂对位数——配音版的 tick 频率要对得上 easing 的字符速率，配不上宁可不加；静音可读永远是底线。
