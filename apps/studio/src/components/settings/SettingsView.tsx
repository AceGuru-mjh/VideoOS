// SettingsView (S6, v0.2 §5 issue #57): the comprehensive settings center —
// full-screen overlay (route-independent: opens from the chat left footer
// 设置 chip and the IDE TopBar), left tree with the nine categories + right
// form pages (~720px), instant save (PATCH on change, optimistic UI, revert
// with an inline error line), 全部重置 with a confirm modal, Esc to close.
// Below 900px the tree collapses into a horizontal scrollable tab strip.
// i18n: chrome + inline General/Render/Interface pages consume settings.*;
// nav categories carry dictionary keys (agent-permissions meta 携键惯例),
// page errors render through useApiErrorMessage (store emits bare/“CODE: detail”
// error strings). Providers/Agent/MCP/Skills/Privacy/Advanced pages localize
// themselves (modelStep.* / permissions.* / mcp.* / skills.* / settings.*).
import { useEffect } from "react";
import { useStudio } from "../../store";
import { THEMES, isThemeId } from "../../themes";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { Button } from "../ui";
import { NumberField, SelectField, SettingsError, SettingsRow, SettingsSection, SwitchRow, TextField, useSectionPatch } from "./fields";
import { ResetButton } from "./ResetButton";
import { ProviderManager } from "./ProviderManager";
import { AgentPolicyEditor } from "./AgentPolicyEditor";
import { McpSettingsPage } from "./McpSettingsPage";
import { SkillsSettingsPage } from "./SkillsSettingsPage";
import { PrivacySettingsPage } from "./PrivacySettingsPage";
import { AdvancedSettingsPage } from "./AdvancedSettingsPage";

interface CategoryDef {
  id: string;
  /** nav label dictionary key (settings.nav.*) */
  labelKey: string;
  /** nav hint dictionary key (settings.nav.hint*) */
  hintKey: string;
}

export const SETTINGS_CATEGORIES: readonly CategoryDef[] = [
  { id: "general", labelKey: "settings.nav.general", hintKey: "settings.nav.hintGeneral" },
  { id: "providers", labelKey: "settings.nav.providers", hintKey: "settings.nav.hintProviders" },
  { id: "agent", labelKey: "settings.nav.agent", hintKey: "settings.nav.hintAgent" },
  { id: "render", labelKey: "settings.nav.render", hintKey: "settings.nav.hintRender" },
  { id: "mcp", labelKey: "settings.nav.mcp", hintKey: "settings.nav.hintMcp" },
  { id: "skills", labelKey: "settings.nav.skills", hintKey: "settings.nav.hintSkills" },
  { id: "interface", labelKey: "settings.nav.interface", hintKey: "settings.nav.hintInterface" },
  { id: "privacy", labelKey: "settings.nav.privacy", hintKey: "settings.nav.hintPrivacy" },
  { id: "advanced", labelKey: "settings.nav.advanced", hintKey: "settings.nav.hintAdvanced" },
];

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

function GeneralPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const setTheme = useStudio((s) => s.setTheme);
  const setWizardActive = useStudio((s) => s.setWizardActive);
  const closeSettings = useStudio((s) => s.closeSettings);
  const { error, patch } = useSectionPatch("general");
  // UI language is owned by the i18n provider (localStorage-first, two-way sync
  // with settings.general.language); the select binds to the live locale and
  // switching also PATCHes the server-side setting below.
  const { locale, t, setLocale } = useI18n();
  const errText = useApiErrorMessage();

  if (values === null) return <SettingsLoading />;
  const general = values.general;

  return (
    <>
      <SettingsSection title={t("settings.general.themeTitle")} hint={t("settings.general.themeHint")}>
        <div className="set-swatches" role="radiogroup" aria-label={t("settings.general.themeGroupAria")}>
          {THEMES.map((th) => {
            const active = general.theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`set-swatch${active ? " active" : ""}`}
                onClick={() => setTheme(th.id)}
                title={t("settings.general.swatchTitle", { name: th.label, mode: th.dark ? t("wizard.dark") : t("wizard.light") })}
              >
                <span className="set-swatch-preview" style={{ background: th.swatch.bg, borderColor: th.swatch.panel }}>
                  <span className="set-swatch-bar" style={{ background: th.swatch.accent }} />
                  <span className="set-swatch-lines">
                    <span style={{ background: th.swatch.text, opacity: 0.85 }} />
                    <span style={{ background: th.swatch.text, opacity: 0.45 }} />
                    <span style={{ background: th.swatch.text, opacity: 0.25 }} />
                  </span>
                </span>
                <span className="set-swatch-label">{th.label}</span>
              </button>
            );
          })}
        </div>
        <div className="set-row-hint">
          {t("settings.general.currentTheme", {
            name: isThemeId(general.theme) ? (THEMES.find((th) => th.id === general.theme)?.label ?? general.theme) : general.theme,
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.general.langSectionTitle")} hint={t("settings.general.langSectionHint")}>
        <SettingsRow label={t("settings.general.languageLabel")} htmlFor="set-language" hint={t("settings.general.languageHint")}>
          <SelectField
            id="set-language"
            value={locale}
            ariaLabel={t("settings.general.languageAria")}
            width={220}
            options={[
              { value: "zh", label: t("settings.general.langOptionZh") },
              { value: "en", label: t("settings.general.langOptionEn") },
            ]}
            onChange={(v) => {
              const next = v === "en" ? "en" : "zh";
              setLocale(next);
              void patch("language", next);
            }}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.general.startupLabel")} htmlFor="set-startup" hint={t("settings.general.startupHint")}>
          <SelectField
            id="set-startup"
            value={general.startup}
            ariaLabel={t("settings.general.startupAria")}
            width={220}
            options={[
              { value: "last-session", label: t("settings.general.startupLastSession") },
              { value: "new-chat", label: t("settings.general.startupNewChat") },
              { value: "wizard", label: t("settings.general.startupWizard") },
            ]}
            onChange={(v) => void patch("startup", v)}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.general.wizardRowLabel")} hint={t("settings.general.wizardRowHint")}>
          <Button onClick={() => { closeSettings(); setWizardActive(true); }}>{t("settings.general.rerunWizard")}</Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={errText(error)} />
    </>
  );
}

function ProvidersPage(): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <div className="set-page-intro">{t("settings.introProviders")}</div>
      <ProviderManager bodyClassName="set-provider-body" idPrefix="setprov" />
    </>
  );
}

function AgentPage(): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <div className="set-page-intro">{t("settings.introAgent")}</div>
      <AgentPolicyEditor />
    </>
  );
}

function RenderPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const { error, patch } = useSectionPatch("render");
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  if (values === null) return <SettingsLoading />;
  const render = values.render;
  if (render === undefined) return <SettingsLoading />;

  return (
    <>
      <SettingsSection title={t("settings.render.title")} hint={t("settings.render.hint")}>
        <SettingsRow label={t("settings.render.outDirLabel")} htmlFor="set-outdir" hint={t("settings.render.outDirHint")}>
          <TextField id="set-outdir" value={render.outDir} ariaLabel={t("settings.render.outDirAria")} placeholder="renders" width={280} onCommit={(v) => void patch("outDir", v)} />
        </SettingsRow>
        <SettingsRow label={t("settings.render.presetLabel")} htmlFor="set-preset">
          <SelectField
            id="set-preset"
            value={render.preset}
            ariaLabel={t("settings.render.presetAria")}
            width={280}
            options={[
              { value: "1080p30", label: t("settings.render.preset1080p30") },
              { value: "720p30", label: t("settings.render.preset720p30") },
              { value: "vertical-1080x1920", label: t("settings.render.presetVertical") },
            ]}
            onChange={(v) => void patch("preset", v)}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.render.concurrencyLabel")} htmlFor="set-concurrency" hint={t("settings.render.concurrencyHint")}>
          <NumberField id="set-concurrency" value={render.concurrency} min={1} max={4} ariaLabel={t("settings.render.concurrencyAria")} onCommit={(v) => void patch("concurrency", v)} />
        </SettingsRow>
        <SettingsRow label={t("settings.render.retriesLabel")} htmlFor="set-retries" hint={t("settings.render.retriesHint")}>
          <NumberField id="set-retries" value={render.retries} min={0} max={3} ariaLabel={t("settings.render.retriesAria")} onCommit={(v) => void patch("retries", v)} />
        </SettingsRow>
      </SettingsSection>
      <div className="set-note">{t("settings.render.note")}</div>
      <SettingsError error={errText(error)} />
    </>
  );
}

