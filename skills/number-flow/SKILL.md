---
name: number-flow
version: 0.1.0
description: 数字翻牌滚动——split-flap 风格的纵向数字轮：每位一列、列内逐个翻入、中缝铰线给机械感、左到右依次定住；适合日期/票号/计数牌。
trigger: The user asks for a split-flap or odometer-style number display - digit columns rolling vertically and settling one by one from left to right, like an airport departure board.
---

# Number Flow

Goal: split-flap 风格的数字翻牌视频（1920x1080、30fps、4-8s）——每位数字一列，列内数字层用 in/out 窗口纵滚翻入（引擎真值：`exit slide-down` 向上离开 + `enter slide-up` 从下进入，countdown 的翻页机制复用），中缝铰线横 rect 提供「上下两片翻板」的机械感，各列**左到右依次定住**，定格后标签落款。
分工边界：countdown 管事件倒计时（一秒一翻的节拍器 + 事件 lockup）；kpi-countup 管单个数字的计数微节奏（typewriter 整串）；本技能管**机械翻牌轮整机**——多列、列内翻序、铰线、定住节奏。
适用面：日期、票号、版本号、序列号——「机械翻牌是本体」的场合；叙事里的计数叙事归 kpi-countup。

## Workflow

1. 收集三件事，缺了就问：
   - 目标串（逐字符入列："2026-06-06"、"VO-2042"、"v0.5.0"；连字符/点号也是列）；
   - 板面标签（"DEPARTURES"/"BUILD NO."，<= 12 字）与可选副行（上下文 <= 8 字）；
   - 音效需求（翻牌 tick 是本体裁的灵魂配音，`v.audio` 可挂；静音版必须同样成立）。
2. `storyboard.plan { intent: "number flow · <target>", durationSeconds }` -> 收敛为单场景三段：roll（各列翻入 1.8-3.2s，右列最长）-> settle（左到右定住）-> label（标签 + 副行落款）。
   单场景完成；两个目标串（日期 -> 时间）拆两景，同板面几何。
3. 写 `src/video.ts`（Recipes）：
   - 列几何：列宽 = 字号 x 0.62（monospace advance + 余量）、列距 20、板面居中；
   - 每列的翻序：从 0（或当前位的前值）翻到目标位，`窗口 = 0.28s/翻`，linear easing（机械感来自匀速，缓动是电子感）；
   - 铰线：横 rect（高 6、fill #1e293b）横贯每列槽、y = 数字行中心——「中缝」是 split-flap 的身份证明。
4. 定住节奏：列 j 的翻数 = 3 + j x 2（左列 3 翻、右列最多 9 翻）——左列先定、右列后定；全板定住 <= 场景 60% 时刻，留 >= 0.8s 定格。
   里程表语义（个位最后定）是反例：竖排板上「左定右滚」的读感更稳（视线从左收口）。
5. `compile.run` -> 0 errors -> `check.overflow`——板面是 rect 底板，数字全部在板内（overflow 风险低）；真正要盯的是列槽间距（20px 以上，铰线才不粘连）。
6. `render.preview` 三帧：翻滚中段（列间「有的定有的滚」的错落感）、右列定住帧、定格帧（铰线、标签、副行全齐）。
   自查「机械感」：翻入是匀速直上（linear），任何缓动的翻牌读作电子滚动屏，不是翻板。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调窗口与列距）-> `render.final`，交付附目标串逐字符复述（"VO-2042" 不是 "VO2042"）。

翻轮节奏合同（column-local，每列照抄）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| digit-k（列内第 k 翻） | k x 0.28s | enter `slide-up` / exit `slide-down` | 0.28 / 0.28 | 窗口边界即翻完 |
| 铰线（hinge-j） | 0（随板常驻） | 无 enter | - | 常驻 |
| 最终位层（col-j-final） | settle-j 时刻 | `fade` 0.2 收口 | 0.2 | + 0.2s |
| 板面标签 | 定住后 + 0.3 | `fade` | 0.4 | + 0.4s |
| hold | - | - | - | >= 0.8s 无新入场 |

引擎真值表（countdown 同源，本体裁的地基）：

