// Dual-locale render smoke tests: react-dom/server static rendering (SSR,
// no jsdom) of the i18n React layer plus a small set of PURE components
// (verified: no zustand store, no api calls, no module/render-scope side
// effects) under both zh and en providers.
//
// API note: the repo pins react-dom 18.3.1, whose `react-dom/server` exports
// the sync static API as `renderToStaticMarkup` (renderToStaticString is the
// React 19 name for the same operation) — same semantics for these tests.
//
// Assertions target i18n BEHAVIOR (translated text, fallback, interpolation,
// locale persistence read path) — never full snapshots — so components can
// evolve (gain new strings, reorder markup) without breaking this suite.
//
// Skipped on purpose (impure — store/api dependencies): Welcome (useStudio),
// TopBar (useStudio), all chat panels (Composer/ContextPanel/SkillsPanel/
// McpPanel/MessageStream/SessionList/ChatView). TaskCard IS included: it is
// prop-driven with no store access.
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/chat/Markdown";
import { TaskCard } from "../components/chat/TaskCard";
import { Button, Chip, Modal, Section, Spinner } from "../components/ui";
import { I18nProvider, useI18n } from "./index";
import type { Locale } from "./core";

/** minimal window.localStorage stand-in — I18nProvider reads the stored locale
 *  during its first render; SSR never runs effects, so this is the only DOM
 *  touch during the static render. */
interface WindowLike {
  localStorage: { getItem: (key: string) => string | null };
}

function renderWithStoredLocale(stored: string | null, node: ReactElement): string {
  const g = globalThis as unknown as { window?: WindowLike };
  const prev = g.window;
  g.window = { localStorage: { getItem: () => stored } };
  try {
    return renderToStaticMarkup(node);
  } finally {
    g.window = prev;
  }
}

function render(locale: Locale, node: ReactElement): string {
  return renderWithStoredLocale(locale, <I18nProvider>{node}</I18nProvider>);
}

/** probe: renders one translated string through the real provider */
function Probe({ keyName, params }: { keyName: string; params?: Record<string, string | number> }): JSX.Element {
  const { t } = useI18n();
  return <p>{t(keyName, params)}</p>;
}

describe("I18nProvider 双语渲染（SSR）", () => {
  test("A: t() 经 Provider 输出对应语言（topbar.compile）", () => {
    const zhHtml = render("zh", <Probe keyName="topbar.compile" />);
    const enHtml = render("en", <Probe keyName="topbar.compile" />);
    expect(zhHtml).toContain("编译");
    expect(zhHtml).not.toContain("Compile");
    expect(enHtml).toContain("Compile");
    expect(enHtml).not.toContain("编译");
  });

  test("B: 缺失键回显键本身（两种语言一致，不崩溃）", () => {
    expect(render("zh", <Probe keyName="definitely.missing.key" />)).toContain("definitely.missing.key");
    expect(render("en", <Probe keyName="definitely.missing.key" />)).toContain("definitely.missing.key");
  });

  test("C: 参数插值经 Provider 生效（statusbar.diagTitle）", () => {
    const zhHtml = render("zh", <Probe keyName="statusbar.diagTitle" params={{ errors: 2, warnings: 3 }} />);
    const enHtml = render("en", <Probe keyName="statusbar.diagTitle" params={{ errors: 2, warnings: 3 }} />);
    expect(zhHtml).toContain("2 个错误，3 个警告");
    expect(enHtml).toContain("2 errors, 3 warnings");
  });

  test("持久化读取路径：localStorage 记录的偏好决定初始语言", () => {
    const html = renderWithStoredLocale("en", <I18nProvider><Probe keyName="topbar.compile" /></I18nProvider>);
    expect(html).toContain("Compile");
  });

  test("非法存储值回退默认 zh（不抛错）", () => {
    const html = renderWithStoredLocale("bogus", <I18nProvider><Probe keyName="topbar.compile" /></I18nProvider>);
    expect(html).toContain("编译");
  });
});

describe("纯组件双语渲染冒烟（结构断言，不锁快照）", () => {
  test("ui 原语：Button / Chip / Section / Spinner / Modal", () => {
    for (const locale of ["zh", "en"] as const) {
      const html = render(
        locale,
        <div>
          <Button variant="primary">Run</Button>
          <Chip tone="ok">done</Chip>
          <Section title="Scenes">body-text</Section>
          <Spinner label="loading data" />
          <Modal title="ModalTitle" onClose={() => undefined}>
            modal-body
          </Modal>
        </div>,
      );
      expect(html).toContain("Run");
      expect(html).toContain("done");
      expect(html).toContain("Scenes");
      expect(html).toContain("body-text");
      expect(html).toContain("loading data");
      expect(html).toContain('role="status"');
      expect(html).toContain("ModalTitle");
      expect(html).toContain('role="dialog"');
      expect(html.length).toBeGreaterThan(0);
    }
  });

  test("Markdown：标题/加粗/代码块渲染为安全 React 节点", () => {
    for (const locale of ["zh", "en"] as const) {
      const html = render(
        locale,
        <Markdown
          text={"# Title\n\n- item with **bold** text\n\n```ts\nconst x = 1;\n```"}
        />,
      );
      expect(html).toContain("Title");
      expect(html).toContain("bold");
      expect(html).toContain("md-pre");
      expect(html).toContain("md-lang");
      expect(html).toContain("ts");
    }
  });

  test("TaskCard：属性驱动渲染（工具名/技术串为稳定锚点）", () => {
    for (const locale of ["zh", "en"] as const) {
      const html = render(
        locale,
        <TaskCard
          status="ok"
          steps={3}
          usage={{ promptTokens: 800, completionTokens: 50 }}
          toolCalls={[
            { name: "compile.run", args: {}, status: "ok", durationMs: 1200, resultSummary: "ok" },
            { name: "render.preview", args: { frame: 30 }, status: "ok", durationMs: 950 },
          ]}
        />,
      );
      expect(html).toContain("task-card");
      expect(html).toContain("compile.run");
      expect(html).toContain("render.preview");
      expect(html).toContain("1.2s"); // fmtDuration parity anchor (technical string)
    }
  });
});
