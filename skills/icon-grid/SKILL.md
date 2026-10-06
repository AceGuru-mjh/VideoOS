---
name: icon-grid
version: 0.1.0
description: 图标矩阵揭示——纯图标墙的对角错峰入场与「悬停高亮」游走模拟（发光椭圆＋放大重绘），能力/特性清单的零资产图标阵。
trigger: The user wants an icon wall or capability matrix - a grid of primitive-built icons staggering in wave after wave, with a simulated hover highlight walking a few cells, ending on a one-line claim.
---

# Icon Grid

Goal: 纯图标矩阵视频（1920x1080、30fps、8-12s）——一墙原语拼装的图标按对角波错峰入场，一个「悬停高亮」沿 2-4 个格子游走（发光椭圆 + 1.25x 放大重绘），收尾定格在一句能力宣言上。
分工边界：icon-grid 管**纯图标墙**（无长文案、无数字格）；infographic 管「图标 + 数字 + 短句」的信息格版式（格内三拍）；本技能的格子只有图标与 <= 3 词的微标签——矩阵即清单，高亮即导览。
零资产纪律：图标一律 rect/ellipse 原语拼装（底座 + 内部符号），不引图标字体、不贴图标图片；语汇库沿用 infographic 的原语速查表。

## Workflow

1. 收集三件事，缺了就问：
   - 能力/特性清单（4-9 项，每项一个图标语汇 + <= 3 词微标签）；
   - 高亮剧本（哪 2-4 项值得游走停留——用户点不出就按「先问后选」给提案）；
   - 收尾宣言（<= 8 词，全墙定格后 blur-up）。
   清单超过 9 项先问用户砍哪几项——矩阵不是收纳箱，是「最重要的一屏」。
2. `storyboard.plan { intent: "icon grid · <topic>", durationSeconds }` -> 收敛为单场景三段：wave（入墙）-> hover（游走）-> claim（定格宣言）。
   三段全部一景完成；9s 以上的墙可以拆两景（前半墙 + 后半墙 + 合并定格），但同几何常量必须共享。
3. 写 `src/video.ts`（Recipes）：
   - 网格几何一次计算：3x3（9 格）或 4x2（8 格），格距 260、格心从 (620, 560) 起网格展开；
   - 每格图标 = 底座（`ellipse` 96x96）+ 内部符号（1-3 个 rect/ellipse，同 delay 整组 pop）；
   - 层命名 `cell-<r><c>-base` / `cell-<r><c>-sym-*` / `tag-<r><c>`——QA 按名寻址。
4. 错峰波次：`delay = (row + col) x 0.09`（对角波，左上先动右下收尾）；波感来自错峰差值，0.06-0.12s 是读得出「波」的区间。
   全墙入场完成 <= 1.4s（3x3 的末格 delay 1.08 + 0.35 enter）。
5. 高亮游走（引擎真值）：v1 无逐帧透明度动画、无真 hover——「悬停」= **增亮反差**：glow 椭圆（blur 40、opacity 0.22）in/out 窗口盖在目标格 + 该格图标以 1.25x 重绘一版 pop 入场。
   不做「其他格暗化」：暗化需整墙以低透明度重绘一层，层成本翻倍且 QA 名单爆炸；增亮的反差已足够读出悬停（comparison 的 emphasis delta 同理）。
   重绘版与原版同格心叠印（放大内容不放大位置）——两版错位的格子读作「分身」而不是「悬停」。
6. `compile.run` -> 0 errors -> `check.overflow`——微标签（3 词 x 28px）不会溢出，真正要盯的是 glow 椭圆 blur 半径越界（blur 大于格距的一半会漏到邻格）。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调 delay 与 glow 半径）-> `render.final`，交付附清单、高亮剧本与宣言句。

三段节奏合同（scene-local，全图）：