| 写法 | 引擎行为 | 读感 | 判定 |
| --- | --- | --- | --- |
| `exit slide-down` + `enter slide-up` 同刻 | 旧位向上离开、新位从下进入 | 向上翻 | 唯一正解 |
| `exit slide-up` + `enter slide-up` | 两条同向曲线完美重叠 | 卡死叠影 | 死罪（countdown 原判） |
| 窗口边界错开 0.1s+ | 旧位未走新位已到 | 双影 | 禁 |
| easing 用 easeOutCubic | 翻入先快后慢 | 电子滚动 | 禁（linear 才是机械） |

每列滚程表（定住节奏的「谱」）：

| 列 | 翻数 | 滚程 | settle 时刻（0.28s/翻） |
| --- | --- | --- | --- |
| col-1（最左） | 3 | 0 -> 目标位 | 0.84s |
| col-2 | 5 | 0 -> 目标位 | 1.40s |
| col-3 | 7 | 0 -> 目标位 | 1.96s |
| col-4（最右） | 9 | 0 -> 目标位 | 2.52s |

## Recipes

Recipe 1——单列翻轮（引擎核心）：个位列从 0 翻到 7，七层数字同 slot 依次进出，向上滚：
（这是整机的零件——先把一列翻对，四列只是它的复制加错峰。）

```ts
const COL = { x: 760, y: 480 };                       // 列 slot：全列共用
const T = 0.28;                                       // 每翻 0.28s，linear
for (let k = 0; k <= 7; k++) {
  s.text(`d-${k}`, String(k), { size: 200, weight: 800, font: "monospace",
    color: "#f8fafc", at: { x: COL.x, y: COL.y }, in: k * T, out: (k + 1) * T,
    enter: { effect: "slide-up", duration: T, easing: "linear", params: { distance: 140 } },
    exit: { effect: "slide-down", duration: T, easing: "linear" } });
}
```

纪律三条（引擎真值的落地）：`in: k x T, out: (k+1) x T`——窗口首尾相接，翻与翻之间零空隙；enter 与 exit 同 duration 同 easing 同时刻（对不齐就双影）；`params.distance` 140 = 半个字高（翻板的「行程」，全字高会闪空）。

Recipe 2——四列整机 + 左到右定住（标准配方）：目标串 "1284"，四列各自翻序，右列滚得最久；板面、列槽、铰线一次拼装：

```ts
const TARGET = "1284";                                 // 用户目标串（占位示例）
const SZ = 190, CW = Math.round(SZ * 0.62), GAPC = 24;
const BOARD_W = TARGET.length * CW + (TARGET.length - 1) * GAPC + 96;
const BX = 960, BY = 480;                              // 板面中心
const T2 = 0.28;
v.scene("flap", { duration: 5.2, background: "#0a0a12" }, (s) => {
  s.beat("rolling", { at: 0.3, description: "四列翻入，左列先定右列久滚" });
  s.beat("all-settled", { at: 2.8, description: "右列定住，标签随后" });
  s.rect("board", { width: BOARD_W, height: 360, fill: "#111827", radius: 20,
    at: { x: BX, y: BY } });                           // 板面：frame-0 ink
  for (const [j, ch] of TARGET.split("").entries()) {
    const cx = BX - BOARD_W / 2 + 48 + CW / 2 + j * (CW + GAPC);
    const flips = 3 + j * 2;                           // 左 3 翻 -> 右 9 翻
    const goal = Number(ch);
    for (let k = 0; k < flips; k++) {
      const shown = k === flips - 1 ? goal : (goal - (flips - 1 - k) + 10) % 10;   // 末翻落到目标位
      const start = 0.3 + j * 0.2 + k * T2;
      s.text(`c${j}-d${k}`, String(shown), { size: SZ, weight: 800, font: "monospace",
        color: "#f8fafc", at: { x: cx, y: BY }, in: start, out: start + T2,
        enter: { effect: "slide-up", duration: T2, easing: "linear", params: { distance: 140 } },
        exit: { effect: "slide-down", duration: T2, easing: "linear" } });
    }
    s.rect(`hinge-${j + 1}`, { width: CW, height: 6, fill: "#1e293b", radius: 3,
      at: { x: cx, y: BY } });                        // 中缝铰线：split-flap 的身份
    s.rect(`slot-${j + 1}`, { width: CW + 8, height: 300, fill: "#0a0a12",
      opacity: 0.35, radius: 10, at: { x: cx, y: BY } });   // 列槽底色
  }
  s.text("board-label", "BUILD NO.", { size: 34, weight: 700, letterSpacing: 5,
    color: "#94a3b8", at: { x: BX, y: 720 },
    enter: { effect: "fade", duration: 0.4, delay: 2.9 } });
  s.text("sub", "release candidate 26", { size: 28, color: "#64748b",
    at: { x: BX, y: 780 }, enter: { effect: "fade", duration: 0.4, delay: 3.2 } });
});
```

