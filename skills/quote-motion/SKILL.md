---
name: quote-motion
version: 0.1.0
description: 横版金句动画——引号符号开场、逐词浮现的词组错峰、关键词升格与落款收束，6-10s 的 16:9 motion 版名言（quote-card 管方图卡片）。
trigger: The user wants a landscape quote animation - the quote mark opens the piece as an action, words surface one by one, and the author settles in as the signature close.
---

# Quote Motion

Goal: 横版金句动画（1920x1080、30fps、6-10s）——巨型引号**作为动作**开场（不是贴纸），词组逐词浮现（word-by-word，不是 typewriter），一个关键词升格 accent，落款（作者 + 身份 + 细线）最后收束，>= 0.8s 全静。
分工边界：quote-card 管 1:1 方形卡片（4-6s、typewriter 主文 + scale-pop 关键词、引号是静态家具）；kinetic-typography 管纯文字动能（3x 关键词、同位换词槽）；本技能管**16:9 的金句 motion**——引号开场动作、逐词浮现节奏、落款签名。
引言纪律与 quote-card 同源：verbatim，一字不改、不「润色」、不补标点。

## Workflow

1. 收集四件事，缺了就问：
   - 引言原文（verbatim，含原有换行；无自然换行就单行排）；
   - 作者名 + 可选身份行（"inventor of X" / "CFO at Y"）；
   - 关键词（一句话里**至多一个**升格词，用户点不出就自己提案再让用户确认）；
   - 氛围基调（冷/暖，定引号与关键词的 accent）。
2. `storyboard.plan { intent: "quote motion · <author>", durationSeconds }` -> 收敛为单场景五拍：mark -> words -> keyword -> byline -> hold。
   五拍全部在一个场景里完成；10s 以上的多句引言拆两景（一句一景），中间 crossfade 0.5s。
3. 写 `src/video.ts`（Recipes）：
   - 每词一个独立 text 层（`w-<i>`），词位 x 手排：词宽估 `0.56 x size x 字符数`，宁窄勿宽（窄了词距紧、宽了行溢出——前者可救后者致命）；
   - 估算后果再过 `check.overflow`；关键词层（`key`）尺寸 1.4x、accent 色，位次与同位普通词对齐；
   - 引号用 U+201C / U+201D，尺寸 260-320，opacity 0.18-0.25。
4. `compile.run` -> 0 errors -> `check.overflow`——逐词排版的行宽是本体裁 overflow 户（估宽偏差在关键词 1.4x 处放大：关键词按 0.56 x 1.4 x size x 字符数 估）。
5. `render.preview` 三帧：引号落定帧（开场动作完成）、逐词中段（波次可数、词不叠字）、落款定格（全部元素齐、无新入场）。
   自查「逐词可跟读」：stagger 0.15-0.22s 之间，词组浮现的速度正好够默读——快了是弹幕，慢了是幻灯。
6. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调词位 x 与 delay）-> `render.final`，交付附引言原文 + 作者 + 关键词，供用户逐字核对。
7. 若金句出自真实人物，身份行不确定就问——落款写错头衔比不写更糟。

逐词浮现合同（scene-local，五拍全图）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| mark（U+201C） | 0.1s | `scale-pop`（easeOutCubic） | 0.5 | 0.6s |
| words（w-0..n） | 0.8s 起 | `blur-up`，stagger 0.15-0.22s | 0.4/词 | 0.8 + n x s + 0.4 |
| key（关键词） | 同位词时刻 | `blur-up` | 0.45 | 同位 + 0.45s |
| rule + author + role | 词全落后 + 0.3s | `fade` | 0.5 | 尾拍 |
| hold | - | - | - | >= 0.8s 全静 |

stagger 选表（s = 每词间隔）：