| 段 | Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- | --- |
| wave | 底座组（cell-*-base） | (r+c) x 0.09 | `scale-pop`（easeOutBack） | 0.35 | <= 1.4s |
| wave | 符号组（cell-*-sym-*） | 底座 d + 0.15 | `fade` | 0.25 | <= 1.8s |
| wave | 微标签（tag-*） | 底座 d + 0.3 | `fade` | 0.3 | <= 2.1s |
| hover | glow-<k> + 大版重绘 | 2.4s + k x 1.2 | `fade` / `scale-pop` | 0.4 / 0.45 | 各站 + 0.45s |
| claim | 宣言句 | 末站 + 0.6 | `blur-up` | 0.5 | + 0.5s |
| hold | - | - | - | - | >= 0.8s |

高亮游走规格表：

| 项 | 规格 | 理由 |
| --- | --- | --- |
| 站数 | 2-4 站 | 第五站开始观众当进度条看 |
| 每站时长 | 1.0-1.3s | 低于 1.0 读不清微标签 |
| glow 椭圆 | 180x180、blur 40、opacity 0.22 | 恰好罩住 96 底座 + 1.25x 版 |
| 大版重绘 | 底座 120 + 符号 x1.25 | 增亮反差的第二通道 |
| 站间移动 | 无过渡（in/out 硬切） | hover 本来就是瞬移 |

底座规格表（图标墙的「字体规范」）：

| 元素 | 规格 | 备注 |
| --- | --- | --- |
| 底座 | ellipse 96x96，fill accent、opacity 0.14-0.18 | 墙的统一锚 |
| 内部符号 | 1-3 原语，线感宽 >= 6 | 语汇见 infographic 速查表 |
| 微标签 | 28px、#94a3b8、底座下方 70px | <= 3 词 |
| 格距 | 260px（3x3） | blur 40 不会漏到邻格 |

## Recipes

Recipe 1——3x3 图标墙对角波（标准配方）：九格错峰入场，波沿 (row+col) 对角推进，符号与微标签跟在底座身后：
（图标语汇用注释占位——符号原语拼装见 Recipe 3。）

```ts
const GRID = [
  ["render", "timeline", "scene"],
  ["assets", "mcp",     "preview"],
  ["render2", "test",    "ship"],
];
const ORIGIN = { x: 620, y: 560 }, PITCH = 260;
v.scene("wall", { duration: 9.0, background: "#0a0a12" }, (s) => {
  s.beat("wave-start", { at: 0, description: "对角波：左上先动" });
  s.beat("wave-done", { at: 1.8, description: "九格全落" });
  s.ellipse("halo", { width: 1400, height: 700, fill: "#22d3ee", opacity: 0.05, blur: 150,
    at: { x: "50%", y: "52%" } });                    // frame-0 ink，极淡
  for (const [r, row] of GRID.entries()) {
    for (const [c, word] of row.entries()) {
      const d = (r + c) * 0.09;                       // 对角波：左上 0s，右下 1.08s
      const cx = ORIGIN.x + c * PITCH, cy = ORIGIN.y + r * PITCH;
      s.ellipse(`cell-${r}${c}-base`, { width: 96, height: 96, fill: "#22d3ee",
        opacity: 0.16, at: { x: cx, y: cy },
        enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
      s.rect(`cell-${r}${c}-sym-1`, { width: 34, height: 8, fill: "#e2e8f0", radius: 4,
        at: { x: cx, y: cy - 14 },
        enter: { effect: "fade", duration: 0.25, delay: d + 0.15 } });   // 符号之一（示意）
      s.rect(`cell-${r}${c}-sym-2`, { width: 8, height: 30, fill: "#e2e8f0", radius: 4,
        at: { x: cx, y: cy + 4 },
        enter: { effect: "fade", duration: 0.25, delay: d + 0.2 } });    // 符号之二（示意）
      s.text(`tag-${r}${c}`, word, { size: 28, color: "#94a3b8", at: { x: cx, y: cy + 70 },
        enter: { effect: "fade", duration: 0.3, delay: d + 0.3 } });
    }
  }
});
```

