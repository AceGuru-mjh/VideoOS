// Settings center shared primitives (S6, v0.2 §5 issue #57): section shells,
// form rows (label left / control right), controlled select / number / text
// fields with instant-save commit semantics, switch rows and the per-section
// optimistic PATCH hook (revert + inline error via store.patchSettingsSection).
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../../store";
import type { SettingsPatch, SettingsValues } from "../../settings";
import { Switch } from "../ui";

/** section shell: title + dim caption + body */
export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="set-sec" aria-label={title}>
      <header className="set-sec-head">
        <span className="set-sec-title">{title}</span>
        {hint !== undefined ? <span className="set-sec-hint">{hint}</span> : null}
      </header>
      <div className="set-sec-body">{children}</div>
    </section>
  );
}

/** one form row: label left (160px) + control right; optional dim hint below */
export function SettingsRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="set-row">
      <label className="set-row-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="set-row-control">
        {children}
        {hint !== undefined ? <div className="set-row-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  width,
  disabled,
}: {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  width?: number;
  disabled?: boolean;
}): JSX.Element {
  return (
    <select
      id={id}
      className="set-select"
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      style={width !== undefined ? { width: `${width}px` } : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Number input with draft-while-focused semantics: edits stay local until
 * blur/Enter, then clamp to [min,max] and commit — avoids PATCH storms while
 * typing and matches the instant-save UX of the settings center.
 */
export function NumberField({
  id,
  value,
  min,
  max,
  onCommit,
  ariaLabel,
  width = 96,
  unit,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  width?: number;
  unit?: string;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = (raw: string | null): void => {
    if (raw === null) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(null);
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setDraft(null);
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <span className="set-num">
      <input
        id={id}
        type="number"
        className="set-input mono"
        style={{ width: `${width}px` }}
        min={min}
        max={max}
        step={1}
        value={shown}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          if (e.key === "Escape") setDraft(null);
        }}
      />
      {unit !== undefined ? <span className="set-num-unit">{unit}</span> : null}
    </span>
  );
}

/**
 * Text input with draft-while-focused semantics (commit on blur/Enter) —
 * used for path-like fields (render.outDir, skills.customDir).
 */
export function TextField({
  id,
  value,
  onCommit,
  ariaLabel,
  placeholder,
  width,
}: {
  id?: string;
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  width?: number;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = (): void => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  return (
    <input
      id={id}
      type="text"
      className="set-input"
      style={width !== undefined ? { width: `${width}px` } : undefined}
      value={shown}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** switch + label + dim hint, one row — matches S4 patterns (44px target) */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="set-switch-row">
      <Switch checked={checked} onChange={onChange} label={label} />
      <span className="set-switch-text">{label}</span>
      {hint !== undefined ? <span className="set-row-hint inline">{hint}</span> : null}
    </div>
  );
}

/** inline error line under a section (revert already happened in the store) */
export function SettingsError({ error }: { error: string | null }): JSX.Element | null {
  if (error === null || error.length === 0) return null;
  return (
    <div className="set-error" role="alert">
      {error}
    </div>
  );
}

/**
 * Per-section optimistic PATCH hook: `patch(key, value)` updates the store
 * optimistically (DOM prefs included), PATCHes `{section: {key: value}}` and
 * reverts + returns an inline error message on failure.
 */
export function useSectionPatch(section: string): {
  error: string | null;
  setError: (message: string | null) => void;
  patch: (key: string, value: unknown) => Promise<void>;
} {
  const patchSection = useStudio((s) => s.patchSettingsSection);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: string, value: unknown): Promise<void> =>
    patchSection(
      { [section]: { [key]: value } } as SettingsPatch,
      (values: SettingsValues): SettingsValues => ({
        ...values,
        [section]: { ...(values[section] as Record<string, unknown>), [key]: value },
      }),
    ).then((err) => {
      setError(err);
    });
  return { error, setError, patch };
}

/** focus a fresh element when it appears (used by the JSON editor textarea) */
export function useAutoFocus<T extends HTMLElement>(active: boolean): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (active && ref.current !== null) ref.current.focus();
  }, [active]);
  return ref;
}
