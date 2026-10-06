---
name: gradient-flow
version: 0.1.0
description: 渐变背景流动——多层 blur 椭圆的缓慢漂移与跨场景色相过渡（同几何不同色 crossfade），给氛围/音乐/封面当「活的背景」；前景一律静止。
trigger: The user wants a living gradient background - soft blurred blobs drifting slowly and hues shifting across scenes behind content that stays completely still.
---

# Gradient Flow

Goal: 渐变流动背景（1920x1080、30fps、6-15s）——3-4 层大 blur 椭圆（opacity 0.14-0.22、blur 120-180）各自超慢漂移（<= 40px/s，linear 匀速），相邻场景间用**同几何不同色**的 blob 层 crossfade 0.8-1.2s 实现「色相过渡」，前景内容（标题/封面字/静帧）一律静止。
分工边界：tech-intro 管科技感片头（grid + glow 是道具，词标是主角）；style-shorts 管三种风格模拟（像素/瑞士两式明令禁 blur）；brand-kit 管 token 与 reskin；gif-loop 管循环收尾；本技能管**背景系统本身**——blob 编排、漂移速度、色相过渡，产出的是「底」，不是作品。
核心美学：背景动一分，前景就要静十分——本技能的全部纪律都从这一条推导。

## Workflow

1. 收集三件事，缺了就问：
   - 氛围基调与色相路径（冷 -> 暖？单色系？两到三个 hue 站点）；
   - 前景内容（标题/静帧封面字——**前景必须静止**，会动的前景去找别的技能）；
   - 时长与画幅（横版 6-15s；竖版按 short-video 边距重排 blob 中心）。
2. `storyboard.plan { intent: "gradient flow · <mood>", durationSeconds }` -> 收敛为「一景一 hue」：每个 hue 站点一景，相邻景 crossfade 0.8-1.2s。
   两站（冷 -> 暖）是默认；三站以上要有叙事理由（氛围转变的节奏也是叙事）。
3. 写 `src/video.ts`（Recipes）：
   - blob 层先声明（painter's order：最底）、前景字最后声明；
   - 每个 blob = 一个 `ellipse`，`enter` 用超长 slide（8-10s、distance 120-240、`linear`）——漂移就是「还在入场的半途」；
   - 静态底 blob（无 enter）保 frame-0 ink——漂移层从透明淡入，没有静态底开场就是黑屏。
4. 漂移速度预算：distance / duration <= 40px/s（8s 走 200px = 25px/s 是甜点）；超过 40px/s 开始「果冻抖」，背景就抢戏了。
   多 blob 各走各向（左上 -> 右下、右 -> 左、下 -> 上），速度同档——同向同速会读成「整张图在平移」。
5. `compile.run` -> 0 errors -> `check.overflow`——前景字是唯一文本层（46-84px 静止字，overflow 风险低）；要跑的是全景 `render.preview` 的**运动感自查**（见下一步）。
6. `render.preview` 三帧：开场 0.5s（frame-0 ink + 漂移层刚开始动）、任一中段帧（blob 无一糊出焦点）、hue 交接中点（两景 blob 各半、色相读作「变」而非「换幕」）。
   自查「背景是背景」：眯眼看 preview——前景字仍是最亮最实的元素，blob 全部退到「氛围」档，就是对的。
7. QA gates -> `test.run` -> repair loop <= 3（`layer.modify` 微调 blob 速度与 opacity）-> `render.final`；循环版交 gif-loop（首尾帧一致化），BGM 版挂 `v.audio`（loop 轨 + fadeOut 对齐片尾）。

blob 漂移合同（scene-local，每景照抄；「底」与「漂移层」分工明确）：

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| 底 blob x2（静态） | 0 | 无 enter 常驻 | - | frame 0 即在场 |
| 漂移 blob x2-3 | 0.2-0.6s | `slide-*`（linear） | 8-10s（贯穿全景） | 不 settle——半途即美学 |
| 前景字 | 0.3-0.8s | `fade` / `blur-up` 一次性 | 0.4-0.6 | + 0.6s 后全静 |
| hold | - | - | - | 前景静 >= 场景 80% 时长 |

漂移速度表（背景的「心率」）：