时序账：末格（r=c=2）delay 1.08s，标签落定 1.68s；对角波的好处是**每列同时收**（c 相同的格同 delay）——波推进的轴是右下对角线，不是一行一行。
4x2 墙（8 格）把 PITCH 横向加到 300、纵向 320，末格 delay (1+3)? 不——4x2 的 (r+c) 最大是 1+3 = 4 x 0.09 = 0.36s，波太快，改用 `row x 0.14 + col x 0.06`。

Recipe 2——悬停高亮游走（本技能的签名动作）：glow 椭圆三站硬切，每站目标格以 1.25x 重绘一版 pop 入场：
（重绘版与原版**同格心**叠印——放大的是内容不是位置；glow 窗口与重绘 pop 同刻发枪。）

```ts
// 接 Recipe 1 的场景尾部（同 scene 内）：
const STOPS = [
  { r: 1, c: 0, word: "render2", at: 2.4 },      // 中列左：render2
  { r: 0, c: 2, word: "scene",   at: 3.6 },
  { r: 2, c: 2, word: "ship",    at: 4.8 },
];
for (const [k, st] of STOPS.entries()) {
  const cx = ORIGIN.x + st.c * PITCH, cy = ORIGIN.y + st.r * PITCH;
  s.beat(`hover-${k + 1}`, { at: st.at, description: `悬停 ${st.word}` });
  s.ellipse(`glow-${k + 1}`, { width: 180, height: 180, fill: "#22d3ee", opacity: 0.22,
    blur: 40, at: { x: cx, y: cy }, in: st.at, out: st.at + 1.2,
    enter: { effect: "fade", duration: 0.4 } });      // 增亮：硬进硬出
  s.ellipse(`cell-${st.r}${st.c}-big`, { width: 120, height: 120, fill: "#22d3ee",
    opacity: 0.30, at: { x: cx, y: cy }, in: st.at, out: st.at + 1.2,
    enter: { effect: "scale-pop", duration: 0.45, delay: st.at, easing: "easeOutBack" } });
  s.text(`tag-${st.r}${st.c}-big`, st.word, { size: 34, weight: 700, color: "#e2e8f0",
    at: { x: cx, y: cy + 70 }, in: st.at, out: st.at + 1.2,
    enter: { effect: "fade", duration: 0.3, delay: st.at + 0.15 } });   // 标签同步放大版
}
s.text("claim", "everything an editor needs", { size: 52, weight: 700, color: "#f8fafc",
  at: { x: "50%", y: 178 }, enter: { effect: "blur-up", duration: 0.5, delay: 6.0 } });
```

游走纪律五条：站与站**无过渡**（hover 本来就是瞬移，crossfade 出来的反而是「扫描」不是「悬停」）；glow 的 in/out 窗口与重绘版完全同步（差 0.1s 就露「两层皮」）；每站 >= 1.0s（低于读不清放大版微标签）；宣言句在末站 out 之后 + 0.6s（游走结束了才开话）；重绘版底座 opacity 提到 0.30（原版 0.16 的近两倍——增亮要有可感知的差）。

Recipe 3——底座与符号的语汇拼装（两个完整示例）：时钟语汇与对话语汇，底座 + 符号整组同 delay pop：
（infographic 的原语速查表在此处生效——本技能用同一套语汇库，避免两个技能两套图标语言。）

