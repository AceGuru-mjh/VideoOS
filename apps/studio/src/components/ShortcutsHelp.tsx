// ShortcutsHelp（可视化套件 · Task 2-d）：快捷键帮助 overlay。
// 数据：静态快捷键清单（与本仓库真实存在的绑定一一对应；未见绑定的一律不写）。
// 开启途径：命令面板 help.shortcuts / StatusBar 帮助按钮（App.tsx 接线）。
import { useEffect } from "react";
import { useI18n } from "../i18n";
import { useStudio } from "../store";
import { Modal } from "./ui";

/** 单条快捷键（keys 展示形式；when = 生效语境说明） */
interface ShortcutDef {
  keys: string[];
  label: string;
  when?: string;
  group: "global" | "editor" | "player" | "panels";
}

/**
 * 真实绑定清单（核对处）：
 * - Ctrl/⌘+K、Esc：CommandPalette.tsx window keydown
 * - Space/←/→(±Shift)/L/B/Home/End：PreviewPanel.tsx 播放器键盘控制（输入焦点不劫持）
 * - Enter（无 Shift）发送 / Shift+Enter 换行 / @ 提及 ↑↓ 选择：Composer.tsx onKeyDown
 * - Ctrl+S：EditorPanel Monaco 保存（addCommand CtrlCmd|KeyS）
 * - ↑/↓/Enter/Tab：CommandPalette 列表键盘语义
 */
const SHORTCUTS: ShortcutDef[] = [
  { keys: ["Ctrl", "K"], label: "palette.open", group: "global" },
  { keys: ["Esc"], label: "palette.close", when: "palette.closeWhen", group: "global" },
  { keys: ["Ctrl", "S"], label: "editor.save", group: "editor" },
  { keys: ["Enter"], label: "chat.send", when: "chat.sendWhen", group: "editor" },
  { keys: ["Shift", "Enter"], label: "chat.newline", group: "editor" },
  { keys: ["@"], label: "chat.mention", group: "editor" },
  { keys: ["Space"], label: "player.togglePlay", when: "player.whenFocus", group: "player" },
  { keys: ["←"], label: "player.prevFrame", when: "player.whenFocus", group: "player" },
  { keys: ["→"], label: "player.nextFrame", when: "player.whenFocus", group: "player" },
  { keys: ["Shift", "←"], label: "player.back10", when: "player.whenFocus", group: "player" },
  { keys: ["Shift", "→"], label: "player.fwd10", when: "player.whenFocus", group: "player" },
  { keys: ["L"], label: "player.toggleLoop", when: "player.whenFocus", group: "player" },
  { keys: ["B"], label: "player.toggleBounds", when: "player.whenFocus", group: "player" },
  { keys: ["Home"], label: "player.firstFrame", when: "player.whenFocus", group: "player" },
  { keys: ["End"], label: "player.lastFrame", when: "player.whenFocus", group: "player" },
  { keys: ["↑", "↓"], label: "palette.navigate", group: "panels" },
  { keys: ["Enter"], label: "palette.run", group: "panels" },
  { keys: ["Tab"], label: "palette.autocomplete", group: "panels" },
];

const GROUPS: ShortcutDef["group"][] = ["global", "editor", "player", "panels"];

export function ShortcutsHelp(): JSX.Element | null {
  const { t } = useI18n();
  const shortcutsOpen = useStudio((s) => s.shortcutsOpen);
  const setShortcutsOpen = useStudio((s) => s.setShortcutsOpen);

  // Esc 关闭（Modal 自带；此处补 window 级以防焦点在 iframe/Monaco 内）
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") setShortcutsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOpen, setShortcutsOpen]);

  if (!shortcutsOpen) return null;

  return (
    <Modal title={t("shortcuts.title")} onClose={() => setShortcutsOpen(false)} wide>
      <div className="shortcuts-grid">
        {GROUPS.map((group) => {
          const items = SHORTCUTS.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="shortcuts-group" aria-label={t(`shortcuts.group.${group}`)}>
              <h3 className="shortcuts-group-title">{t(`shortcuts.group.${group}`)}</h3>
              <ul className="shortcuts-list" role="list">
                {items.map((sc) => (
                  <li key={sc.label} className="shortcuts-row">
                    <span className="shortcuts-keys">
                      {sc.keys.map((k, i) => (
                        <kbd key={`${sc.label}-${k}-${i}`} className="shortcuts-kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="shortcuts-label">{t(sc.label)}</span>
                    {sc.when !== undefined ? <span className="shortcuts-when">{t(sc.when)}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="shortcuts-hint">{t("shortcuts.hint")}</p>
    </Modal>
  );
}