| 速度 | 读感 | 判定 |
| --- | --- | --- |
| <= 15px/s | 冥想、呼吸 | 冥想/助眠向 |
| 15-25px/s | 微风、活的壁纸 | 默认甜点 |
| 25-40px/s | 缓流、有方向感 | 音乐可视化底 |
| > 40px/s | 果冻抖 | 禁（背景抢戏的临界） |

色相过渡表（相邻景之间）：

| 写法 | 读感 | 判定 |
| --- | --- | --- |
| 同几何不同色 + `crossfade 0.8-1.2s` | 色相在变 | 唯一正解 |
| 同几何不同色 + `cut` | 换台 | 禁（色相过渡的全部意义在「渐变」） |
| 不同几何 + crossfade | 换幕 | 那是转场不是过渡 |
| `fade-black` 中转 | 世界重启 | 仅段落级分区用 |

## Recipes

Recipe 1——三层 aurora 单景（标准配方）：静态底 blob 保 frame-0 ink，两层漂移 blob 各走各向，前景标题一次性 blur-up 后全静：
（漂移层的 slide 方向 = enter 效果名：`slide-right` 从左往右、`slide-up` 自下而上——direction 参数配 distance 用。）

```ts
v.scene("aurora", { duration: 8.0, background: "#05070d" }, (s) => {
  s.beat("alive", { at: 0.3, description: "frame-0 有底、漂移在途、标题即静" });
  // 静态底 x2：frame-0 ink，永远在场
  s.ellipse("base-1", { width: 1100, height: 700, fill: "#312e81", opacity: 0.18,
    blur: 170, at: { x: "34%", y: "42%" } });
  s.ellipse("base-2", { width: 900, height: 620, fill: "#0e7490", opacity: 0.14,
    blur: 160, at: { x: "72%", y: "64%" } });
  // 漂移层 x3：超长 slide，linear 匀速，各走各向
  s.ellipse("drift-1", { width: 760, height: 520, fill: "#6d28d9", opacity: 0.16,
    blur: 150, at: { x: "30%", y: "38%" },
    enter: { effect: "slide-right", duration: 9, delay: 0.2, easing: "linear",
      params: { distance: 220 } } });                 // 24px/s：往右缓漂
  s.ellipse("drift-2", { width: 640, height: 460, fill: "#0891b2", opacity: 0.15,
    blur: 140, at: { x: "68%", y: "58%" },
    enter: { effect: "slide-left", duration: 10, delay: 0.4, easing: "linear",
      params: { distance: 200 } } });                 // 20px/s：往左缓漂
  s.ellipse("drift-3", { width: 520, height: 380, fill: "#7c2d12", opacity: 0.10,
    blur: 130, at: { x: "50%", y: "76%" },
    enter: { effect: "slide-up", duration: 9, delay: 0.6, easing: "linear",
      params: { distance: 160 } } });                 // 18px/s：自下而上
  // 前景：一次性入场后全静（背景动 = 前景静）
  s.text("title", "deep focus", { size: 84, weight: 700, color: "#f8fafc",
    letterSpacing: 2, at: { x: "50%", y: "44%" },
    enter: { effect: "blur-up", duration: 0.6, delay: 0.3 } });
  s.text("sub", "a slow background study", { size: 34, color: "#94a3b8",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
```

速度账：drift-1 220px / 9s = 24px/s、drift-2 20px/s、drift-3 18px/s——三档都在甜点区且互差 < 8px/s（同档不同速，读感是「活的」不是「乱的」）。
色相账：紫 + 青 + 焦棕，三个 hue 都压在 opacity <= 0.18——任何一层到 0.25 就开始吃前景对比度。

Recipe 2——色相过渡两连场（本技能的签名动作）：scene-a 冷色 blob 与 scene-b 暖色 blob **同几何同尺寸**，crossfade 1.0s——色相在读作「变」而不是「换幕」：
（几何冻结表：两层 base 与三层 drift 的 at/width/height/blur 全参数在两景**逐项相同**，只有 fill 换 hue——这是「色相过渡」成立的全部前提。）

