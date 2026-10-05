// Composer (v0.2 §3 + S4): pinned to the bottom of the center column.
// Auto-growing textarea (1–6 rows), Enter sends / Shift+Enter newline
// (IME composition safe), disabled while a run is active for this session,
// subtle char count past 500, 停止 button while running (red ghost), and 409
// error hint cards. S4 adds the @ 技能引用 autocomplete: typing "@" opens a
// lightweight popup of enabled skills filtered by prefix; Enter/click inserts
// `@skill-name `; Escape closes; IME-safe (no popup logic mid-composition).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { Button, Spinner } from "../ui";

const MAX_HEIGHT = 150;
const MENTION_MAX = 6;

/** text before the caret → the in-progress @mention, or null */
function detectMention(before: string): { query: string; start: number } | null {
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // must be word-start: beginning of the text or after whitespace
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  // skill names are ascii slugs — any space / CJK / @ ends the mention
  if (!/^[\w-]*$/.test(query)) return null;
  return { query, start: at };
}

export function Composer(): JSX.Element {
  const { t } = useI18n();
  const draft = useStudio((s) => s.composerDraft);
  const setDraft = useStudio((s) => s.setComposerDraft);
  const sendMessage = useStudio((s) => s.sendMessage);
  const stopRun = useStudio((s) => s.stopRun);
  const chatError = useStudio((s) => s.chatError);
  const activeRun = useStudio((s) => s.activeRun);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const sending = useStudio((s) => s.sending);
  const focusToken = useStudio((s) => s.composerFocusToken);
  const setWizardActive = useStudio((s) => s.setWizardActive);
  const setUiMode = useStudio((s) => s.setUiMode);
  const skillsSnapshot = useStudio((s) => s.skills.snapshot);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** caret position to restore after the next draft change (mention insert) */
  const pendingCaretRef = useRef<number | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const runHere =
    activeRun !== null && activeRun.sessionId === currentSessionId && activeRun.status === "running";
  const runElsewhere =
    activeRun !== null && activeRun.sessionId !== currentSessionId && activeRun.status === "running";
  const busy = runHere || runElsewhere || sending;
  const canSend = draft.trim().length > 0 && !busy;

  const mentionMatches = useMemo(() => {
    if (mention === null || skillsSnapshot === null) return [];
    const q = mention.query.toLowerCase();
    return skillsSnapshot.skills
      .filter((s) => s.enabled && s.name.toLowerCase().startsWith(q))
      .slice(0, MENTION_MAX);
  }, [mention, skillsSnapshot]);

  // auto-grow 1→6 rows
  useEffect(() => {
    const el = taRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  // restore caret after programmatic mention insertion
  useEffect(() => {
    const pos = pendingCaretRef.current;
    const el = taRef.current;
    if (pos !== null && el !== null) {
      el.setSelectionRange(pos, pos);
      pendingCaretRef.current = null;
    }
  }, [draft]);

  // suggestion chips / external focus requests (@ 引用 button lands here too —
  // caret to the end so typing continues right after the inserted mention)
  useEffect(() => {
    if (focusToken > 0) {
      const el = taRef.current;
      if (el !== null) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
  }, [focusToken]);

  const insertMention = (name: string): void => {
    const el = taRef.current;
    if (mention === null || el === null) return;
    const caret = el.selectionStart ?? draft.length;
    const text = draft;
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`;
    pendingCaretRef.current = mention.start + name.length + 2;
    setDraft(next);
    setMention(null);
    setMentionIdx(0);
  };

  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    void sendMessage(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // IME safety: never act from inside a composition (incl. Safari's
    // post-compositionend Enter, which carries keyCode 229)
    if (composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (mention !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const hit = mentionMatches[mentionIdx];
        if (hit !== undefined) insertMention(hit.name);
        return;
      }
    } else if (e.key === "Escape" && mention !== null) {
      setMention(null);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    submit();
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft(e.target.value);
    if (composingRef.current) {
      setMention(null);
      return;
    }
    const caret = e.target.selectionStart ?? e.target.value.length;
    const next = detectMention(e.target.value.slice(0, caret));
    setMention(next);
    setMentionIdx(0);
  };

  const hint = chatError ?? (runElsewhere ? { code: "CHAT_RUN_ACTIVE", message: t("chat.busyElsewhere") } : null);

  return (
    <div className="chat-composer">
      <div className="composer-inner">
        {hint !== null ? (
          <div className={`chat-err${hint.code === "CHAT_RUN_ACTIVE" ? " warn" : ""}`} role="alert">
            {hint.code === "PROVIDER_NONE" ? (
              <>
                <span>{t("chat.errProviderNone")}</span>
                <Button small onClick={() => setWizardActive(true)}>
                  {t("chat.errProviderNoneAction")}
                </Button>
              </>
            ) : hint.code === "SESSION_NO_PROJECT" ? (
              <>
                <span>{t("chat.errNoProject")}</span>
                <Button small onClick={() => setUiMode("ide")}>
                  {t("chat.errNoProjectAction")}
                </Button>
              </>
            ) : hint.code === "CHAT_RUN_ACTIVE" ? (
              <span>{t("chat.errRunActive")}</span>
            ) : (
              <span className="chat-err-mono">{hint.message}</span>
            )}
          </div>
        ) : null}
        <div className="composer-box">
          {mention !== null && mentionMatches.length > 0 ? (
            <div className="mention-pop" role="listbox" aria-label={t("chat.atMenuLabel")}>
              <div className="mention-pop-head">{t("chat.atMenuHead")}</div>
              {mentionMatches.map((s, i) => (
                <button
                  type="button"
                  key={s.name}
                  role="option"
                  aria-selected={i === mentionIdx}
                  className={`mention-item${i === mentionIdx ? " active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep the textarea caret
                    insertMention(s.name);
                  }}
                  onMouseEnter={() => setMentionIdx(i)}
                >
                  <span className="mention-name">{s.name}</span>
                  <span className="mention-desc" title={s.description}>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={taRef}
            value={draft}
            rows={1}
            disabled={runHere}
            placeholder={runHere ? t("chat.placeholderRunning") : t("chat.placeholder")}
            aria-label={t("chat.inputLabel")}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
          />
          {runHere ? (
            <button type="button" className="composer-stop" onClick={() => void stopRun()} title={t("chat.stopTitle")}>
              <Spinner /> {t("chat.stop")}
            </button>
          ) : (
            <button type="button" className="composer-send" onClick={submit} disabled={!canSend} title={canSend ? t("chat.sendTitle") : t("chat.sendDisabled")}>
              {sending ? <Spinner /> : t("chat.send")}
            </button>
          )}
        </div>
        <div className="composer-foot">
          <span>{t("chat.footHint")}</span>
          {draft.length > 500 ? <span className="composer-count">{t("chat.chars", { n: draft.length })}</span> : null}
        </div>
      </div>
    </div>
  );
}