| s | 读感 | 用于 |
| --- | --- | --- |
| 0.15s | 轻快、上扬 | 短句（<= 8 词）、励志调 |
| 0.18s | 均速、庄重 | 默认：多数金句 |
| 0.22s | 沉、字字有钉 | 长句、悼念/史诗调 |
| < 0.12s | 弹幕 | 禁（词读不出浮现感） |
| > 0.25s | 幻灯 | 禁（句子散架） |

## Recipes

Recipe 1——引号开场 + 逐词浮现（标准配方）：开引号 scale-pop 落进左上（动作，不是家具），词组从左到右逐词 blur-up，关键词 1.4x accent，落款三件套收尾：

```ts
const WORDS = [
  { t: "The",  key: false }, { t: "best",  key: false },
  { t: "way",  key: false }, { t: "to",    key: false },
  { t: "predict", key: false }, { t: "the", key: false },
  { t: "future", key: true },                        // 唯一升格词
  { t: "is",   key: false }, { t: "to",   key: false },
  { t: "invent", key: false }, { t: "it.", key: false },
];
const SIZE = 64, KW = Math.round(SIZE * 1.4), ADVW = 0.56, GAP = 26;
let x = 960 - 560;                                    // 行起点：估宽约 1120，居中预算
v.scene("quote", { duration: 8.2, background: "#0a0a12" }, (s) => {
  s.beat("mark-in", { at: 0.1, description: "开引号落下：开场动作" });
  s.beat("words-done", { at: 3.2, description: "词组全浮现" });
  s.beat("byline", { at: 4.2, description: "落款三件套" });
  s.text("mark", "\u201C", { size: 300, weight: 800, color: "#f8fafc", opacity: 0.22,
    at: { x: 260, y: 300 }, align: "left",
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.1, easing: "easeOutCubic" } });
  for (const [i, w] of WORDS.entries()) {
    const sz = w.key ? KW : SIZE;
    const wpx = Math.round(sz * ADVW * w.t.length + GAP);
    s.text(w.key ? "key" : `w-${i}`, w.t, { size: sz, weight: w.key ? 800 : 600,
      color: w.key ? "#f59e0b" : "#e2e8f0", align: "left", at: { x, y: 540 },
      enter: { effect: "blur-up", duration: w.key ? 0.45 : 0.4, delay: 0.8 + i * 0.18 } });
    x += wpx;                                         // 词位手排：估宽推进
  }
  s.rect("rule", { width: 120, height: 3, fill: "#94a3b8", radius: 1.5,
    at: { x: 960, y: 700 }, enter: { effect: "fade", duration: 0.4, delay: 4.2 } });
  s.text("author", "Alan Kay", { size: 46, weight: 700, color: "#f8fafc",
    at: { x: 960, y: 762 }, enter: { effect: "fade", duration: 0.5, delay: 4.5 } });
  s.text("role", "computer scientist", { size: 30, color: "#94a3b8",
    at: { x: 960, y: 822 }, enter: { effect: "fade", duration: 0.5, delay: 4.8 } });
});
```

时序账：词 10 个 x 0.18 = 1.8s，词全落 0.8 + 1.8 + 0.4 = 3.0s；落款 4.2-5.3s；hold 8.2 - 5.3 = 2.9s（充裕，金句需要回味的空气）。
词位估算 `0.56 x size x 字符数 + 26`：宁窄勿宽——`check.overflow` 会兜住行尾，词距紧则 `layer.modify` 加 GAP 微调。

Recipe 2——长句两行 relay + 落款：> 10 词的引言拆两行（每行 <= 10 词），第二行在第一行词全落后 0.4s 开波，行间 y 距 110：
（两行仍是**一个场景两个波**，不是两个场景——金句的中途 crossfade 会打断默读。）

