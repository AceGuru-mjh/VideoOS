# VideoOS 模板库

8 个**完整可编译**的视频模板 —— Agent 脚手架（`template.apply`）与人类创作者的共同起点。
让普通模型不必从零写 DSL：套用模板 → 只改文案/颜色/数据常量 → 编译预览即得成片。

| 模板 | 时长 | 比例 | 一句话场景 |
| --- | --- | --- | --- |
| product-intro | 30s | 16:9 | 产品介绍：痛点钩子→方案→三特性→大数字→CTA |
| tech-intro | 6s | 16:9 | 科技感片头：网格背景+大标题 blur-up+推近镜头 |
| kinetic-typography | 8s | 16:9 | 纯文字动效：逐字波浪+同位换词+关键词定格 |
| quote-card | 8s | 1:1 | 金句卡片：巨引号+打字机+关键句弹出+署名 |
| countdown | 5s | 16:9 | 倒计时：数字向上翻滚+每秒脉冲+定版 |
| logo-reveal | 5s | 16:9 | Logo 揭示：遮罩滑出+光带横扫+静止定版 |
| comparison | 12s | 16:9 | 产品对比：分屏板+三回合数据+裁决帧 |
| data-dashboard | 15s | 16:9 | 数据看板：KPI 计数+双卡成对+六柱阶梯生长 |

## 用法

- **Agent（对话式）**：直接对 Agent 描述需求；或显式 `@tech-intro` 引用技能 / 「用 countdown 模板做一个 5 秒倒计时」。
  工具链：`template.list`（按关键词筛）→ `template.inspect`（看完整源码）→ `template.apply`（写入当前项目入口并自动编译）。
- **人类（IDE/CLI）**：复制任一目录作为项目起点（`video.project.json` + `src/video.ts` 即完整项目）。

## 质量门禁

每个模板在 CI（`packages/server/src/chat/templates.test.ts`）中通过：

1. 编译门禁：真实 DSL → VIR 编译，**零 error 零 warning**，清单时长与 VIR 一致（±0.05s）；
2. 渲染冒烟：首帧/中位帧/尾帧均可渲染（零素材、零音频依赖、静音成立）；
3. 设计守则：1 秒可读钩子、stagger 0.3-0.45s、结尾静止 ≥0.8s、语义命名、帧数注释。

## 结构

```
templates/<name>/
├── template.json        # 清单：title/description/tags/durationSeconds/aspect/useCases
├── video.project.json   # 项目清单（与 examples/ 同构）
├── src/video.ts         # 完整 defineVideo 视频源码（40-90 行）
└── README.md            # 定制指引（改哪些常量）
```
