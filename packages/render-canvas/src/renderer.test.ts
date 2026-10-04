// render-canvas 渲染后端测试：样例帧栅格化 / 像素断言 / 确定性 / 字体 / 过渡 / 错误路径（禁止网络依赖）
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { Canvas } from "@napi-rs/canvas";
import { buildSampleDefinition, compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { defineVideo } from "@videoos/dsl";
import { createRenderer } from "./renderer";
import { RenderError } from "./types";
import type { RenderedFrame, Renderer } from "./types";

const DEJAVU_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
/** 测试图像 fixture：256×256 纯色 #ff00ff（与样例中 features 场景内容颜色无冲突） */
const FIXTURE_ROOT = join(tmpdir(), "videoos-render-tests");
const LOGO_PATH = join(FIXTURE_ROOT, "assets/images/logo.png");
const LOGO_COLOR: [number, number, number] = [255, 0, 255];

let compiled: CompileResult;
let renderer: Renderer;

beforeAll(() => {
  // 生成确定性图像 fixture（assets/images/logo.png，供样例 logo 图层加载）
  const img = createCanvas(256, 256);
  const ictx = img.getContext("2d");
  ictx.fillStyle = "#ff00ff";
  ictx.fillRect(0, 0, 256, 256);
  mkdirSync(join(FIXTURE_ROOT, "assets/images"), { recursive: true });
  writeFileSync(LOGO_PATH, img.toBuffer("image/png"));

  compiled = compile(buildSampleDefinition(), { assetRoot: FIXTURE_ROOT });
  renderer = createRenderer(compiled, { assetRoot: FIXTURE_ROOT });
});

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

function pixel(frame: RenderedFrame, x: number, y: number): [number, number, number, number] {
  const ctx = (frame.canvas as Canvas).getContext("2d");
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/** 区域内亮度超阈值的像素数（文字存在性采样） */
function countBright(frame: RenderedFrame, x0: number, y0: number, x1: number, y1: number, minLuma: number): number {
  const ctx = (frame.canvas as Canvas).getContext("2d");
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= minLuma) n++;
  }
  return n;
}

