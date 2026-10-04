import { defineConfig } from "tsup";

// 说明：任务原文的 `tsup src/index.ts --format esm --target node20 --output dist/cli.js
// --banner.js "#!/usr/bin/env node"` 中 `--output`/`--banner.js` 并非 tsup 8.5.1 CLI 选项
// （cac 直接报 Unknown option），改用本配置文件等价表达：
//   entry 键名 = 输出文件名（dist/cli.js）、banner 注入 shebang。
// - noExternal @videoos/*：tsup 默认把 package.json dependencies 全部 external，
//   而 workspace 包 exports 指向 .ts 源码（Node 虽可 strip types 但源码是
//   bundler 风格无扩展名导入，Node ESM 无法运行）→ 必须内联打包为单文件 dist/cli.js。
// - @napi-rs/canvas 为原生模块（含全平台 .node 条件 require，无法打包）→ external，
//   运行时从 node_modules 解析。
export default defineConfig({
  entry: { cli: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/^@videoos\//, "zod"],
  external: ["@napi-rs/canvas"],
});
