// First-run wizard (v0.2 §2, issues #45/#48): shell + step 1 theme selection
// + step 2 model configuration (ModelStep). Clicking a theme card applies it
// globally and instantly (CSS custom properties cascade from [data-theme] on
// <html>); the mini previews render live in their own theme scope via a
// nested div[data-theme]. Step 2 owns its body + footer so its state (entries,
// form, busy guards) stays local to the model configuration screen.
import { useRef, useState, type KeyboardEvent } from "react";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { THEMES } from "../../themes";
import { Button } from "../ui";
import { ModelStep } from "./ModelStep";

type WizardStep = 1 | 2;

export function Wizard(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [step, setStep] = useState<WizardStep>(1);
  const themeId = useStudio((s) => s.settings.values?.general.theme ?? "midnight");
  const setTheme = useStudio((s) => s.setTheme);
  const setOnboarded = useStudio((s) => s.setOnboarded);
  const gridRef = useRef<HTMLDivElement | null>(null);

  /** exit: mark onboarded (persisted best-effort) and strip a forced ?wizard=1 */
  const finish = (): void => {
    if (new URLSearchParams(window.location.search).get("wizard") === "1") {
      const url = new URL(window.location.href);
      url.searchParams.delete("wizard");
      window.history.replaceState(null, "", url);
    }
    setOnboarded(true);
  };

  /** radio-group keyboard nav: arrows/Home/End move focus and select */
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const grid = gridRef.current;
    if (grid === null) return;
    const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>(".theme-card"));
    if (cards.length === 0) return;
    const current = cards.findIndex((c) => c === document.activeElement);
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter((s) => s.length > 0).length || 1;
    let next = current;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = cards.length - 1;
    else if (e.key === "ArrowRight") next = current < 0 ? 0 : (current + 1) % cards.length;
    else if (e.key === "ArrowLeft") next = current < 0 ? 0 : (current - 1 + cards.length) % cards.length;
    else if (e.key === "ArrowDown") next = current < 0 ? 0 : Math.min(current + cols, cards.length - 1);
    else if (e.key === "ArrowUp") next = current <= 0 ? 0 : Math.max(current - cols, 0);
    if (next !== current) {
      cards[next]?.focus();
      const def = THEMES[next];
      if (def !== undefined) setTheme(def.id);
    }
  };

  return (
    <main className="wizard" aria-label={t("wizard.aria")}>
      <div className="wizard-card">
        <header className="wizard-head">
          <div>
            <h2 className="wizard-title">
              <span className="glyph" aria-hidden="true">
                ▶
              </span>
              {t("wizard.title")}
            </h2>
            <p className="wizard-sub">{t("wizard.sub")}</p>
          </div>
          <div className="wizard-head-actions">
            {/* 首启即遇的语言选择 — 全面向导双语的第一入口 */}
            <div className="seg-toggle" role="group" aria-label={t("topbar.languageSwitcher")}>
              <button
                type="button"
                className={`seg-btn${locale === "zh" ? " active" : ""}`}
                aria-pressed={locale === "zh"}
                onClick={() => setLocale("zh")}
              >
                {t("topbar.langZh")}
              </button>
              <button
                type="button"
                className={`seg-btn${locale === "en" ? " active" : ""}`}
                aria-pressed={locale === "en"}
                onClick={() => setLocale("en")}
              >
                {t("topbar.langEn")}
              </button>
            </div>
            <button type="button" className="wizard-skip" onClick={finish}>
              {t("wizard.skip")}
            </button>
          </div>
        </header>

        <div className="wizard-steps">
          <div className={`wiz-step${step === 1 ? " active" : ""}${step === 2 ? " done" : ""}`}>
            <span className="n" aria-hidden="true">
              {step === 2 ? "✓" : "1"}
            </span>
            {t("wizard.stepTheme")}
          </div>
          <div className={`wiz-step${step === 2 ? " active" : ""}`}>
            <span className="n" aria-hidden="true">
              2
            </span>
            {t("wizard.stepModel")}
          </div>
        </div>

        {step === 1 ? (
          <>
            <div className="wizard-body">
              <p className="wiz-hint">{t("wizard.themeHint")}</p>
              <div className="theme-grid" ref={gridRef} role="radiogroup" aria-label={t("wizard.themeGroupAria")} onKeyDown={onGridKeyDown}>
                {THEMES.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    role="radio"
                    aria-checked={themeId === th.id}
                    tabIndex={themeId === th.id ? 0 : -1}
                    className={`theme-card${themeId === th.id ? " selected" : ""}`}
                    onClick={() => setTheme(th.id)}
                  >
                    <div className="theme-preview" data-theme={th.id} aria-hidden="true">
                      <div className="tp-topbar">
                        <span className="tp-dot" />
                        <span className="tp-dot" />
                        <span className="tp-dot" />
                      </div>
                      <div className="tp-title">VideoOS</div>
                      <div className="tp-row">
                        <span className="tp-btn">{t("wizard.previewRender")}</span>
                        <span className="tp-chip">scene</span>
                      </div>
                      <div className="tp-row">
                        <code className="tp-code">frame(30)</code>
                        <span className="tp-chip ok">1080p</span>
                      </div>
                    </div>
                    <div className="theme-card-meta">
                      <span className="theme-name">{th.label}</span>
                      <span className="theme-badge">{th.dark ? t("wizard.dark") : t("wizard.light")}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <footer className="wizard-foot">
              <Button
                ghost
                onClick={() => {
                  setTheme("midnight");
                  setStep(2);
                }}
              >
                {t("wizard.later")}
              </Button>
              <span className="spacer" />
              <Button variant="primary" onClick={() => setStep(2)}>
                {t("wizard.next")}
              </Button>
            </footer>
          </>
        ) : (
          <ModelStep onBack={() => setStep(1)} onFinish={finish} />
        )}
      </div>
    </main>
  );
}