```ts
function drawClockIcon(s: any, name: string, cx: number, cy: number, d: number): void {
  s.ellipse(`${name}-base`, { width: 96, height: 96, fill: "#22d3ee", opacity: 0.16,
    at: { x: cx, y: cy },
    enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
  s.ellipse(`${name}-face`, { width: 56, height: 56, fill: "#0a0a12", at: { x: cx, y: cy },
    enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
  s.rect(`${name}-hand`, { width: 28, height: 6, fill: "#e2e8f0", radius: 3,
    at: { x: cx + 11, y: cy }, enter: { effect: "fade", duration: 0.25, delay: d + 0.15 } });
}
function drawChatIcon(s: any, name: string, cx: number, cy: number, d: number): void {
  s.ellipse(`${name}-base`, { width: 96, height: 96, fill: "#22d3ee", opacity: 0.16,
    at: { x: cx, y: cy },
    enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
  s.rect(`${name}-bubble`, { width: 52, height: 36, fill: "#0a0a12", radius: 10,
    at: { x: cx, y: cy - 6 },
    enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
  for (let i = 0; i < 3; i++) {                       // 三小点：省略号
    s.ellipse(`${name}-dot-${i + 1}`, { width: 7, height: 7, fill: "#e2e8f0",
      at: { x: cx - 14 + i * 14, y: cy - 6 },
      enter: { effect: "fade", duration: 0.2, delay: d + 0.15 + i * 0.05 } });
  }
}
// 用法（在墙循环里替换示意符号）：
// drawClockIcon(s, `cell-${r}${c}`, cx, cy, d);
// drawChatIcon(s, `cell-${r}${c}`, cx, cy, d);
```

拼装纪律：整组共享同一 delay（底座、face、符号同刻 pop 才是一个图标——错峰就散架成零件）；face 用背景色挖洞（叠印出「镂空」感，v1 无 stroke 的诚实替代）；符号 <= 3 层（第四层开始渲染与 QA 都受罪）。

Recipe 4——收尾定格（全墙静 + 宣言）：游走结束后全部格子原样在场（无 exit、无暗化），宣言句 blur-up，>= 0.8s 全静：
（定格帧 = 交付封面帧——墙的完整九宫格 + 一句话，这一帧会被用作文档封面。）

```ts
v.scene("wall-final", { duration: 2.8, background: "#0a0a12" }, (s) => {
  s.beat("still", { at: 0.2, description: "全墙原样定格，宣言开话" });
  for (const [r, row] of GRID.entries()) {
    for (const [c, word] of row.entries()) {
      const cx = ORIGIN.x + c * PITCH, cy = ORIGIN.y + r * PITCH;
      s.ellipse(`cell-${r}${c}-base`, { width: 96, height: 96, fill: "#22d3ee",
        opacity: 0.16, at: { x: cx, y: cy } });       // 静：无 enter
      s.text(`tag-${r}${c}`, word, { size: 28, color: "#94a3b8",
        at: { x: cx, y: cy + 70 } });
    }
  }
  s.text("claim", "everything an editor needs", { size: 52, weight: 700,
    color: "#f8fafc", at: { x: "50%", y: 178 },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.3 } });
});
```

定格纪律：独立收尾景与单景版二选一（单景版宣言 delay 6.0 已在 Recipe 2 给出）；定格景的格子**无 enter 直接到场**（定格不是重播）；符号层在定格景可省（底座 + 微标签已构成九宫格的完整版式——符号密度是入场戏的，不是封面帧的）。

变体速查（常见需求 -> 处理法，都在本技能内解决）：

| 需求 | 处理法 | 参考 |
| --- | --- | --- |
| 8 项能力 | 4x2 墙，波次 row x 0.14 + col x 0.06 | Workflow 第 4 步 |
| 12 项能力 | 拆两景各 6 格（2x3），同几何常量 | 同几何纪律 |
| 高亮站要配音 | `v.audio` 短音效挂各站 in 时刻，音画同点 | Recipe 2 |
| 墙要当背景用（上叠文字） | 底座 opacity 降到 0.10、去掉微标签 | 底座规格表 |
| 只高亮一站 | 游走段压缩为单站 1.4s，宣言提前 | 预算重算 |

## QA gates