function pngDims(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("render-canvas：基础契约", () => {
  test("totalFrames = secondsToFrames(duration, fps)（样例 9.5s@30fps → 285）", () => {
    expect(renderer.totalFrames).toBe(285);
    expect(renderer.vir.meta.width).toBe(1920);
  });

  test("第 0 帧：PNG 非空、尺寸 1920×1080、width/height 字段为逻辑尺寸", () => {
    const f = renderer.renderFrame(0);
    expect(f.frame).toBe(0);
    expect(f.width).toBe(1920);
    expect(f.height).toBe(1080);
    const png = f.toPng();
    expect(png.length).toBeGreaterThan(1000);
    expect(pngDims(png)).toEqual([1920, 1080]);
  });

  test("toDataUrl 输出 PNG base64 前缀", () => {
    expect(renderer.renderFrame(0).toDataUrl().startsWith("data:image/png;base64,")).toBe(true);
  });

  test("越界帧 clamp：-5 → 0、99999 → 284", () => {
    expect(renderer.renderFrame(-5).frame).toBe(0);
    expect(renderer.renderFrame(99999).frame).toBe(284);
    expect(Buffer.compare(renderer.renderFrame(-5).toPng(), renderer.renderFrame(0).toPng())).toBe(0);
    expect(Buffer.compare(renderer.renderFrame(99999).toPng(), renderer.renderFrame(284).toPng())).toBe(0);
  });

  test("非有限帧号抛 RenderError", () => {
    expect(() => renderer.renderFrame(Number.NaN)).toThrow(RenderError);
    expect(() => renderer.renderFrame(Number.POSITIVE_INFINITY)).toThrow(/RENDER_INVALID_FRAME/);
  });

  test("renderRange 闭区间 + onFrame 下标回调", () => {
    const seen: { frame: number; i: number }[] = [];
    const frames = renderer.renderRange(60, 64, (f, i) => seen.push({ frame: f.frame, i }));
    expect(frames).toHaveLength(5);
    expect(frames.map((f) => f.frame)).toEqual([60, 61, 62, 63, 64]);
    expect(seen.map((s) => s.i)).toEqual([0, 1, 2, 3, 4]);
    expect(seen.every((s) => Number.isInteger(s.frame))).toBe(true);
  });

  test("renderRange 两端 clamp（-10..100000 → 285 帧）；from > to 返回空", () => {
    const all = renderer.renderRange(-10, 100000);
    expect(all).toHaveLength(285);
    expect(all[0]!.frame).toBe(0);
    expect(all[284]!.frame).toBe(284);
    expect(renderer.renderRange(60, 50)).toHaveLength(0);
  });

  test("deviceScale=2：PNG 物理尺寸翻倍，逻辑尺寸不变", () => {
    const r2 = createRenderer(compiled, { assetRoot: FIXTURE_ROOT, deviceScale: 2 });
    const f = r2.renderFrame(0);
    expect(f.width).toBe(1920);
    expect(f.height).toBe(1080);
    expect(pngDims(f.toPng())).toEqual([3840, 2160]);
  });
});

describe("render-canvas：像素级确定性", () => {
  test("同帧渲染两次 PNG buffer 相等（首帧/过渡段/末帧）", () => {
    for (const frame of [0, 112, 150, 284]) {
      const a = renderer.renderFrame(frame).toPng();
      const b = renderer.renderFrame(frame).toPng();
      expect(Buffer.compare(a, b)).toBe(0);
    }
  });

  test("不同帧内容确实不同（防全同退化）", () => {
    const a = renderer.renderFrame(0).toPng();
    const b = renderer.renderFrame(60).toPng();
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});

describe("render-canvas：内容像素断言", () => {
  test("frame 60：标题区域大量亮像素（文字真实绘制）且中心不透明", () => {
    const f = renderer.renderFrame(60);
    // 标题中心 (960, 432)，相机 scale 1.07 → 约 (960, 424)；采样带状区域
    expect(countBright(f, 660, 340, 1260, 510, 200)).toBeGreaterThan(300);
    const [r, g, b, a] = pixel(f, 960, 540);
    expect(a).toBe(255);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  test("frame 150：ellipse 命中 #22d3ee", () => {
    const [r, g, b, a] = pixel(renderer.renderFrame(150), 576, 540);
    expect(a).toBe(255);
    expect(Math.abs(r - 34)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 211)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 238)).toBeLessThanOrEqual(3);
  });

  test("frame 150：image 命中 fixture 颜色（Image 缓存 + drawImage）", () => {
    const [r, g, b, a] = pixel(renderer.renderFrame(150), 1344, 540);
    expect(a).toBe(255);
    expect(Math.abs(r - LOGO_COLOR[0])).toBeLessThanOrEqual(3);
    expect(Math.abs(g - LOGO_COLOR[1])).toBeLessThanOrEqual(3);
    expect(Math.abs(b - LOGO_COLOR[2])).toBeLessThanOrEqual(3);
  });
});

describe("render-canvas：效果与变换", () => {
  test("rect rotation=45°：中心在菱形内、原角落位置在菱形外", () => {
    const def = defineVideo({ title: "rot", background: "#000000" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.rect("r", { width: 200, height: 200, fill: "#ffffff", at: { x: "50%", y: "50%" }, rotation: 45 });
      });
    });
    const r = createRenderer(compile(def));
    const f = r.renderFrame(0);
    const center = pixel(f, 960, 540);
    expect(center[0]).toBeGreaterThanOrEqual(250);
    const corner = pixel(f, 1050, 630); // 未旋转时在方形内（|90|<100），旋转后 |90|+|90|=180 > 100 → 落在菱形外
    expect(corner[0]).toBeLessThanOrEqual(5);
  });

  test("blur：矩形中心保持亮、远处衰减为暗", () => {
    const def = defineVideo({ title: "blur", background: "#000000" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.rect("b", { width: 300, height: 300, fill: "#ffffff", blur: 20, at: { x: "50%", y: "50%" } });
      });
    });
    const f = createRenderer(compile(def)).renderFrame(0);
    expect(pixel(f, 960, 540)[0]).toBeGreaterThanOrEqual(200);
    expect(pixel(f, 960, 790)[0]).toBeLessThanOrEqual(80); // 边缘外 100px
  });

  test("wipe：文本按启发式裁剪盒裁剪（盒外像素为背景）", () => {
    const def = defineVideo({ title: "wipe", background: "#000000" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("w", "WWWWWWWW", { size: 80, color: "#ffffff", at: { x: "50%", y: "50%" }, enter: { effect: "wipe", duration: 1 } });
      });
    });
    const f = createRenderer(compile(def)).renderFrame(15); // t=0.5, e=0.875 → clip [761.6, 1108.8]
    // 裁剪盒内有文字墨迹（W 字形行带），裁剪盒右界之外（但仍在文本自然宽度内）无墨迹
    expect(countBright(f, 762, 500, 1108, 580, 200)).toBeGreaterThan(300);
    expect(countBright(f, 1110, 500, 1290, 580, 200)).toBe(0);
  });

  test("camera push-in：整帧绕画面中心放大", () => {
    const def = defineVideo({ title: "cam", width: 640, height: 360, background: "#ffffff" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.rect("r", { width: 200, height: 200, fill: "#ff0000", at: { x: "25%", y: "50%" } });
        s.camera("push-in", { from: 1, to: 2 });
      });
    });
    const r = createRenderer(compile(def));
    const f0 = r.renderFrame(0); // scale = 1：矩形占 x∈[60,260]
    expect(pixel(f0, 160, 180)[1]).toBeLessThanOrEqual(5); // 矩形中心红（g 通道区分红/白）
    expect(pixel(f0, 40, 180)[1]).toBeGreaterThanOrEqual(250); // 矩形外白底
    const f29 = r.renderFrame(29); // scale ≈ 2：矩形中心映射到 x≈0，占 x∈[-200,200]
    expect(pixel(f29, 50, 180)[1]).toBeLessThanOrEqual(5); // 放大后覆盖（红）
    expect(pixel(f29, 300, 180)[1]).toBeGreaterThanOrEqual(250); // 放大后露出右侧白底
  });

  test("fade-black：过渡中点叠加黑幕（比 crossfade 更暗，且末尾不吞掉后场景）", () => {
    const mk = (type: "fade-black" | "crossfade") =>
      defineVideo({ title: `t-${type}`, background: "#ffffff" }, (v) => {
        v.scene("a", { duration: 1.5, background: "#ffffff" }, (s) => {
          s.rect("ra", { width: 100, height: 100, fill: "#ff0000", at: { x: "10%", y: "10%" } });
        });
        v.scene("b", { duration: 1.5, background: "#ffffff" }, (s) => {
          s.ellipse("eb", { width: 120, height: 120, fill: "#0000ff", at: { x: "80%", y: "80%" } });
        });
        v.transition(type, { duration: 1, between: ["a", "b"] });
      });
    const fadeMid = createRenderer(compile(mk("fade-black"))).renderFrame(30); // t=1.0, progress 0.5
    const crossMid = createRenderer(compile(mk("crossfade"))).renderFrame(30);
    // crossfade：白底 + 后场景白背景 rect α=0.5 → 中心仍纯白
    expect(pixel(crossMid, 960, 540)[0]).toBeGreaterThanOrEqual(250);
    // fade-black：白底 → 黑幕 α=0.5 (127.5) → 后场景白背景 rect α=0.5 → ≈191
    const [fr, fg, fb] = pixel(fadeMid, 960, 540);
    expect(fr).toBeGreaterThanOrEqual(160);
    expect(fr).toBeLessThanOrEqual(220);
    expect(Math.abs(fr - fg)).toBeLessThanOrEqual(2);
    expect(Math.abs(fg - fb)).toBeLessThanOrEqual(2);
    // 过渡结束后一帧（t=1.533）后场景正常全亮，不被黑幕吞掉
    const after = createRenderer(compile(mk("fade-black"))).renderFrame(46);
    expect(pixel(after, 1536, 864)[2]).toBeGreaterThanOrEqual(250); // 蓝色 ellipse 完整可见
    expect(pixel(after, 960, 540)[0]).toBeGreaterThanOrEqual(250); // 白背景
  });
});