```ts
const L1 = ["People", "think", "that", "stories", "are", "shaped", "by", "people."];
const L2 = [{ t: "It's", key: false }, { t: "the", key: false },
            { t: "other", key: false }, { t: "way", key: false },
            { t: "around.", key: true }];              // 尾词升格：punchline 落锤
const SIZE2 = 60, KW2 = Math.round(SIZE2 * 1.4), ADV2 = 0.56, GAP2 = 24;
v.scene("long-quote", { duration: 9.0, background: "#0a0a12" }, (s) => {
  s.beat("line-1", { at: 0.8, description: "第一行开波" });
  s.beat("line-2", { at: 2.7, description: "第二行接力" });
  s.beat("punch", { at: 4.6, description: "尾词升格落锤" });
  s.text("mark", "\u201C", { size: 260, weight: 800, color: "#f8fafc", opacity: 0.20,
    at: { x: 240, y: 300 }, align: "left",
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.1, easing: "easeOutCubic" } });
  let x1 = 960 - 480;
  for (const [i, w] of L1.entries()) {                // 行一：普通词全灰
    s.text(`w-${i}`, w, { size: SIZE2, weight: 600, color: "#e2e8f0", align: "left",
      at: { x: x1, y: 460 },
      enter: { effect: "blur-up", duration: 0.4, delay: 0.8 + i * 0.16 } });
    x1 += Math.round(SIZE2 * ADV2 * w.length + GAP2);
  }
  let x2 = 960 - 380;
  for (const [i, w] of L2.entries()) {                // 行二：尾词 1.4x accent
    const sz = w.key ? KW2 : SIZE2;
    s.text(w.key ? "key" : `v-${i}`, w.t, { size: sz, weight: w.key ? 800 : 600,
      color: w.key ? "#22d3ee" : "#e2e8f0", align: "left", at: { x: x2, y: 570 },
      enter: { effect: "blur-up", duration: w.key ? 0.45 : 0.4, delay: 2.7 + i * 0.18 } });
    x2 += Math.round(sz * ADV2 * w.t.length + GAP2);
  }
  s.rect("rule", { width: 120, height: 3, fill: "#94a3b8", radius: 1.5,
    at: { x: 960, y: 700 }, enter: { effect: "fade", duration: 0.4, delay: 4.8 } });
  s.text("author", "Terry Pratchett", { size: 46, weight: 700, color: "#f8fafc",
    at: { x: 960, y: 762 }, enter: { effect: "fade", duration: 0.5, delay: 5.1 } });
});
```

两行 relay 的纪律：第二行开波时刻 >= 第一行词全落 + 0.2s（行一 0.8 + 8 x 0.16 + 0.4 = 2.48s，行二 2.7s 起步正合适）；punchline 升格词永远放**尾位**（句末落锤，中位升格会拦腰截断默读）。

Recipe 3——引号对首尾呼应（收束签名）：开场 U+201C 落左上，落款前 U+201D 落右下——闭引号是「引完了」的动作信号，比开引号小一档、晚 4-6s：

```ts
// 接 Recipe 1/2 的场景尾部追加（同 scene 内）：
s.beat("close-mark", { at: 4.0, description: "闭引号落下：引完了" });
s.text("mark-close", "\u201D", { size: 220, weight: 800, color: "#f8fafc", opacity: 0.20,
  at: { x: 1660, y: 620 }, align: "right",
  enter: { effect: "scale-pop", duration: 0.45, delay: 4.0, easing: "easeOutCubic" } });
```

引号对三条纪律：闭引号比开引号小一档（220 vs 300——收束轻于开场，重量级相反）；opacity 同档（0.18-0.25，两朵云同一片天）；闭引号时刻 < 落款 rule 的 delay（先合书再签名，顺序反了像先盖章后写名）。

Recipe 4——数据金句（数字 + 断言句混合）：结论型金句带一个大数字（"42% of renders finish under 2s"），数字走 kpi-countup 的位数表，断言词组照本技能逐词浮现：