```ts
const BLOBS = [                                        // 几何一次定义，两景共用
  { w: 1100, h: 700, x: "34%", y: "42%", o: 0.18, b: 170 },
  { w: 900,  h: 620, x: "72%", y: "64%", o: 0.14, b: 160 },
  { w: 760,  h: 520, x: "30%", y: "38%", o: 0.16, b: 150, drift: "slide-right", d: 220 },
  { w: 640,  h: 460, x: "68%", y: "58%", o: 0.15, b: 140, drift: "slide-left",  d: 200 },
];
const COLD = ["#312e81", "#0e7490", "#6d28d9", "#0891b2"];   // 冷色 hue 组
const WARM = ["#7c2d12", "#a16207", "#be185d", "#db2777"];   // 暖色 hue 组
function buildScene(name: string, hues: string[]): void {
  v.scene(name, { duration: 7.0, background: "#05070d" }, (s) => {
    BLOBS.forEach((b, i) => {
      if (i < 2) {                                      // 前两层：静态底，无 enter
        s.ellipse(`base-${i + 1}`, { width: b.w, height: b.h, fill: hues[i]!,
          opacity: b.o, blur: b.b, at: { x: b.x, y: b.y } });
      } else {                                         // 后两层：漂移层，超长 slide
        s.ellipse(`drift-${i - 1}`, { width: b.w, height: b.h, fill: hues[i]!,
          opacity: b.o, blur: b.b, at: { x: b.x, y: b.y },
          enter: { effect: b.drift!, duration: 9, delay: 0.3 * (i - 1), easing: "linear",
            params: { distance: b.d! } } });
      }
    });
  });
}
buildScene("hue-cold", COLD);
buildScene("hue-warm", WARM);
v.transition("crossfade", { duration: 1.0, between: ["hue-cold", "hue-warm"] });
```

色相过渡的纪律四条：几何逐项冻结（at/width/height/blur 四项两景全同，只换 fill——差一项 crossfade 就露「换幕」）；crossfade 0.8-1.2s（短了是跳变、长了拖沓）；hue 组的亮度档相近（冷组的 #312e81 与暖组的 #7c2d12 同为暗档——亮暗互换成曝光事故）；前景字在两景**原样复现**（crossfade 期间字不动，动的只有 hue）。

Recipe 3——前景静字纪律（背景系统的使用说明）：背景动 = 前景静——前景只允许「一次性入场」，之后 80% 的时长里全静：
（这是本技能与 kinetic-typography / data-motion 的边界：前景要动效，就别用流动背景。）

```ts
v.scene("ambient-title", { duration: 8.0, background: "#05070d" }, (s) => {
  s.beat("bg-alive", { at: 0.3, description: "背景在漂，前景已静" });
  s.ellipse("base-1", { width: 1100, height: 700, fill: "#312e81", opacity: 0.18,
    blur: 170, at: { x: "34%", y: "42%" } });
  s.ellipse("drift-1", { width: 760, height: 520, fill: "#6d28d9", opacity: 0.16,
    blur: 150, at: { x: "30%", y: "38%" },
    enter: { effect: "slide-right", duration: 9, delay: 0.2, easing: "linear",
      params: { distance: 220 } } });
  s.text("word", "stillness", { size: 96, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "46%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.4 } });   // 一次性入场
  s.rect("rule", { width: 90, height: 3, fill: "#94a3b8", radius: 1.5,
    at: { x: "50%", y: "58%" }, enter: { effect: "wipe", duration: 0.4, delay: 0.9 } });
});
```

前景纪律三条：一次性入场（fade/blur-up/wipe 各一次，入场完成时刻 <= 场景 20%）；无循环动效（呼吸、闪烁、二次 pop 都是「前景在动」——违例）；camera 全场只许一次微推（1.0 -> 1.03，10s 推完——推得比 blob 还慢，读作「镜头呼吸」不读作「运动」）。

Recipe 4——竖版与循环要领 + BGM：竖版把 blob 中心纵排（上 30%/中 55%/下 78%）、漂移全改纵向（slide-up）；循环版首尾帧一致化交 gif-loop；BGM 挂 loop 轨：