- `expect(frame(0)).not.toBeBlack()`——halo（极淡）或首格底座 pop 起点保住 frame-0 ink。
- 波次门：`render.preview` 入墙中段帧能数出对角波；末格标签 `toHaveLayers("cell-22-base", "tag-22")` 落定 <= 2.1s。
- 全墙门：`toHaveLayers("cell-00-base", "cell-02-base", "cell-20-base", "cell-22-base")`（四角点名）+ 九个 `tag-*` 全在场。
- 游走门：每站 `toHaveLayers("glow-<k>", "cell-<r><c>-big", "tag-<r><c>-big")`；glow 与 big 的 in/out 窗口逐字符相同。
- 宣言门：`toContainText("everything an editor needs")` 于末站 out + 1.1s 后；全静最后 0.8s 无新入场。
- blur 门：glow 椭圆 blur <= 40（格距 260 的一半远低于危险线，但 4x2 密墙的横向格距 300 时依然守 40——半径超 80 会漏邻格）。
- 语汇门（人工）：一墙图标语言统一（全线感或全面感，不混）；底座 opacity 全墙同值（0.16 是默认，逐格微调是风格事故）。
- `noTextOverflow()`（微标签 3 词安全，宣言句 8 词是真正的门）；`durationBetween(8, 12)`。
- 静音规则：微标签 + 宣言静音可读；墙是无声清单，配音是可选项。
- 交付门：清单、高亮剧本、宣言句三样写进交付说明——用户核对「哪几项被高亮」是本体裁的核心验收。
- 波差门：任意两格 delay 差在 0.06-0.12s 的倍数区间内（对角波相邻差恰为 0.09）；出现 0.2s+ 的断档就是波断了。
- 首拍门：首格（r=c=0）delay = 0——波从第一格起振；首格 delay > 0.1s 的墙开场像卡顿。
- 封面帧门（人工）：定格景导出后单独看——格心对齐、微标签居中、无入场残影；这一帧会被抽去当插图用。

## Anti-patterns

- 格子带长文案——3 词以上是 infographic 的信息格（数字 + 短句 + 三拍）；本技能的格子是清单项。
- 高亮游走五站以上——第五站起观众当进度条看；矩阵的导览是点缀不是主线。
- 「暗化」其他格——无逐帧透明度，暗化 = 整墙低透明度重绘一层，层成本与 QA 名单双爆炸；增亮反差已经够了。
- 站间加 crossfade——hover 是瞬移；crossfade 出来的是「扫描」，语义就变了。
- 图标语言混搭——一半线感一半面感、或底座形状混用（ellipse + 圆角 rect 并存）；一墙一种底座、一种语言。
- 引图标字体/图标图片——零资产红线；语汇库（infographic 速查表 + 本文两个拼装函数）拼不出的语汇就换词。
- 错峰 < 0.06s 或 > 0.12s——快了读不出波（同时 pop 的烟花），慢了墙变成幻灯片逐格放映。
- 符号层独立错峰——图标组必须同 delay pop；符号自己错峰是「零件雨」，不是图标入场。
- 宣言句早于游走结束——导览没完就开总结，两件事互相抢最后一秒。
- 墙超过 9 格还硬排 4x3——十二格的墙每格只剩 150px 格距，blur 与符号都压不住；拆两景或砍清单。
- 高亮站选了相邻格——邻站游走读作「没走」；站与站至少隔一格（对角或隔列），瞬移才像悬停。
- 定格景重播入场——定格不是重播；收尾景的格子无 enter 直接到场，重放一遍 pop 是两个视频。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 纯图标墙 + 高亮游走 | 本技能 | 矩阵即清单 |
| 图标 + 数字 + 短句的信息格 | infographic | 带数字的版式 |
| 语汇原语速查表 | infographic（表）+ 本文（函数） | 共用语汇库 |
| 能力墙要配真截图 | screenshot-tour | 截图是证据，图标是清单 |
| 墙后接产品演示 | product-demo | crossfade 0.4s 出去 |
| 循环版墙 | gif-loop | 首尾帧一致化 |

接出本技能时带走三样：对角波公式（(r+c) x 0.09）、增亮反差代替暗化、整组同 delay 拼装。语汇拼装函数可整体拷给 infographic 复用（本就是一套语言）。
墙的封面帧（定格景）常被抽去当文档/官网插图——定格景的九宫格要按「会被单独看」的水准排：格心对齐、标签居中、无入场残影。