```ts
const CLAIM = ["of", "renders", "finish", "under", "two", "seconds."];
const NUM = "42%";
const SIZEC = 58, ADVC = 0.56, GAPP = 24;
v.scene("stat-quote", { duration: 8.0, background: "#0a0a12" }, (s) => {
  s.beat("num-in", { at: 0.4, description: "大数字先数（位数表 1.0s）" });
  s.beat("claim-wave", { at: 1.8, description: "断言词组随后逐词" });
  s.text("mark", "\u201C", { size: 260, weight: 800, color: "#f8fafc", opacity: 0.20,
    at: { x: 240, y: 300 }, align: "left",
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.1, easing: "easeOutCubic" } });
  s.text("num", NUM, { size: 150, weight: 800, font: "monospace", color: "#f8fafc",
    align: "left", at: { x: 700, y: 460 },
    enter: { effect: "typewriter", duration: 1.0, delay: 0.4, easing: "easeOutCubic" } });
  let xc = 700 + Math.round(150 * 0.6 * NUM.length) + 40;   // 数字右缘起排词组
  for (const [i, w] of CLAIM.entries()) {
    s.text(`w-${i}`, w, { size: SIZEC, weight: 600, color: "#e2e8f0", align: "left",
      at: { x: xc, y: 460 },
      enter: { effect: "blur-up", duration: 0.4, delay: 1.8 + i * 0.18 } });
    xc += Math.round(SIZEC * ADVC * w.length + GAPP);
  }
  s.text("author", "render telemetry, 2025", { size: 30, color: "#94a3b8",
    at: { x: 960, y: 700 }, enter: { effect: "fade", duration: 0.5, delay: 3.6 } });
});
```

数据金句的纪律：数字 monospace 左锚（kpi-countup Recipe 1 全套）、词组从数字右缘起排（基线对齐 460 同 y）；数字必须用户给——「42%」是渲染遥测的占位示例，真值缺了就问。

Recipe 5——竖版 9:16 金句（社交 feed 版）：1080x1920，词组改为**两至三短行堆叠**（竖版行宽只有 840 可用），stagger 保持 0.18s、行距 120，落款压到 78% 以上安全区：

```ts
const ROWS = [
  { words: ["The", "best", "way", "to"], y: 560 },
  { words: ["predict", "the"], y: 680 },
  { words: [{ t: "future", key: true }, { t: "is", key: false }], y: 800 },
  { words: ["to", "invent", "it."], y: 920 },
];
const SIZES = 66, KWS = Math.round(SIZES * 1.4), ADVS = 0.56, GAPS = 22;
let wd = 0.8;                                          // 全局词时钟：跨行连续走
let wi = 0;                                           // 全局词序号：跨行连续编号
v.scene("quote-v", { duration: 7.6, background: "#0a0a12" }, (s) => {
  s.beat("v-mark", { at: 0.1, description: "竖版开引号：更靠中、更大" });
  s.beat("v-words-done", { at: 3.4, description: "四短行词组全落" });
  s.text("mark", "\u201C", { size: 340, weight: 800, color: "#f8fafc", opacity: 0.22,
    at: { x: 200, y: 300 }, align: "left",
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.1, easing: "easeOutCubic" } });
  for (const [ri, row] of ROWS.entries()) {
    let xr = 540 - Math.round((row.words.length - 1) * SIZES * ADVS * 3.2);   // 行起点粗估居中
    for (const w of row.words) {
      const isKey = w.key === true;
      const sz = isKey ? KWS : SIZES;
      s.text(isKey ? "key" : `w-${wi}`, w.t, { size: sz, weight: isKey ? 800 : 600,
        color: isKey ? "#f59e0b" : "#e2e8f0", align: "left", at: { x: xr, y: row.y },
        enter: { effect: "blur-up", duration: 0.4, delay: wd } });
      wd += 0.18;                                      // 全局词时钟：行只是 y，波是连续的
      wi += 1;                                         // 全局词序号：QA 寻址不重号
      xr += Math.round(sz * ADVS * w.t.length + GAPS);
    }
  }
  s.rect("rule", { width: 100, height: 3, fill: "#94a3b8", radius: 1.5,
    at: { x: 540, y: 1160 }, enter: { effect: "fade", duration: 0.4, delay: 4.2 } });
  s.text("author", "Alan Kay", { size: 44, weight: 700, color: "#f8fafc",
    at: { x: 540, y: 1220 }, enter: { effect: "fade", duration: 0.5, delay: 4.5 } });
  s.text("role", "computer scientist", { size: 28, color: "#94a3b8",
    at: { x: 540, y: 1272 }, enter: { effect: "fade", duration: 0.5, delay: 4.8 } });
});
```

