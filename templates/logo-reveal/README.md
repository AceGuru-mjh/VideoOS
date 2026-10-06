# logo-reveal — Logo 揭示（5s · 16:9）

遮罩滑开自左向右露出标志 + 光带横扫 + 副标语淡入 + 2.5 秒静止定版。文字版 Logo 零素材。

## 何时用

品牌 Sting、频道包装、片尾定版、赞助商露出——只做亮相 + 定版。

## 怎么改

- `WORDMARK` / `TAGLINE` / `BRAND`：标志文字（≤ 6 字符）、副标语（≤ 6 词）、品牌色。
- 有 Logo 文件（透明 PNG）：`asset.add` 后把 wordmark 层换成 `s.image("logo", "assets/logo.png", { width, height, at })`——
  必须声明宽高（缺省是整幅画布），且仍声明在 mask 之前。
- 遮罩数学：`distance = 终点 x − 960`；遮罩宽高要能完全盖住标志再滑出画布。
- 禁用相机：推满全场景的 push-in 会让"静止定版"永远在动。