describe("render-canvas：字体", () => {
  test("注册 DejaVuSans-Bold 为 TestFont 并渲染 text 不抛错、文字可见", () => {
    const def = defineVideo({ title: "font", background: "#000000" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("t", "Ag 123 Bold", { font: "TestFont", size: 100, weight: 700, color: "#ffffff", at: { x: "50%", y: "50%" } });
      });
    });
    const r = createRenderer(compile(def), {
      fonts: [{ family: "TestFont", path: DEJAVU_BOLD }],
    });
    const f = r.renderFrame(15);
    expect(countBright(f, 700, 470, 1220, 610, 200)).toBeGreaterThan(50);
  });

  test("字体文件缺失抛 RENDER_FONT_FILE_MISSING", () => {
    const def = defineVideo({ title: "font-missing" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("t", "x", { font: "Nope", size: 40 });
      });
    });
    expect(() =>
      createRenderer(compile(def), { fonts: [{ family: "Nope", path: "/nonexistent/font.ttf" }] }),
    ).toThrow(/RENDER_FONT_FILE_MISSING/);
  });
});

describe("render-canvas：measureText（QA 溢出检测）", () => {
  test("按图层名/图层 id 测量：width>0、height = size × lineHeight", () => {
    const byName = renderer.measureText("title", "intro");
    expect(byName.width).toBeGreaterThan(400); // "VideoOS" @140px
    expect(byName.width).toBeLessThan(2000);
    expect(byName.height).toBeCloseTo(140 * 1.2, 10);
    const byId = renderer.measureText("layer_intro_title", "scene_intro");
    expect(byId.width).toBeCloseTo(byName.width, 10);
    expect(renderer.measureText("layer_intro_title").width).toBeCloseTo(byName.width, 10);
  });

  test("letterSpacing 计入宽度测量", () => {
    const noSpacing = renderer.measureText("layer_intro_title");
    const def = defineVideo({ title: "ls" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("a", "VideoOS", { size: 140, weight: 800 });
        s.text("b", "VideoOS", { size: 140, weight: 800, letterSpacing: 20 });
      });
    });
    const r = createRenderer(compile(def));
    const w0 = r.measureText("layer_s_a").width;
    const w1 = r.measureText("layer_s_b").width;
    expect(w1 - w0).toBeGreaterThan(7 * 15); // 至少 7 个字符间距（末字符间距容差）
    expect(w0).toBeCloseTo(noSpacing.width, 5); // 与样例同参数文本等宽（同字体回退）
  });

  test("非 text 图层 / 不存在图层 / 限定场景查找失败 抛错", () => {
    expect(() => renderer.measureText("glow", "intro")).toThrow(/RENDER_LAYER_NOT_TEXT/);
    expect(() => renderer.measureText("nope")).toThrow(/RENDER_TEXT_LAYER_NOT_FOUND/);
    expect(() => renderer.measureText("layer_intro_title", "features")).toThrow(/RENDER_TEXT_LAYER_NOT_FOUND/);
  });
});

describe("render-canvas：错误路径", () => {
  test("图像文件缺失：renderFrame 抛 RENDER_IMAGE_MISSING", () => {
    const def = defineVideo({ title: "img-missing" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.image("i", "assets/images/missing.png", { width: 100, height: 100 });
      });
    });
    const r = createRenderer(compile(def), { assetRoot: FIXTURE_ROOT });
    expect(() => r.renderFrame(0)).toThrow(/RENDER_IMAGE_MISSING/);
  });

  test("http src 不受支持：抛 RENDER_IMAGE_UNSUPPORTED_SRC", () => {
    const def = defineVideo({ title: "img-http" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.image("i", "https://example.com/x.png", { width: 100, height: 100 });
      });
    });
    const r = createRenderer(compile(def));
    expect(() => r.renderFrame(0)).toThrow(/RENDER_IMAGE_UNSUPPORTED_SRC/);
  });

  test("非法 deviceScale / assetRoot 抛错", () => {
    expect(() => createRenderer(compiled, { deviceScale: 0 })).toThrow(/RENDER_INVALID_DEVICE_SCALE/);
    expect(() => createRenderer(compiled, { assetRoot: "" })).toThrow(/RENDER_INVALID_ASSET_ROOT/);
  });
});
