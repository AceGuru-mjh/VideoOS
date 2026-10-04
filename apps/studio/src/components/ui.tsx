// VideoOS Studio — shared UI primitives + small format helpers.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  small?: boolean;
  ghost?: boolean;
}

export function Button({ variant = "default", small = false, ghost = false, className, type, ...rest }: ButtonProps): JSX.Element {
  const cls = [
    "btn",
    ghost ? "ghost" : variant,
    small ? "small" : "",
    className !== undefined && className.length > 0 ? className : "",
  ].filter((s) => s.length > 0).join(" ");
  return <button type={type ?? "button"} className={cls} {...rest} />;
}

export type ChipTone = "default" | "ok" | "err" | "warn" | "info" | "accent";

export function Chip({ tone = "default", title, children }: { tone?: ChipTone; title?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={`chip ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="section">
      <header className="section-header">
        <span>{title}</span>
        {actions !== undefined ? <span className="section-actions">{actions}</span> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <span className="spinner-wrap" role="status" aria-label={label ?? "loading"}>
      <span className="spinner" />
      {label !== undefined ? <span>{label}</span> : null}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className={`modal${wide === true ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <span>{title}</span>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }): JSX.Element | null {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="error-text" role="alert">
      {children}
    </div>
  );
}

/** seconds → "MM:SS.d" */
export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const tenth = Math.floor((rest - whole) * 10);
  return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${tenth}`;
}

/** bytes → human readable */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