时序账：右列（j=3）末翻 start = 0.3 + 0.6 + 8 x 0.28 = 3.14s——定住；标签 2.9s 起其实早了 0.3s，把 label delay 调到 3.3s 更严丝合缝（repair loop 的常见第一刀）。
`shown` 的算法：末翻必然显示目标位，倒数第二翻显示目标位 -1（回绕取模）——翻序「从下方滚上来」的数学就是倒着数到目标。

Recipe 3——铰线与列槽（机械感的另一半）：铰线不是装饰——它把每列切成「上下两片翻板」的错觉；列槽是每列的「轨道」：
（两层 rect 的叠序：列槽先声明（底）、数字层中、铰线最后（盖在中缝上）——painter's order。）

```ts
// 在 Recipe 2 的列循环里调整声明顺序（槽 -> 数字 -> 铰线）：
for (const [j, ch] of TARGET.split("").entries()) {
  const cx = BX - BOARD_W / 2 + 48 + CW / 2 + j * (CW + GAPC);
  s.rect(`slot-${j + 1}`, { width: CW + 8, height: 300, fill: "#0a0a12",
    opacity: 0.35, radius: 10, at: { x: cx, y: BY } });      // 1. 槽（最底）
  const flips = 3 + j * 2, goal = Number(ch);
  for (let k = 0; k < flips; k++) {                           // 2. 数字层（中）
    const shown = k === flips - 1 ? goal : (goal - (flips - 1 - k) + 10) % 10;
    const start = 0.3 + j * 0.2 + k * T2;
    s.text(`c${j}-d${k}`, String(shown), { size: SZ, weight: 800, font: "monospace",
      color: "#f8fafc", at: { x: cx, y: BY }, in: start, out: start + T2,
      enter: { effect: "slide-up", duration: T2, easing: "linear", params: { distance: 140 } },
      exit: { effect: "slide-down", duration: T2, easing: "linear" } });
  }
  s.rect(`hinge-${j + 1}`, { width: CW, height: 6, fill: "#1e293b", radius: 3,
    at: { x: cx, y: BY } });                                  // 3. 铰线（盖中缝）
}
```

铰线纪律：fill 用 #1e293b（比板面 #111827 亮一档、比数字暗两档——存在感靠色阶不靠尺寸）；height 6（再粗是裂缝，再细看不见）；横贯列宽但不跨列距（列与列之间的缝隙留给翻板呼吸）。

Recipe 4——定格 + tick 音效 + 竖版要领：定住后数字层静止、标签落款，配音版挂翻牌 tick（每翻一记）；竖版把板面旋转为 2x2 分行不推荐——**竖版直接缩板**（字号 190 -> 120、四列变两行两列，铰线规则不变）：

```ts
// 定格段（接 Recipe 2 场景尾部）：
s.beat("frozen", { at: 3.4, description: "全板静止，仅剩标签" });
s.rect("board-final", { width: BOARD_W, height: 360, fill: "#111827", radius: 20,
  at: { x: BX, y: BY }, in: 3.4, out: 5.2 });        // 收口重申板面（可选的定格仪式）
// 配音版：一列一轨不如整板一轨——tick 密度由翻窗自动对上
v.audio("flap-ticks", "assets/audio/split-flap-ticks.mp3", { volume: 0.7, fadeIn: 0.2 });
```

音效纪律：tick 轨是**叠加**不是依赖（静音版必须已经成立——全库通例）；音量 <= 0.7（tick 是高频噪音系，压过 BGM 就烦了）；一轨整板（四列四轨会在 0.28s 窗口里糊成一团）。
竖版要领：1080 宽装不下四列 190px（4 x 118 + 3 x 24 + 96 = 644 其实装得下，但标签与副行没地方去）——两行两列（"1284" 拆 "12"/"84"）+ 铰线每列保留；定住节奏改为**行定列滚**（上行先定）。

