// render-svg 渲染后端测试：文档结构 / 命令映射 / XML 转义 / 过渡 / 相机 / 确定性（零网络、零栅格依赖）
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSampleDefinition, compile } from "@videoos/compiler";
import { defineVideo } from "@videoos/dsl";
import { createSvgRenderer } from "./renderer";

/** 与 render-canvas 测试共用同一 fixture 根（SVG 仅需路径字符串，不读取文件） */
const FIXTURE_ROOT = join(tmpdir(), "videoos-render-tests");
const LOGO_URI = pathToFileURL(join(FIXTURE_ROOT, "assets/images/logo.png")).href;

const compiled = compile(buildSampleDefinition(), { assetRoot: FIXTURE_ROOT });
const renderer = createSvgRenderer(compiled, { assetRoot: FIXTURE_ROOT });

describe("render-svg：基础契约", () => {
  test("第 0 帧：合法 <svg> 根 + viewBox + 背景整幅 rect + blur filter", () => {
    const f = renderer.renderFrame(0);
    expect(f.frame).toBe(0);
    expect(f.width).toBe(1920);
    expect(f.height).toBe(1080);
    expect(f.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">')).toBe(true);
    expect(f.svg.endsWith("</svg>")).toBe(true);
    expect(f.svg).toContain('<rect x="0" y="0" width="100%" height="100%" fill="#101020"/>');
    // glow（blur 120）→ feGaussianBlur stdDeviation 60，filter id 唯一化 frame+layerId
    expect(f.svg).toContain('<filter id="blur_f0_layer_intro_glow"');
    expect(f.svg).toContain('stdDeviation="60"');
    expect(f.svg).toContain('filter="url(#blur_f0_layer_intro_glow)"');
    expect(f.svg).toContain('opacity="0.25"');
  });

  test("totalFrames 与 clamp 契约", () => {
    expect(renderer.totalFrames).toBe(285);
    expect(renderer.renderFrame(-5).frame).toBe(0);
    expect(renderer.renderFrame(99999).frame).toBe(284);
    expect(() => renderer.renderFrame(Number.NaN)).toThrow(/RENDER_INVALID_FRAME/);
  });

  test("renderRange 闭区间；from > to 为空；toPng 恒为 undefined", () => {
    const frames = renderer.renderRange(60, 62);
    expect(frames.map((f) => f.frame)).toEqual([60, 61, 62]);
    expect(renderer.renderRange(60, 50)).toHaveLength(0);
    for (const f of frames) {
      expect(f.toPng).toBeUndefined();
      expect(f.svg.length).toBeGreaterThan(0);
    }
  });
});

describe("render-svg：命令映射", () => {
  test("draw-text：font/font-size/font-weight/anchor/baseline/letter-spacing", () => {
    const svg = renderer.renderFrame(60).svg;
    expect(svg).toContain("<text ");
    expect(svg).toContain(">VideoOS</text>");
    expect(svg).toContain(">Programmable Video Runtime</text>");
    expect(svg).toContain('font-family="\'sans-serif\', sans-serif"');
    expect(svg).toContain('font-size="140"');
    expect(svg).toContain('font-weight="800"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('dominant-baseline="middle"');
    expect(svg).toContain('letter-spacing="0"');
  });

  test("draw-text 指定字体 + typewriter 已裁剪 content（frame 112 → Hello V）", () => {
    const svg = renderer.renderFrame(112).svg;
    expect(svg).toContain('font-family="\'Inter\', sans-serif"');
    expect(svg).toContain(">Hello V</text>");
  });

  test("draw-ellipse：frame 150 命中 features 场景 dot", () => {
    const svg = renderer.renderFrame(150).svg;
    expect(svg).toContain('<ellipse cx="576" cy="540" rx="100" ry="100" fill="#22d3ee"');
  });

  test("draw-image：file:// 绝对 URI + preserveAspectRatio=none + 拉伸几何", () => {
    const svg = renderer.renderFrame(150).svg;
    expect(svg).toContain(`href="${LOGO_URI}"`);
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('x="1216" y="412" width="256" height="256"');
  });

  test("XML 转义：content 含 <&>\" 时正确转义", () => {
    const def = defineVideo({ title: "esc" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("t", 'A<b>&"c"', { size: 64 });
      });
    });
    const svg = createSvgRenderer(compile(def)).renderFrame(0).svg;
    expect(svg).toContain("A&lt;b&gt;&amp;&quot;c&quot;");
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("</text>");
  });

  test("rotation → transform rotate(deg, cx, cy)；radius → rx", () => {
    const def = defineVideo({ title: "attrs" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.rect("r", { width: 200, height: 200, fill: "#ffffff", at: { x: "50%", y: "50%" }, rotation: 45 });
        s.rect("rr", { width: 300, height: 200, fill: "#123456", radius: 30, at: { x: "50%", y: "20%" } });
      });
    });
    const svg = createSvgRenderer(compile(def)).renderFrame(0).svg;
    expect(svg).toContain('transform="rotate(45, 960, 540)"');
    expect(svg).toContain('rx="30"');
  });

  test("wipe → clipPath 裁剪盒（frame 15, e=0.875 → x=761.6 width=347.2）", () => {
    const def = defineVideo({ title: "wipe" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.text("w", "WWWWWWWW", { size: 80, color: "#ffffff", enter: { effect: "wipe", duration: 1 } });
      });
    });
    const svg = createSvgRenderer(compile(def)).renderFrame(15).svg;
    expect(svg).toContain('<clipPath id="clip_f15_layer_s_w">');
    expect(svg).toContain('<rect x="761.6" y="492" width="347.2" height="96"');
    expect(svg).toContain('clip-path="url(#clip_f15_layer_s_w)"');
  });

  test("blur 映射：blur 20 → stdDeviation 10（CSS blur 半径 ≈ 2σ，与 canvas 后端一致）", () => {
    const def = defineVideo({ title: "blur" }, (v) => {
      v.scene("s", { duration: 1 }, (s) => {
        s.rect("b", { width: 300, height: 300, fill: "#ffffff", blur: 20 });
      });
    });
    const svg = createSvgRenderer(compile(def)).renderFrame(0).svg;
    expect(svg).toContain('stdDeviation="10"');
  });
});