function InterfacePage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const setInterfacePref = useStudio((s) => s.setInterfacePref);
  const { t } = useI18n();
  if (values === null) return <SettingsLoading />;
  const iface = values.interface;

  return (
    <>
      <SettingsSection title={t("settings.interface.appearanceTitle")} hint={t("settings.interface.appearanceHint")}>
        <SettingsRow label={t("settings.interface.fontSizeLabel")} htmlFor="set-fontsize" hint={t("settings.interface.fontSizeHint")}>
          <SelectField
            id="set-fontsize"
            value={iface.fontSize}
            ariaLabel={t("settings.interface.fontSizeAria")}
            width={220}
            options={[
              { value: "sm", label: t("settings.interface.fontSizeSm") },
              { value: "md", label: t("settings.interface.fontSizeMd") },
              { value: "lg", label: t("settings.interface.fontSizeLg") },
            ]}
            onChange={(v) => setInterfacePref({ fontSize: v as typeof iface.fontSize })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.interface.densityLabel")} htmlFor="set-density" hint={t("settings.interface.densityHint")}>
          <SelectField
            id="set-density"
            value={iface.density}
            ariaLabel={t("settings.interface.densityAria")}
            width={220}
            options={[
              { value: "cozy", label: t("settings.interface.densityCozy") },
              { value: "compact", label: t("settings.interface.densityCompact") },
            ]}
            onChange={(v) => setInterfacePref({ density: v as typeof iface.density })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.interface.codeThemeLabel")} htmlFor="set-codetheme" hint={t("settings.interface.codeThemeHint")}>
          <SelectField
            id="set-codetheme"
            value={iface.codeTheme}
            ariaLabel={t("settings.interface.codeThemeAria")}
            width={220}
            options={[
              { value: "auto", label: t("settings.interface.codeThemeAuto") },
              { value: "dark", label: t("settings.interface.codeThemeDark") },
              { value: "light", label: t("settings.interface.codeThemeLight") },
            ]}
            onChange={(v) => setInterfacePref({ codeTheme: v as typeof iface.codeTheme })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.interface.motionLabel")} htmlFor="set-motion" hint={t("settings.interface.motionHint")}>
          <SwitchRow checked={iface.motion} onChange={(v) => setInterfacePref({ motion: v })} label={t("settings.interface.motionSwitchLabel")} />
        </SettingsRow>
      </SettingsSection>
      <div className="set-note">{t("settings.interface.note")}</div>
    </>
  );
}

function SettingsLoading(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="set-loading">{t("settings.loading")}</div>
  );
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

function renderPage(category: string): JSX.Element {
  switch (category) {
    case "providers":
      return <ProvidersPage />;
    case "agent":
      return <AgentPage />;
    case "render":
      return <RenderPage />;
    case "mcp":
      return <McpSettingsPage />;
    case "skills":
      return <SkillsSettingsPage />;
    case "interface":
      return <InterfacePage />;
    case "privacy":
      return <PrivacySettingsPage />;
    case "advanced":
      return <AdvancedSettingsPage />;
    default:
      return <GeneralPage />;
  }
}

export function SettingsView(): JSX.Element | null {
  const open = useStudio((s) => s.settingsOpen);
  const close = useStudio((s) => s.closeSettings);
  const category = useStudio((s) => s.settingsCategory);
  const setCategory = useStudio((s) => s.setSettingsCategory);
  const loadSettings = useStudio((s) => s.loadSettings);
  const { t } = useI18n();

  // Esc closes (overlay-level; nested modals + the model combobox handle their
  // own Escape first — when a modal is on screen the modal owns the keystroke)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".modal-overlay") !== null) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // fresh values whenever the center opens (another tab may have changed them)
  useEffect(() => {
    if (open) void loadSettings();
  }, [open, loadSettings]);

  if (!open) return null;

  const active = SETTINGS_CATEGORIES.find((c) => c.id === category) ?? SETTINGS_CATEGORIES[0]!;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={t("settings.overlayAria")}>
      <header className="settings-head">
        <span className="settings-title">{t("settings.title")}</span>
        <span className="settings-head-hint">{t(active.labelKey)}</span>
        <span className="spacer" />
        <ResetButton />
        <button type="button" className="settings-close" aria-label={t("settings.closeAria")} title={t("settings.closeTitle")} onClick={close}>
          ×
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-tree" aria-label={t("settings.navAria")}>
          {SETTINGS_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`settings-nav-item${c.id === active.id ? " active" : ""}`}
              aria-current={c.id === active.id ? "true" : undefined}
              onClick={() => setCategory(c.id)}
            >
              <span className="settings-nav-label">{t(c.labelKey)}</span>
              <span className="settings-nav-hint">{t(c.hintKey)}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {/* key per category: fresh page state (drafts / errors) on switch */}
          <div className="settings-page" key={active.id} role="region" aria-label={t("settings.pageAria", { label: t(active.labelKey) })}>
            {renderPage(active.id)}
          </div>
        </div>
      </div>
      <footer className="settings-foot">
        <span>{t("settings.footNote")}</span>
        <span className="settings-foot-dim">settings.json</span>
      </footer>
    </div>
  );
}
