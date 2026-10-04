// ModelRouter 测试：规则路由 / prefer 顺序 / fallback / PROVIDER_NONE
import { describe, expect, it } from "bun:test";
import { ManualProvider } from "./providers/manual";
import { ModelRouter, RouterError } from "./router";
import type { RouterRule } from "./router";

function provider(id: string): ManualProvider {
  return new ManualProvider({ id, script: [{ content: `reply-from-${id}` }] });
}

describe("ModelRouter", () => {
  it("无规则 → fallback 第一个注册的 provider", () => {
    const router = new ModelRouter([provider("a"), provider("b")]);
    expect(router.route().id).toBe("a");
    expect(router.route("vision").id).toBe("a");
    expect(router.route("code").id).toBe("a");
  });

  it("规则命中 → 按 prefer 顺序取第一个已注册的", () => {
    const rules: RouterRule[] = [
      { task: "vision", prefer: ["glm-v", "gpt-4o"] },
      { task: "code", prefer: ["deepseek", "gpt-4.1"] },
      { task: "fast", prefer: ["qwen-flash"] },
    ];
    const router = new ModelRouter([provider("gpt-4.1"), provider("glm-v"), provider("qwen-flash")], rules);
    expect(router.route("vision").id).toBe("glm-v");      // prefer 第一存在
    expect(router.route("code").id).toBe("gpt-4.1");     // deepseek 未注册 → 顺延
    expect(router.route("fast").id).toBe("qwen-flash");
    expect(router.route("default").id).toBe("gpt-4.1");  // 无 default 规则 → fallback
  });

  it("规则全部未命中 → fallback 第一个 provider", () => {
    const router = new ModelRouter([provider("a")], [{ task: "vision", prefer: ["x", "y"] }]);
    expect(router.route("vision").id).toBe("a");
  });

  it("无 provider → RouterError PROVIDER_NONE", () => {
    const router = new ModelRouter([]);
    expect(() => router.route()).toThrow(RouterError);
    expect(() => router.route()).toThrow(/PROVIDER_NONE/);
  });

  it("register 动态注册后可路由", () => {
    const router = new ModelRouter([provider("a")], [{ task: "vision", prefer: ["v"] }]);
    expect(router.route("vision").id).toBe("a");
    router.register(provider("v"));
    expect(router.route("vision").id).toBe("v");
    expect(router.get("v")?.model).toBe("manual-script");
    expect(router.list().map((p) => p.id)).toEqual(["a", "v"]);
  });
});
