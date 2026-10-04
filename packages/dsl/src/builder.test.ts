// DSL builder 测试：样例构建、默认值填充、全部即时校验错误
import { describe, expect, test } from "bun:test";
import { defineVideo, DslError, VIDEO_EFFECTS } from "./index";
import type { VideoBuilder } from "./index";

function buildSample() {
  return defineVideo({ title: "VideoOS Launch", seed: 42 }, (v) => {
    v.scene("intro", { duration: 4, background: "#101020" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "主标题入场" });
      s.beat("logo-reveal", { at: 1.5 });
      s.rect("glow", { width: 600, height: 600, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: "50%", y: "40%" } });
      s.text("title", "VideoOS", {
        size: 140, weight: 800, at: { x: "50%", y: "40%" },
        enter: { effect: "blur-up", duration: 0.8 },
      });
      s.text("subtitle", "Programmable Video Runtime", {
        size: 42, color: "#8b8ba7", at: { x: "50%", y: "52%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });
      s.camera("push-in", { from: 1.0, to: 1.08 });
    });
    v.scene("features", { duration: 6 }, (s) => {
      s.ellipse("dot", { width: 200, height: 200, fill: "#22d3ee", at: { x: "30%", y: "50%" }, enter: { effect: "scale-pop" } });
      s.image("logo", "assets/images/logo.png", { width: 256, height: 256, at: { x: "70%", y: "50%" } });
      s.text("typed", "Hello VideoOS", { size: 48, font: "Inter", at: { x: "50%", y: "80%" }, enter: { effect: "typewriter", duration: 1.2 } });
      s.text("outro", "bye", { size: 32, in: 5.0, out: 6.0, exit: { effect: "fade", duration: 0.5 } });
    });
    v.transition("crossfade", { duration: 0.5, between: ["intro", "features"] });
    v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.8, fadeIn: 1, fadeOut: 2 });
  });
}

describe("defineVideo 样例构建", () => {
  test("完整样例不抛错且结构正确", () => {
    const def = buildSample();
    expect(def.kind).toBe("videoos-definition");
    expect(def.version).toBe("1.0");
    const { program } = def;
    expect(program.meta).toEqual({ title: "VideoOS Launch", width: 1920, height: 1080, fps: 30, background: "#0a0a12", seed: 42 });
    expect(program.scenes).toHaveLength(2);

    const intro = program.scenes[0]!;
    expect(intro.id).toBe("scene_intro");
    expect(intro.name).toBe("intro");
    expect(intro.duration).toBe(4);
    expect(intro.background).toBe("#101020");
    expect(intro.camera).toEqual({ type: "push-in", params: { from: 1.0, to: 1.08 } });
    expect(intro.layers.map((l) => l.id)).toEqual(["layer_intro_glow", "layer_intro_title", "layer_intro_subtitle"]);
    expect(intro.beats.map((b) => b.id)).toEqual(["beat_intro_title-enter", "beat_intro_logo-reveal"]);
    expect(intro.beats[0]!.description).toBe("主标题入场");
  });

  test("默认值填充（out=场景时长 / at 居中 / 动画默认）", () => {
    const def = buildSample();
    const glow = def.program.scenes[0]!.layers[0]!;
    expect(glow.in).toBe(0);
    expect(glow.out).toBe(4);
    expect(glow.transform).toEqual({
      anchor: { x: 0.5, y: 0.5 },
      position: { x: "50%", y: "40%" },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 0.25,
    });
    expect(glow.animations).toEqual([]);
    expect(glow.type === "rect" && glow.rect).toEqual({ width: 600, height: 600, fill: "#6d28d9", blur: 120 });

    const title = def.program.scenes[0]!.layers[1]!;
    expect(title.animations).toEqual([
      { type: "enter", effect: "blur-up", duration: 0.8, delay: 0, easing: "easeOutCubic" },
    ]);
    expect(title.type === "text" && title.text).toEqual({
      content: "VideoOS", font: "sans-serif", size: 140, weight: 800,
      color: "#ffffff", align: "center", letterSpacing: 0, lineHeight: 1.2,
    });

    const typed = def.program.scenes[1]!.layers[2]!;
    expect(typed.type === "text" && typed.text.font).toBe("Inter");
    const outro = def.program.scenes[1]!.layers[3]!;
    expect(outro.in).toBe(5);
    expect(outro.out).toBe(6);
    expect(outro.animations).toEqual([{ type: "exit", effect: "fade", duration: 0.5, delay: 0, easing: "easeOutCubic" }]);
  });

  test("image 图层 src 与默认居中", () => {
    const def = buildSample();
    const logo = def.program.scenes[1]!.layers[1]!;
    expect(logo.type).toBe("image");
    expect(logo.src).toBe("assets/images/logo.png");
    expect(logo.transform.position).toEqual({ x: "70%", y: "50%" });
  });

  test("transition 与 audio 记录", () => {
    const def = buildSample();
    expect(def.program.transitions).toEqual([{ type: "crossfade", duration: 0.5, between: ["intro", "features"] }]);
    expect(def.program.audio).toEqual([{
      id: "audio_bgm", name: "bgm", src: "assets/audio/launch.mp3",
      start: 0, volume: 0.8, fadeIn: 1, fadeOut: 2,
    }]);
  });

  test("跨场景同名 layer 允许", () => {
    expect(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => { s.text("same", "x"); });
      v.scene("b", { duration: 1 }, (s) => { s.text("same", "y"); });
    })).not.toThrow();
  });
});

