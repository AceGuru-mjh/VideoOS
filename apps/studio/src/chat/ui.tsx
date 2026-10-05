// chat/ 共享小部件：开关、徽章、空状态、折叠卡、代码块 + 时间/错误格式化辅助。
// 刻意保持极小 —— 通用原语（Button/Chip/Section/Spinner）复用 components/ui.tsx。
import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n";

/** 无障碍开关（role="switch"）：28x16 胶囊 + 滑块过渡 */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export type BadgeTone = "dim" | "ok" | "warn" | "err";

/** 紧凑状态徽章（mono 小字；tone 决定描边/文字色） */
export function Badge({ tone = "dim", title, children }: { tone?: BadgeTone; title?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** 居中弱化的空状态占位 */
export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="chat-empty-state">{children}</div>;
}

/** 右栏折叠卡：section 骨架（沿用既有 .section/.section-header 观感）+ 头部折叠钮 */
export function Collapse({
  title,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="section rail-card">
      <header className="section-header rail-card-head">
        <button type="button" className="rail-collapse-btn" aria-expanded={open} onClick={onToggle}>
          <span className="chev" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span>{title}</span>
        </button>
        {actions !== undefined ? <span className="section-actions">{actions}</span> : null}
      </header>
      {open ? <div className="rail-body">{children}</div> : null}
    </section>
  );
}

/** 带标题栏（语言标签 + 复制钮）的代码块；MarkdownLite 与 ArtifactView 共用 */
export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // 剪贴板不可用（非安全上下文）——按钮状态不变
      });
  };

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{title ?? lang ?? "text"}</span>
        <button type="button" className="md-code-copy" onClick={copy}>
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** ISO → "HH:MM"（24h，本地时区；无效输入回退空串） */
export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ISO → 相对时间（刚刚 / Nm / Nh / Nd）；t 提供 chat.time.* 词条 */
export function relativeTime(iso: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return t("chat.time.justNow");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("chat.time.justNow");
  if (minutes < 60) return t("chat.time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("chat.time.hours", { n: hours });
  return t("chat.time.days", { n: Math.floor(hours / 24) });
}

/**
 * 错误文案本地化：提取 "CODE:" 前缀 → errors.CODE 词条（zh-common 段，13-e 维护）；
 * 无词条/无前缀时回退原始文本。
 */
export function localizeError(
  t: (key: string) => string,
  raw: string,
): string {
  const m = /^([A-Z0-9_]+):\s*(.*)$/.exec(raw.trim());
  if (m !== null) {
    const key = `errors.${m[1]}`;
    const localized = t(key);
    if (localized !== key) return localized;
    return m[2].length > 0 ? m[2] : raw;
  }
  return raw;
}

/** 毫秒 → "1.2s" / "980ms"（任务卡耗时） */
export function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
