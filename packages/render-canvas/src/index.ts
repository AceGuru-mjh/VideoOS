// @videoos/render-canvas：参考渲染后端（@napi-rs/canvas / Skia）
export { createRenderer } from "./renderer";
export { registerFonts, resolveFontFamily } from "./fonts";
export { fontString, measureTextWidth } from "./text";
export { RenderError } from "./types";
export type { FontRegistration, RenderOptions, RenderedFrame, Renderer, TextMetrics } from "./types";