describe("即时校验错误", () => {
  const expectDslError = (fn: () => void, code: string): void => {
    let caught: unknown;
    try { fn(); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(DslError);
    expect((caught as DslError).code).toBe(code);
  };

  test("重复 scene 名 → DSL_DUPLICATE_SCENE", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, () => {});
      v.scene("a", { duration: 1 }, () => {});
    }), "DSL_DUPLICATE_SCENE");
  });

  test("同场景重复 layer 名 → DSL_DUPLICATE_LAYER", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.text("x", "hello");
        s.rect("x", { width: 10, height: 10, fill: "#fff" });
      });
    }), "DSL_DUPLICATE_LAYER");
  });

  test("未知 easing → DSL_UNKNOWN_EASING", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.text("x", "hi", { enter: { effect: "fade", easing: "easeInWarp" } });
      });
    }), "DSL_UNKNOWN_EASING");
  });

  test("未知 effect → DSL_UNKNOWN_EFFECT", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.text("x", "hi", { enter: { effect: "spin" } });
      });
    }), "DSL_UNKNOWN_EFFECT");
  });

  test("duration <= 0 → DSL_INVALID_DURATION", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 0 }, () => {});
    }), "DSL_INVALID_DURATION");
  });

  test("at 非法 → DSL_INVALID_POSITION", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.text("x", "hi", { at: { x: "middle", y: "50%" } });
      });
    }), "DSL_INVALID_POSITION");
  });

  test("out <= in → DSL_INVALID_TIME", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 2 }, (s) => {
        s.text("x", "hi", { in: 1, out: 1 });
      });
    }), "DSL_INVALID_TIME");
  });

  test("out 超出场景时长 → DSL_INVALID_TIME", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 2 }, (s) => {
        s.text("x", "hi", { out: 3 });
      });
    }), "DSL_INVALID_TIME");
  });

  test("beat at 超出场景 → DSL_INVALID_BEAT", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 2 }, (s) => {
        s.beat("late", { at: 5 });
      });
    }), "DSL_INVALID_BEAT");
  });

  test("重复 beat 名 → DSL_DUPLICATE_BEAT", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 2 }, (s) => {
        s.beat("b", { at: 0 });
        s.beat("b", { at: 1 });
      });
    }), "DSL_DUPLICATE_BEAT");
  });

  test("非法颜色 → DSL_INVALID_COLOR", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.rect("r", { width: 1, height: 1, fill: "red" });
      });
    }), "DSL_INVALID_COLOR");
  });

  test("非法 camera 类型 → DSL_UNKNOWN_CAMERA", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => {
        s.camera("orbit" as "pan", {});
      });
    }), "DSL_UNKNOWN_CAMERA");
  });

  test("transition 引用未知场景 → DSL_UNKNOWN_SCENE", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, () => {});
      v.transition("crossfade", { between: ["a", "ghost"] });
    }), "DSL_UNKNOWN_SCENE");
  });

  test("transition 非相邻场景 → DSL_NON_ADJACENT_TRANSITION", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, () => {});
      v.scene("b", { duration: 1 }, () => {});
      v.scene("c", { duration: 1 }, () => {});
      v.transition("crossfade", { between: ["a", "c"] });
    }), "DSL_NON_ADJACENT_TRANSITION");
  });

  test("transition 时长不小于场景 → DSL_INVALID_TRANSITION", () => {
    expectDslError(() => defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, () => {});
      v.scene("b", { duration: 2 }, () => {});
      v.transition("crossfade", { duration: 1, between: ["a", "b"] });
    }), "DSL_INVALID_TRANSITION");
  });

  test("空视频 → DSL_EMPTY_VIDEO", () => {
    expectDslError(() => defineVideo({ title: "t" }, () => {}), "DSL_EMPTY_VIDEO");
  });

  test("非法 meta → DSL_INVALID_META", () => {
    expectDslError(() => defineVideo({ title: "" }, () => {}), "DSL_INVALID_META");
    expectDslError(() => defineVideo({ title: "t", width: -100 } as never, () => {}), "DSL_INVALID_META");
  });
});

describe("VIDEO_EFFECTS", () => {
  test("包含 10 个命名效果", () => {
    expect(VIDEO_EFFECTS).toEqual([
      "fade", "slide-up", "slide-down", "slide-left", "slide-right",
      "blur-up", "blur-in", "scale-pop", "typewriter", "wipe",
    ]);
  });
});

describe("确定性 id", () => {
  test("同输入 → 同 program（字节级）", () => {
    const a = JSON.stringify(buildSample());
    const b = JSON.stringify(buildSample());
    expect(a).toBe(b);
  });

  test("builder 重复调用互不干扰", () => {
    let first: string | undefined;
    defineVideo({ title: "t" }, (v: VideoBuilder) => {
      v.scene("a", { duration: 1 }, (s) => { s.text("x", "1"); });
      first = v.constructor.name;
    });
    const def = defineVideo({ title: "t" }, (v) => {
      v.scene("a", { duration: 1 }, (s) => { s.text("x", "2"); });
    });
    expect(def.program.scenes[0]!.layers[0]!.type === "text" && def.program.scenes[0]!.layers[0]!.text.content).toBe("2");
    expect(first).toBeDefined();
  });
});