Recipe 5——日期翻牌（分隔符列的静态处理）：日期是 split-flap 的本命内容（机场到达牌、 release 日），但连字符列**不翻**——它是静态列，与翻列同板面共存：
（"2026-06-06" 十列中三列是静态 "-"；静态列无 in/out、无 enter，从 frame 0 就在场——板面的骨架先于数字存在。）

```ts
const DATE = "2026-06-06";                              // 用户给的日期（占位示例）
const SZD = 170, CWD = Math.round(SZD * 0.62), GAPD = 18;
const DIGITS = DATE.split("").map((ch, i) => ({ ch, i, digit: ch >= "0" && ch <= "9" }));
const BOARD_WD = DATE.length * CWD + (DATE.length - 1) * GAPD + 90;
const BXD = 960, BYD = 480, TD = 0.26;
let colIdx = 0;                                        // 翻列编号（跳过静态列）
v.scene("date-flap", { duration: 5.6, background: "#0a0a12" }, (s) => {
  s.beat("date-rolling", { at: 0.3, description: "数字列翻入，连字符列静立" });
  s.beat("date-settled", { at: 3.1, description: "末数字列定住" });
  s.rect("board", { width: BOARD_WD, height: 330, fill: "#111827", radius: 20,
    at: { x: BXD, y: BYD } });                         // 板面 frame-0 ink
  s.rect("head-strip", { width: BOARD_WD, height: 64, fill: "#1e293b", radius: 16,
    at: { x: BXD, y: BYD - 133 } });                   // 牌头条：机场牌的帽檐
  s.text("head", "RELEASE DATE", { size: 30, weight: 800, letterSpacing: 6,
    color: "#94a3b8", at: { x: BXD, y: BYD - 133 },
    enter: { effect: "typewriter", duration: 0.6, delay: 0.2, easing: "linear" } });
  for (const cell of DIGITS) {
    const cx = BXD - BOARD_WD / 2 + 45 + CWD / 2 + cell.i * (CWD + GAPD);
    s.rect(`slot-${cell.i + 1}`, { width: CWD + 8, height: 270, fill: "#0a0a12",
      opacity: 0.35, radius: 10, at: { x: cx, y: BYD } });   // 槽（最底）
    if (cell.digit) {                                   // 数字列：翻
      const j = colIdx++;
      const goal = Number(cell.ch);
      const flips = 3 + Math.min(j, 3) * 2;            // 每段内仍左定右滚
      for (let k = 0; k < flips; k++) {
        const shown = k === flips - 1 ? goal : (goal - (flips - 1 - k) + 10) % 10;
        const start = 0.3 + j * 0.15 + k * TD;
        s.text(`c${cell.i}-d${k}`, String(shown), { size: SZD, weight: 800,
          font: "monospace", color: "#f8fafc", at: { x: cx, y: BYD },
          in: start, out: start + TD,
          enter: { effect: "slide-up", duration: TD, easing: "linear", params: { distance: 130 } },
          exit: { effect: "slide-down", duration: TD, easing: "linear" } });
      }
    } else {                                            // 分隔符列：静立
      s.text(`sep-${cell.i + 1}`, cell.ch, { size: SZD, weight: 800, font: "monospace",
        color: "#64748b", at: { x: cx, y: BYD } });    // 静态：无 in/out 无 enter
    }
    s.rect(`hinge-${cell.i + 1}`, { width: CWD, height: 6, fill: "#1e293b", radius: 3,
      at: { x: cx, y: BYD } });                        // 铰线（含静态列，板面统一）
  }
});
```