```ts
v.scene("aurora-v", { duration: 8.0, background: "#05070d" }, (s) => {
  s.beat("v-bg", { at: 0.3, description: "竖版：blob 纵排、漂移纵向" });
  s.ellipse("base-1", { width: 820, height: 620, fill: "#312e81", opacity: 0.18,
    blur: 160, at: { x: "50%", y: "28%" } });          // 竖版 blob 更圆更集中
  s.ellipse("base-2", { width: 720, height: 560, fill: "#0e7490", opacity: 0.14,
    blur: 150, at: { x: "44%", y: "62%" } });
  s.ellipse("drift-1", { width: 600, height: 440, fill: "#6d28d9", opacity: 0.16,
    blur: 140, at: { x: "56%", y: "40%" },
    enter: { effect: "slide-up", duration: 9, delay: 0.2, easing: "linear",
      params: { distance: 180 } } });                 // 纵向漂移 20px/s
  s.text("title", "deep focus", { size: 76, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "44%" }, enter: { effect: "blur-up", duration: 0.6, delay: 0.3 } });
});
v.audio("bgm", "assets/audio/ambient-loop.mp3", { volume: 0.5, fadeIn: 1.5, fadeOut: 2, loop: true });
```

竖版与音轨纪律：blob 纵排三站（28%/62% 之外加漂移层的动态站）；漂移全改 slide-up（竖屏的「呼吸」方向是纵向的）；BGM 音量 <= 0.5 且 fadeIn >= 1.5s（氛围轨不能「砸」进场）；loop 轨必须配 fadeOut（循环背景配无淡出的音轨，循环点会「咔」一下）。

Recipe 5——静帧封面版（背景 + 截图叠放）：氛围背景上叠一张**静止的产品截图/封面图**——blob 全部后声明（底）、图最后声明（顶），一次性 fade 入场后全静：
（声明序即叠序：blob -> 半透明底板 -> 截图 -> 标题；底板是 blob 与截图之间的「隔层」，防高对比截图把氛围吃穿。）

```ts
v.scene("ambient-cover", { duration: 8.0, background: "#05070d" }, (s) => {
  s.beat("cover-alive", { at: 0.3, description: "背景在漂，截图与标题已静" });
  s.ellipse("base-1", { width: 1100, height: 700, fill: "#312e81", opacity: 0.18,
    blur: 170, at: { x: "34%", y: "42%" } });          // 静态底：frame-0 ink
  s.ellipse("drift-1", { width: 760, height: 520, fill: "#6d28d9", opacity: 0.16,
    blur: 150, at: { x: "68%", y: "38%" },
    enter: { effect: "slide-left", duration: 9, delay: 0.2, easing: "linear",
      params: { distance: 200 } } });                 // 22px/s 往左缓漂
  s.rect("plate", { width: 900, height: 560, fill: "#05070d", opacity: 0.55,
    radius: 18, at: { x: "50%", y: "46%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });   // 隔层底板
  s.image("shot", "assets/images/cover-shot.png", { width: 840, height: 500,
    radius: 12, at: { x: "50%", y: "46%" },
    enter: { effect: "fade", duration: 0.6, delay: 0.4 } });   // 静帧截图：一次性入场
  s.text("caption", "ambient cover, one still frame", { size: 34, color: "#94a3b8",
    at: { x: "50%", y: "76%" }, enter: { effect: "fade", duration: 0.5, delay: 0.9 } });
});
```

静帧版纪律四条：截图层 `enter fade` 一次（fade 比 blur-up 合适——图片自带高频细节，blur 入场会糊一下再清晰，读作「加载」）；底板 opacity 0.5-0.6（隔层不是遮罩，blob 要能透出来一点）；截图尺寸 <= 画幅一半（氛围才是主体，截图是静物）；caption 是唯一文本、一次性入场（前景静纪律在静帧版一字不改）。

变体速查（常见需求 -> 处理法，都在本技能内解决）：

| 需求 | 处理法 | 参考 |
| --- | --- | --- |
| 三站色相（冷 -> 中 -> 暖） | 三景各一 hue 组，两段 crossfade 1.0s | Recipe 2 复制 |
| 单一色相深化（同 hue 不同亮度） | hue 组全取同色系梯度（#312e81/#1e1b4b/#0e7490） | Recipe 1 |
| 封面帧要更安静 | 漂移层降到 2 层、速度 <= 15px/s | 速度表 |
| 背景上叠静帧截图 | 截图后声明 + 半透明底板隔一层 | Recipe 3 声明序 |
| 纯背景无前景（给别的视频当底） | 删全部 text 层，hold 拉满场景时长 | 前景纪律 |
| 要 grain 颗粒感 | 本 DSL 无噪点原语——如实告知局限，用 blur 层次代替 | 诚实边界 |

