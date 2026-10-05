// 对话输入（#51）：自适应高度 textarea（Enter 发送 / Shift+Enter 换行）、
// 运行中禁用 + 停止钮、字符计数、@技能自动补全（键盘 ↑↓/Enter/Esc + 点击）、
// SkillsPanel 的插入信号（store.skillInsert，按 seq 去重消费）。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Button } from "../components/ui";

/** 光标前的 "@token"（@ 必须位于词首；token 为小写 kebab 片段） */
const MENTION_RE = /(?:^|\s)@([a-z0-9-]*)$/;

export function ChatInput(): JSX.Element {
  const { t } = useI18n();
  const chatRunning = useStudio((s) => s.chatRunning);
  const activeSessionId = useStudio((s) => s.activeSessionId);
  const skills = useStudio((s) => s.skills);
  const sendMessage = useStudio((s) => s.sendMessage);
  const stopRun = useStudio((s) => s.stopRun);
  const skillInsert = useStudio((s) => s.skillInsert);

  const [text, setText] = useState("");
  const [mention, setMention] = useState<string | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const lastInsertSeq = useRef(0);

  const matches = useMemo(() => {
    if (mention === null) return [];
    const q = mention.toLowerCase();
    return skills.filter((s) => s.enabled && s.name.toLowerCase().startsWith(q));
  }, [mention, skills]);
  const acOpen = mention !== null && matches.length > 0;

  // 自适应高度（rows=1 起步，封顶 160px）
  useEffect(() => {
    const el = taRef.current;
    if (el === null) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // SkillsPanel → 插入 "@name "（seq 去重；追加到末尾并聚焦）
  useEffect(() => {
    if (skillInsert === null || skillInsert.seq === lastInsertSeq.current) return;
    lastInsertSeq.current = skillInsert.seq;
    const token = `@${skillInsert.name} `;
    setText((cur) => (cur.length === 0 ? token : cur.endsWith(" ") ? `${cur}${token}` : `${cur} ${token}`));
    setMention(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [skillInsert]);

  const updateMention = (value: string, caret: number): void => {
    const m = MENTION_RE.exec(value.slice(0, caret));
    setMention(m === null ? null : m[1]);
    setAcIndex(0);
  };

  const insertMention = (name: string): void => {
    const el = taRef.current;
    const value = text;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const m = MENTION_RE.exec(before);
    const head = m === null ? before : before.slice(0, before.length - m[0].length) + (m[0].startsWith(" ") ? " " : "");
    const next = `${head}@${name} ${after}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el2 = taRef.current;
      if (el2 === null) return;
      el2.focus();
      const pos = head.length + name.length + 1;
      el2.setSelectionRange(pos, pos);
    });
  };

  const submit = (): void => {
    const value = text.trim();
    if (value.length === 0 || chatRunning || activeSessionId === null) return;
    setText("");
    setMention(null);
    void sendMessage(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 中文输入法组合期：Enter/方向键交给 IME，不触发发送与补全导航
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (acOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertMention(matches[acIndex < matches.length ? acIndex : 0].name);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const disabled = chatRunning || activeSessionId === null;

  return (
    <div className="chat-input-wrap">
      <div className="chat-input">
        {acOpen ? (
          <div className="at-menu" role="listbox" aria-label={t("skills.title")}>
            {matches.map((s, i) => (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={i === acIndex}
                className={`at-item${i === acIndex ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // 保持 textarea 焦点
                  insertMention(s.name);
                }}
                onMouseEnter={() => setAcIndex(i)}
              >
                <span className="at-name">{s.name}</span>
                <span className="at-desc" title={s.description}>
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={chatRunning ? t("chat.placeholderRunning") : t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-input-bar">
          {chatRunning ? (
            <Button className="stop-btn" onClick={() => void stopRun()} title={t("chat.stop")}>
              ■ {t("chat.stop")}
            </Button>
          ) : (
            <Button variant="primary" disabled={text.trim().length === 0 || activeSessionId === null} onClick={submit} title={t("chat.send")}>
              ▶ {t("chat.send")}
            </Button>
          )}
          {text.length > 0 ? <span className="char-count">{text.length}</span> : null}
        </div>
      </div>
    </div>
  );
}