describe("render-svg：相机与过渡", () => {
  test("相机非恒等 → 外层 <g transform>；恒等 → 不包裹", () => {
    const withCam = renderer.renderFrame(60).svg; // intro push-in（scale 1.07）
    expect(withCam).toContain('transform="translate(960, 540) scale(1.07) translate(-960, -540)"');
    expect(withCam.split("<g transform=").length - 1).toBe(1);
    const identity = renderer.renderFrame(150).svg; // features 无相机
    expect(identity).not.toContain("<g transform=");
  });

  test("crossfade 过渡段（frame 112）：单一相机 g 包裹全部命令 + 后场景背景 opacity 渐入", () => {
    const svg = renderer.renderFrame(112).svg;
    expect(svg.split("<g transform=").length - 1).toBe(1);
    expect(svg).toContain('opacity="0.4667"'); // scene_features:bg × progress
    expect(svg.indexOf('fill="#0a0a12"')).toBeGreaterThan(0);
  });

  test("fade-black：黑幕 rect 位于主场景内容之后、后场景内容之前", () => {
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
    const svg = createSvgRenderer(compile(mk("fade-black"))).renderFrame(30).svg; // t=1.0, progress 0.5
    const curtain = '<rect x="0" y="0" width="1920" height="1080" fill="#000000" opacity="0.5"/>';
    expect(svg).toContain(curtain);
    expect(svg.indexOf(curtain)).toBeGreaterThan(svg.indexOf('fill="#ff0000"')); // 主场景之后
    expect(svg.indexOf(curtain)).toBeLessThan(svg.indexOf("<ellipse")); // 后场景之前
    // crossfade 无黑幕
    const cross = createSvgRenderer(compile(mk("crossfade"))).renderFrame(30).svg;
    expect(cross).not.toContain(curtain);
    expect(cross).not.toContain('fill="#000000"');
  });
});

describe("render-svg：确定性", () => {
  test("同帧两次生成字符串相等（首帧/过渡段/末帧）", () => {
    for (const frame of [0, 112, 150, 284]) {
      expect(renderer.renderFrame(frame).svg).toBe(renderer.renderFrame(frame).svg);
    }
  });

  test("不同帧字符串不同（防全同退化）", () => {
    expect(renderer.renderFrame(0).svg).not.toBe(renderer.renderFrame(60).svg);
  });

  test("数字输出无浮点噪声（截断到 4 位小数）", () => {
    const svg = renderer.renderFrame(112).svg;
    expect(svg).not.toMatch(/\.(\d{5,})/); // 不出现 5 位以上小数
    expect(svg).not.toContain("e-"); // 无科学计数法
  });
});