## QA gates

- `expect(frame(0)).not.toBeBlack()`——静态底 blob（无 enter）承包 frame-0 ink；漂移层淡入再慢也不许承包这一帧。
- `expect(frame(30)).toContainText("deep focus")`——1s 钩子，前景字比漂移先定型。
- 前景静门：全部文本层的入场完成 <= 场景 20% 时刻；此后无任何前景层再入场（`render.preview` 中段帧与尾帧前景逐像素同位）。
- 漂移门：每层 distance / duration <= 40px/s；任意两层速度差 <= 8px/s（同档不同速）。
- blob 门：单层 opacity <= 0.22；层数 <= 5（含静态底）；blur >= 120（低于 120 开始有「形状感」，背景就露馅了）。
- 色相过渡门（Recipe 2）：两景 blob 的 at/width/height/blur 逐项相同（QA 表里逐层比对）；crossfade 0.8-1.2s；前景字两景原样。
- `noTextOverflow()`（前景字 84-96px 是唯一文本）；`durationBetween`：单景 6-15s、hue 站点数 = 景数。
- camera 门：全片最多一次微推，to - from <= 0.03。
- 静音规则：氛围视频本来就无声可读（前景字即全部信息）；BGM 是本体裁的可选增强而非依赖。
- 交付门：hue 路径（冷 -> 暖的站点清单）与前景文案写进交付说明；用户确认 hue 组后再 render.final。
- 声明序门：全部 blob 层先声明、前景字最后声明（painter's order）；截图叠放版再加底板隔离层。
- 静态底门：每景至少两层无 enter 的 blob；漂移层不得承担 frame-0 ink。

## Anti-patterns

- 漂移超过 40px/s——果冻抖；背景一抢戏，前景标题就成了贴在糖纸上的标签。
- 前景加动效（呼吸/闪烁/逐字入场）——背景动一分前景静十分；前景要动效就换 kinetic-typography，别把两个体裁焊在一起。
- 全部 blob 同向同速——读作整张图平移；各走各向、速度同档，才是「活」。
- blob opacity > 0.25——开始吃前景对比度；氛围的亮度预算就到 0.22。
- 色相过渡用 cut 或 fade-black——cut 是换台、fade-black 是世界重启；「渐变」的体裁命就在 crossfade。
- 色相过渡换几何——crossfade 出来的读感是换幕；几何逐项冻结是前提不是建议。
- 无静态底 blob——漂移层从透明淡入，frame 0 是纯黑（`not.toBeBlack` 直接红）。
- 五层以上 blob——渲染模糊预算撑不住，层次糊成一锅；三到五层是全部答案。
- camera 大推（> 0.03）——镜头一动，「呼吸感」变「运镜感」，体裁就换成 cinematic-video 了。
- 拿本技能做主视觉——背景系统是「底」；主角叙事（词标、图表、金句）各有各的技能，这里只借氛围。
- 伪造 grain/噪点——v1 无噪点原语；拿小尺寸 rect 网格硬凑是像素风（style-shorts 的地盘），如实告知局限是正解。

## 链路与交接

| 场景 | 该用谁 | 边界 |
| --- | --- | --- |
| 活的渐变背景（blob + hue 过渡） | 本技能 | 产出「底」 |
| 科技片头（grid + 词标是主角） | tech-intro | 词标主导的 opener |
| 像素/瑞士风格（禁 blur） | style-shorts | 两式明令禁 blur |
| 品牌色 token 化与 reskin | brand-kit | hue 组从 token 取 |
| 循环版（首尾一致化） | gif-loop | 循环收尾 |
| 音乐可视化主体 | audio-react | 节拍驱动前景时 |
| 词标要大动效 | kinetic-typography / logo-reveal | 前景动效的家 |

接出本技能时带走三样：速度预算表（<= 40px/s、层间差 <= 8px/s）、色相过渡的几何冻结前提、前景一次性入场纪律。hue 组与前景文案在交付说明里写清，供用户确认氛围再定稿。
