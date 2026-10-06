// CommandPalette（可视化套件 · Task 2-d）：Ctrl/⌘+K 全局命令面板。
// - 命令源：store actions 的编译/渲染/测试/模式切换 + 16 主题即选 + 语言切换 + dock 跳转 + 设置中心直达；
// - 搜索：大小写不敏感的模糊子序列匹配（连续命中加权），中英文关键词均可命中（拼音首字母不做）；
// - 键盘：↑↓ 选择、Enter 执行、Esc 关闭、Tab 补全高亮项关键字（复制到输入框）；
// - 可访问性：role="dialog" + combobox/listbox 语义 + aria-activedescendant 跟随；
// - 空查询：分组展示全部命令（每组内取前 N，避免超长列表）。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import { useStudio, type DockTab } from "../store";
import { THEMES } from "../themes";

/** 单条命令（id 唯一；keywords 参与模糊匹配；run 执行后面板关闭） */
interface Command {
  id: string;
  group: "project" | "view" | "theme" | "language" | "help";
  label: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

/** 模糊打分：子序列命中返回分数（越高越前），不命中返回 -1
 *  规则：连续命中 +8/字符；首字符命中 +6；跳位命中 +2；查询越长权重越高 */
function fuzzyScore(query: string, target: string): number {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak += 1;
      score += 2 + streak * 2 + (ti === 0 ? 6 : 0);
      qi += 1;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1; // 未全命中
  return score + q.length;
}

/** 空查询时每组展示的命令数上限 */
const GROUP_PREVIEW_LIMIT = 6;
/** 结果列表高度上限（行）——超出滚动 */
const RESULT_MAX_ROWS = 12;

const GROUP_ORDER: Command["group"][] = ["project", "view", "theme", "language", "help"];

export function CommandPalette(): JSX.Element | null {
  const { t, locale, setLocale } = useI18n();
  const paletteOpen = useStudio((s) => s.paletteOpen);
  const setPaletteOpen = useStudio((s) => s.setPaletteOpen);
  const setShortcutsOpen = useStudio((s) => s.setShortcutsOpen);
  const project = useStudio((s) => s.project);
  const compile = useStudio((s) => s.compile);
  const setTheme = useStudio((s) => s.setTheme);
  const runCompile = useStudio((s) => s.runCompile);
  const openRenderDialog = useStudio((s) => s.openRenderDialog);
  const runTests = useStudio((s) => s.runTests);
  const setUiMode = useStudio((s) => s.setUiMode);
  const setDockTab = useStudio((s) => s.setDockTab);
  const openSettings = useStudio((s) => s.openSettings);
  const refreshAnalytics = useStudio((s) => s.refreshAnalytics);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ---- 全局快捷键：Ctrl/⌘+K 开关；Esc 关闭（输入框外也响应） ----
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if ((e.ctrlKey === true || e.metaKey === true) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!useStudio.getState().paletteOpen);
      } else if (e.key === "Escape" && useStudio.getState().paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  // 打开时聚焦 + 重置
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  const close = (): void => setPaletteOpen(false);

  // ---- 命令清单（i18n 变化时重建） ----
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    // 项目动作
    list.push({
      id: "project.compile",
      group: "project",
      label: t("palette.compile"),
      hint: "Ctrl+Enter",
      keywords: "compile build 编译 构建",
      run: () => void runCompile(),
    });
    list.push({
      id: "project.render",
      group: "project",
      label: t("palette.render"),
      keywords: "render export mp4 渲染 导出 输出",
      run: () => openRenderDialog(true),
    });
    list.push({
      id: "project.tests",
      group: "project",
      label: t("palette.tests"),
      keywords: "test qa golden 测试 质检",
      run: () => void runTests(),
    });
    list.push({
      id: "project.analytics",
      group: "project",
      label: t("palette.analytics"),
      keywords: "analytics stats dashboard 分析 统计 仪表盘",
      run: () => {
        setDockTab("analytics");
        void refreshAnalytics();
      },
    });
    // 视图
    const dockTabs: DockTab[] = ["diagnostics", "tests", "agent", "events", "analytics"];
    for (const tab of dockTabs) {
      list.push({
        id: `view.tab.${tab}`,
        group: "view",
        label: t("palette.gotoTab", { tab: t(`dock.${tab}`) }),
        keywords: `panel tab ${tab} 面板 标签页`,
        run: () => setDockTab(tab),
      });
    }
    list.push({
      id: "view.mode.chat",
      group: "view",
      label: t("palette.modeChat"),
      keywords: "chat mode 对话 模式",
      run: () => setUiMode("chat"),
    });
    list.push({
      id: "view.mode.ide",
      group: "view",
      label: t("palette.modeIde"),
      keywords: "ide mode workspace 编辑器 工作区 模式",
      run: () => setUiMode("ide"),
    });
    list.push({
      id: "view.settings",
      group: "view",
      label: t("palette.settings"),
      keywords: "settings preferences 设置 偏好",
      run: () => openSettings(),
    });
    list.push({
      id: "view.skills",
      group: "view",
      label: t("palette.skills"),
      keywords: "skills 技能",
      run: () => useStudio.setState({ skillsOpen: true }),
    });
    // 主题（16 个）
    for (const theme of THEMES) {
      list.push({
        id: `theme.${theme.id}`,
        group: "theme",
        label: t("palette.theme", { name: theme.label }),
        hint: theme.dark ? t("wizard.dark") : t("wizard.light"),
        keywords: `theme color ${theme.id} 主题 换色`,
        run: () => setTheme(theme.id),
      });
    }
    // 语言
    if (locale !== "zh") {
      list.push({
        id: "lang.zh",
        group: "language",
        label: t("palette.langZh"),
        keywords: "language chinese 中文 语言",
        run: () => setLocale("zh"),
      });
    }
    if (locale !== "en") {
      list.push({
        id: "lang.en",
        group: "language",
        label: t("palette.langEn"),
        keywords: "language english english 语言",
        run: () => setLocale("en"),
      });
    }
    // 帮助
    list.push({
      id: "help.shortcuts",
      group: "help",
      label: t("palette.shortcuts"),
      keywords: "keyboard shortcuts help 快捷键 帮助",
      run: () => setShortcutsOpen(true),
    });
    return list;
  }, [t, locale, setLocale, runCompile, openRenderDialog, runTests, setDockTab, setUiMode, openSettings, setTheme, setShortcutsOpen, refreshAnalytics]);

  // ---- 过滤 + 排序 ----
  const filtered = useMemo<Command[]>(() => {
    if (query.trim().length === 0) {
      // 空查询：按组序 + 每组前 N（主题组是主要长尾，全部保留但截到预览数）
      const out: Command[] = [];
      for (const g of GROUP_ORDER) {
        const groupCommands = commands.filter((c) => c.group === g);
        out.push(...(g === "theme" ? groupCommands.slice(0, GROUP_PREVIEW_LIMIT) : groupCommands));
      }
      return out;
    }
    const scored = commands
      .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.keywords)) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    return scored.slice(0, RESULT_MAX_ROWS * 2);
  }, [commands, query]);

  const visible = filtered.length > RESULT_MAX_ROWS ? filtered.slice(0, RESULT_MAX_ROWS * 2) : filtered;

  // active 越界回弹
  useEffect(() => {
    if (active >= visible.length) setActive(Math.max(0, visible.length - 1));
  }, [visible.length, active]);

  // active 滚动跟随
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!paletteOpen) return null;

  const execute = (cmd: Command): void => {
    close();
    // 关闭动画后再执行——避免 run 内的 state 更新与面板卸载竞争
    window.setTimeout(() => cmd.run(), 0);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((n) => (visible.length === 0 ? 0 : (n + 1) % visible.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((n) => (visible.length === 0 ? 0 : (n - 1 + visible.length) % visible.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = visible[active];
      if (cmd !== undefined) execute(cmd);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const cmd = visible[active];
      if (cmd !== undefined && query.trim().length === 0) setQuery(cmd.label);
    }
  };

  const compileReady = project !== null;

  return (
    <div className="palette-overlay" role="presentation" onClick={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <span className="palette-glyph" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            className="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={visible[active] !== undefined ? `palette-item-${active}` : undefined}
            aria-label={t("palette.searchLabel")}
            placeholder={t("palette.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <span className="palette-kbd">Esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label={t("palette.resultsLabel")}>
          {visible.length === 0 ? (
            <div className="palette-empty">{t("palette.noResults")}</div>
          ) : (
            visible.map((cmd, i) => (
              <button
                key={cmd.id}
                id={`palette-item-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                data-index={i}
                className={`palette-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => execute(cmd)}
              >
                <span className={`palette-group-dot palette-group-${cmd.group}`} aria-hidden="true" />
                <span className="palette-item-label">
                  {cmd.label}
                  {cmd.id === "project.compile" && !compileReady ? (
                    <span className="palette-item-dim"> · {t("palette.needProject")}</span>
                  ) : null}
                  {cmd.id === "project.render" && compile?.ok !== true ? (
                    <span className="palette-item-dim"> · {t("topbar.renderNeedCompile")}</span>
                  ) : null}
                </span>
                {cmd.hint !== undefined ? <span className="palette-item-hint">{cmd.hint}</span> : null}
              </button>
            ))
          )}
        </div>
        <div className="palette-footer">
          <span className="palette-footer-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("palette.navigate")}
            <kbd className="palette-footer-gap">Enter</kbd> {t("palette.run")}
          </span>
          <span className="palette-footer-count">
            {t("palette.count", { n: visible.length, total: commands.length })}
          </span>
        </div>
      </div>
    </div>
  );
}