竖版纪律四条：行数即词组分组（每行 <= 4 词，feed 上拇指滑动的可读粒度）；全局词时钟跨行连续（行只是 y 位置，波不能断——断波等于重新开场）；关键词行的行宽预算按 1.4x 估；落款压在 y <= 78%（平台 UI 区之上，short-video 同款安全边距）。

## QA gates

- `expect(frame(0)).not.toBeBlack()`——mark 的 scale-pop 起点 0.1s 近乎 frame-0；保险起见加一层静态微光椭圆（无 enter）当 ink。
- `expect(frame(18)).toContainText("\u201C")`——0.6s 开引号落定（开场动作完成）。
- 逐词门：中段帧 `render.preview` 数波次——`toContainText` 断末词所在层全量：`toHaveLayers("w-0", "w-9", "key", "mark", "author", "role", "rule")`。
- 关键词门：`key` 层 size = 1.4 x body、color = accent；且全场景 accent 层 <= 2 个（key + 引号算一个内）。
- 落款门：author 与 role 的 fade delay > 词全落时刻（行一场景 4.5/4.8 > 3.0）；`toContainText("Alan Kay")` 于 5.3s 后。
- hold 门：最后 0.8s 无新入场；`noTextOverflow()` 全景（词位手排是主要风险源，`check.overflow` 必跑）。
- `durationBetween(6, 10)`；多句拆景时 crossfade 0.5s、总长 <= 14s。
- verbatim 门（人工）：交付附引言原文，用户逐字核对后才算完成——quote-card 同款红线。
- 静音规则：词组 + 落款静音可读；金句视频默认无声播放（feed 场景），配乐是可选项不是依赖项。

## Anti-patterns

- 改写引言——「润色」「精简」「补标点」都是改写；verbatim 或不 ship（quote-card 红线同源）。
- typewriter 整句——那是 quote-card 的语气（打字机）；本技能的语气是**词组浮现**（blur-up 波），混用就成了另一个技能。
- 引号当静态贴纸（无 enter、opacity 0.10）——那是 quote-card 的家具语法；motion 版引号是开场动作（scale-pop、0.18-0.25）。
- 两个以上升格词——一句话一个 key；第二个 accent 词出现时，第一个就废了（accent 是稀缺资源）。
- 关键词放句中——punchline 升格永远在尾位；中位升格拦腰截断默读。
- stagger < 0.12s 或 > 0.25s——快成弹幕、慢成幻灯；stagger 选表是合同。
- 落款先于词全落——作者先出场读感是「他说的还没说完」；落款永远是最后一拍。
- 词位估宽用 0.6+——高估直接顶出画布；0.56 + 宁窄勿宽 + overflow 门三件套才是安全区。
- 拿本技能做歌词——音乐节拍锁定的逐字归 kinetic-lyrics；本技能自 paced。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 16:9 金句 motion（引号动作 + 逐词） | 本技能 | 横版引言动效 |
| 1:1 方形金句卡 | quote-card | typewriter + pop 关键词 |
| 纯文字动能（3x 关键词、换词槽） | kinetic-typography | 文字即画面 |
| 音乐逐字歌词 | kinetic-lyrics | 节拍锁定 |
| 数据金句的大数字 | kpi-countup | 位数表照抄（Recipe 4 已接） |
| 金句后接 CTA/品牌尾卡 | end-card | crossfade 0.4s 出去 |

接出本技能时带走三样：stagger 选表、词位估宽公式（0.56 x size x chars + 26）、落款三件套时序。引言原文永远出现在交付说明里。