日期版的纪律五条：静态列颜色降两档（#64748b——骨架不与数字抢亮度）；铰线**含静态列**照画（板面的机械身份是整板的，不是数字列专属）；翻列编号 `colIdx` 跳过静态列重排（每段「日月年」各自左定右滚，不是全串连续编号）；牌头条 typewriter 用 linear（机械打字与机械翻牌同一语气）；日期必须用户给——"2026-06-06" 是占位示例，写错日期的 release 视频是事故不是作品。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——board 底板无 enter 常驻（frame-0 ink 由板面承包）。
- 翻窗门：每列相邻翻层 `in`/`out` 首尾相接（`out[k] === in[k+1]`），零空隙零叠窗。
- 引擎门：全部翻层成对 `exit slide-down` + `enter slide-up`、同 duration 同 easing（linear）；出现 `exit slide-up` 即死罪（countdown 原判）。
- 定住门：末翻层显示目标位（`shown === goal`）；左列 settle < 右列 settle（左到右的定住谱）。
- 铰线门：`toHaveLayers("hinge-1", "hinge-2", "hinge-3", "hinge-4")`；铰线 fill 亮于板面一档（#1e293b vs #111827）。
- 板面门：`toHaveLayers("board", "board-label", "sub")`；标签 delay >= 右列 settle + 0.2s（先定住再落款）。
- 目标串门（人工 + 断言）：定格帧数字串**逐字符等于用户目标**（含连字符与点号——"2026-06-06" 的两道横杠是列）；`toContainText("1284")` 只对无分隔串有效，带分隔串逐列断。
- `noTextOverflow()`；`durationBetween(4, 8)`；hold >= 0.8s 无新入场。
- 静音规则：翻滚 + 定住 + 标签静音可读；tick 音轨是增强不是依赖。
- 交付门：目标串逐字符复述进交付说明（"VO-2042" 不是 "VO2042"——连字符丢了是交付事故）。
- 日期版门（Recipe 5）：静态列 `sep-*` 无 in/out 无 enter（有窗口即违例）；铰线十列齐全（含静态列）；牌头条 settle < 首列定住。
- 段内定住门（日期版）：每段（年/月/日）各自左定右滚，段与段的 settle 时刻不要求递增——全串连续编号是错法。

## Anti-patterns

- `exit slide-up` 配 `enter slide-up`——两条同向曲线完美重叠，翻轮卡死在双影里；唯一正解是 `exit slide-down` + `enter slide-up`（引擎真值表第一条）。
- 翻入加缓动（easeOutCubic 等）——匀速 linear 才是机械翻板；任何缓动都读作 LED 滚动屏，体裁就换了。
- 窗口边界错开——旧位未走新位已到，双影；`in`/`out` 必须首尾相接。
- 各列同时定住——「有的定有的滚」是本体裁的全部错落感；同时定住就是四根滚动条。
- 铰线比数字亮——铰线是板面家具（#1e293b 色阶），亮过数字就成了裂缝里的灯管。
- 拿本技能做倒计时——一秒一翻的节拍器 + 事件 lockup 是 countdown 的完整体裁；翻牌轮不会喊「发枪」。
- 拿本技能数 KPI——叙事计数归 kpi-countup（typewriter 整串、位数表、定格三件套）；翻牌轮是机械展示，不是叙事。
- 竖版硬塞四列——1080 宽里四列加标签没有呼吸；两行两列 + 行定列滚。
- tick 四轨并行——0.28s 窗口里四轨 tick 糊成一团；整板一轨。
- 目标串丢分隔符——连字符与点号也是列；交付复述逐字符核对。
- 日期编造——release 日期是 countdown 同级红线；占位 "2026-06-06" 仅是示例，真值必须用户给。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| split-flap / 里程表翻轮整机 | 本技能 | 机械翻牌是本体 |
| 事件倒计时（4-3-2-1 + lockup） | countdown | 一秒一翻的节拍器 |
| 叙事计数（KPI 数到目标值） | kpi-countup | typewriter + 定格三件套 |
| 日期金句 / 落款日期 | quote-motion / end-card | 翻轮可做其中一景 |
| 版本发布号翻出 | changelog | changelog 的版本场景可内嵌本配方 |
| 竖版交付 | short-video | 两行两列变体（Recipe 4 要领） |

接出本技能时带走三样：翻窗首尾相接公式、`shown` 回绕算法（倒数到目标位）、铰线色阶纪律。目标串逐字符复述是交付的最后一道门。
日期翻牌常被 changelog / end-card 内嵌为一景——几何常量提到两个技能共享的作用域，别在场景回调里重复定义。
