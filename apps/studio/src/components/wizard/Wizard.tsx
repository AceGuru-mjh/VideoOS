// First-run wizard (v0.2 §2, issue #45): shell + step 1 theme selection.
// Step 2 (model configuration) is a placeholder — S2 fills it in.
// Clicking a theme card applies it globally and instantly (CSS custom
// properties cascade from [data-theme] on <html>); the mini previews render
// live in their own theme scope via a nested div[data-theme].
import { useRef, useState, type KeyboardEvent } from "react";
import { useStudio } from "../../store";
import { THEMES } from "../../themes";
import { Button } from "../ui";

type WizardStep = 1 | 2;

export function Wizard(): JSX.Element {
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
    <main className="wizard" aria-label="首次启动向导">
      <div className="wizard-card">
        <header className="wizard-head">
          <div>
            <h2 className="wizard-title">
              <span className="glyph" aria-hidden="true">
                ▶
              </span>
              欢迎使用 VideoOS
            </h2>
            <p className="wizard-sub">只需两步，开始你的第一个视频项目。</p>
          </div>
          <button type="button" className="wizard-skip" onClick={finish}>
            跳过
          </button>
        </header>

        <div className="wizard-steps">
          <div className={`wiz-step${step === 1 ? " active" : ""}${step === 2 ? " done" : ""}`}>
            <span className="n" aria-hidden="true">
              {step === 2 ? "✓" : "1"}
            </span>
            主题
          </div>
          <div className={`wiz-step${step === 2 ? " active" : ""}`}>
            <span className="n" aria-hidden="true">
              2
            </span>
            模型
          </div>
        </div>

        <div className="wizard-body">
          {step === 1 ? (
            <>
              <p className="wiz-hint">选择一个主题 — 点击任意卡片立即应用到整个界面，随时可以在设置中修改。</p>
              <div className="theme-grid" ref={gridRef} role="radiogroup" aria-label="选择主题" onKeyDown={onGridKeyDown}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={themeId === t.id}
                    tabIndex={themeId === t.id ? 0 : -1}
                    className={`theme-card${themeId === t.id ? " selected" : ""}`}
                    onClick={() => setTheme(t.id)}
                  >
                    <div className="theme-preview" data-theme={t.id} aria-hidden="true">
                      <div className="tp-topbar">
                        <span className="tp-dot" />
                        <span className="tp-dot" />
                        <span className="tp-dot" />
                      </div>
                      <div className="tp-title">VideoOS</div>
                      <div className="tp-row">
                        <span className="tp-btn">渲染</span>
                        <span className="tp-chip">scene</span>
                      </div>
                      <div className="tp-row">
                        <code className="tp-code">frame(30)</code>
                        <span className="tp-chip ok">1080p</span>
                      </div>
                    </div>
                    <div className="theme-card-meta">
                      <span className="theme-name">{t.label}</span>
                      <span className="theme-badge">{t.dark ? "深色" : "浅色"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="wiz-placeholder">
              <h3>模型配置即将到来</h3>
              <p>这里将支持配置模型供应商、API Key 与默认模型，并可一键测试连接。当前版本可先以演示模式进入主界面，稍后在设置中心完成配置。</p>
              <div className="wiz-coming">
                <span className="chip">供应商</span>
                <span className="chip">API Key</span>
                <span className="chip">默认模型</span>
                <span className="chip">测试连接</span>
              </div>
            </div>
          )}
        </div>

        <footer className="wizard-foot">
          {step === 1 ? (
            <>
              <Button
                ghost
                onClick={() => {
                  setTheme("midnight");
                  setStep(2);
                }}
              >
                稍后再选
              </Button>
              <span className="spacer" />
              <Button variant="primary" onClick={() => setStep(2)}>
                下一步
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setStep(1)}>上一步</Button>
              <span className="spacer" />
              <Button variant="primary" onClick={finish}>
                使用演示模式继续
              </Button>
            </>
          )}
        </footer>
      </div>
    </main>
  );
}
