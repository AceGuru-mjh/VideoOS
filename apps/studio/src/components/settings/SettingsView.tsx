// SettingsView (S6, v0.2 §5 issue #57): the comprehensive settings center —
// full-screen overlay (route-independent: opens from the chat left footer
// 设置 chip and the IDE TopBar), left tree with the nine categories + right
// form pages (~720px), instant save (PATCH on change, optimistic UI, revert
// with an inline error line), 全部重置 with a confirm modal, Esc to close.
// Below 900px the tree collapses into a horizontal scrollable tab strip.
import { useEffect } from "react";
import { useStudio } from "../../store";
import { THEMES, isThemeId } from "../../themes";
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
  label: string;
  hint: string;
}

export const SETTINGS_CATEGORIES: readonly CategoryDef[] = [
  { id: "general", label: "通用", hint: "主题 · 语言 · 启动行为" },
  { id: "providers", label: "模型与供应商", hint: "供应商 · 默认模型" },
  { id: "agent", label: "Agent 与自主性", hint: "自主级别 · 权限矩阵" },
  { id: "render", label: "渲染", hint: "输出目录 · 预设 · 并发" },
  { id: "mcp", label: "MCP", hint: "服务器 · 工具合并" },
  { id: "skills", label: "Skills", hint: "技能启停 · 自动触发" },
  { id: "interface", label: "界面", hint: "字号 · 密度 · 代码主题" },
  { id: "privacy", label: "隐私与数据", hint: "遥测 · 日志 · 清除" },
  { id: "advanced", label: "高级", hint: "JSON 配置 · 日志 · 缓存" },
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

  if (values === null) return <SettingsLoading />;
  const general = values.general;

  return (
    <>
      <SettingsSection title="主题" hint="点击立即应用到整个界面">
        <div className="set-swatches" role="radiogroup" aria-label="界面主题">
          {THEMES.map((t) => {
            const active = general.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`set-swatch${active ? " active" : ""}`}
                onClick={() => setTheme(t.id)}
                title={`${t.label}（${t.dark ? "深色" : "浅色"}）`}
              >
                <span className="set-swatch-preview" style={{ background: t.swatch.bg, borderColor: t.swatch.panel }}>
                  <span className="set-swatch-bar" style={{ background: t.swatch.accent }} />
                  <span className="set-swatch-lines">
                    <span style={{ background: t.swatch.text, opacity: 0.85 }} />
                    <span style={{ background: t.swatch.text, opacity: 0.45 }} />
                    <span style={{ background: t.swatch.text, opacity: 0.25 }} />
                  </span>
                </span>
                <span className="set-swatch-label">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="set-row-hint">当前 · {isThemeId(general.theme) ? (THEMES.find((t) => t.id === general.theme)?.label ?? general.theme) : general.theme}</div>
      </SettingsSection>

      <SettingsSection title="语言与启动" hint="语言与启动行为的持久化偏好">
        <SettingsRow label="界面语言" htmlFor="set-language" hint="界面语言（即将支持切换）— 当前界面保持中文">
          <SelectField
            id="set-language"
            value={general.language}
            ariaLabel="界面语言"
            width={220}
            options={[
              { value: "zh", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
            onChange={(v) => void patch("language", v === "en" ? "en" : "zh")}
          />
        </SettingsRow>
        <SettingsRow label="启动行为" htmlFor="set-startup" hint="下次启动 VideoOS Studio 时打开">
          <SelectField
            id="set-startup"
            value={general.startup}
            ariaLabel="启动行为"
            width={220}
            options={[
              { value: "last-session", label: "恢复上次会话" },
              { value: "new-chat", label: "新建对话" },
              { value: "wizard", label: "重新运行向导" },
            ]}
            onChange={(v) => void patch("startup", v)}
          />
        </SettingsRow>
        <SettingsRow label="首次向导" hint="重新配置主题与模型供应商">
          <Button onClick={() => { closeSettings(); setWizardActive(true); }}>重跑设置向导</Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={error} />
    </>
  );
}

function ProvidersPage(): JSX.Element {
  return (
    <>
      <div className="set-page-intro">
        添加和管理模型供应商（BYO Key，密钥保存在服务端安全存储、永不写入 settings.json），选择对话与规划使用的默认模型。
      </div>
      <ProviderManager bodyClassName="set-provider-body" idPrefix="setprov" />
    </>
  );
}

function AgentPage(): JSX.Element {
  return (
    <>
      <div className="set-page-intro">Agent 自主性与权限：自主级别预设、单次任务步数上限、逐工具覆盖矩阵与危险命令黑名单。变更自下一次运行起生效。</div>
      <AgentPolicyEditor />
    </>
  );
}

function RenderPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const { error, patch } = useSectionPatch("render");
  if (values === null) return <SettingsLoading />;
  const render = values.render;
  if (render === undefined) return <SettingsLoading />;

  return (
    <>
      <SettingsSection title="渲染默认参数" hint="新任务的默认渲染配置">
        <SettingsRow label="输出目录" htmlFor="set-outdir" hint="项目内相对路径，成片与中间产物写入此处">
          <TextField id="set-outdir" value={render.outDir} ariaLabel="渲染输出目录" placeholder="renders" width={280} onCommit={(v) => void patch("outDir", v)} />
        </SettingsRow>
        <SettingsRow label="分辨率预设" htmlFor="set-preset">
          <SelectField
            id="set-preset"
            value={render.preset}
            ariaLabel="渲染分辨率预设"
            width={280}
            options={[
              { value: "1080p30", label: "1080p30 · 横屏 1920×1080" },
              { value: "720p30", label: "720p30 · 横屏 1280×720" },
              { value: "vertical-1080x1920", label: "竖屏 1080×1920 · 短视频" },
            ]}
            onChange={(v) => void patch("preset", v)}
          />
        </SettingsRow>
        <SettingsRow label="并发数" htmlFor="set-concurrency" hint="同时进行的渲染工作数（1-4）">
          <NumberField id="set-concurrency" value={render.concurrency} min={1} max={4} ariaLabel="渲染并发数" onCommit={(v) => void patch("concurrency", v)} />
        </SettingsRow>
        <SettingsRow label="失败重试" htmlFor="set-retries" hint="单帧渲染失败后的重试次数（0-3）">
          <NumberField id="set-retries" value={render.retries} min={0} max={3} ariaLabel="失败重试次数" onCommit={(v) => void patch("retries", v)} />
        </SettingsRow>
      </SettingsSection>
      <div className="set-note">渲染参数同时受项目 manifest 影响 — 项目内声明的 width/height/fps 优先于这里的预设。</div>
      <SettingsError error={error} />
    </>
  );
}

function InterfacePage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const setInterfacePref = useStudio((s) => s.setInterfacePref);
  if (values === null) return <SettingsLoading />;
  const iface = values.interface;

  return (
    <>
      <SettingsSection title="界面外观" hint="四项全部即点即生效（并持久化）">
        <SettingsRow label="字号" htmlFor="set-fontsize" hint="阅读区域（对话 / 设置 / 向导）的基准字号">
          <SelectField
            id="set-fontsize"
            value={iface.fontSize}
            ariaLabel="界面字号"
            width={220}
            options={[
              { value: "sm", label: "小" },
              { value: "md", label: "中（默认）" },
              { value: "lg", label: "大" },
            ]}
            onChange={(v) => setInterfacePref({ fontSize: v as typeof iface.fontSize })}
          />
        </SettingsRow>
        <SettingsRow label="信息密度" htmlFor="set-density" hint="紧凑模式收紧主要界面的间距">
          <SelectField
            id="set-density"
            value={iface.density}
            ariaLabel="界面信息密度"
            width={220}
            options={[
              { value: "cozy", label: "舒适（默认）" },
              { value: "compact", label: "紧凑" },
            ]}
            onChange={(v) => setInterfacePref({ density: v as typeof iface.density })}
          />
        </SettingsRow>
        <SettingsRow label="代码主题" htmlFor="set-codetheme" hint="Monaco 编辑器配色（跟随界面主题 / 强制深浅）">
          <SelectField
            id="set-codetheme"
            value={iface.codeTheme}
            ariaLabel="代码编辑器主题"
            width={220}
            options={[
              { value: "auto", label: "跟随界面主题" },
              { value: "dark", label: "深色" },
              { value: "light", label: "浅色" },
            ]}
            onChange={(v) => setInterfacePref({ codeTheme: v as typeof iface.codeTheme })}
          />
        </SettingsRow>
        <SettingsRow label="动效" htmlFor="set-motion" hint="关闭后停用所有过渡与动画（无障碍 / 低性能设备友好）">
          <SwitchRow checked={iface.motion} onChange={(v) => setInterfacePref({ motion: v })} label="界面动效" />
        </SettingsRow>
      </SettingsSection>
      <div className="set-note">字号与密度即时作用于对话流与设置中心；代码主题立即应用到 Monaco 编辑器。</div>
    </>
  );
}

function SettingsLoading(): JSX.Element {
  return (
    <div className="set-loading">设置加载中…</div>
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
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <header className="settings-head">
        <span className="settings-title">设置</span>
        <span className="settings-head-hint">{active.label}</span>
        <span className="spacer" />
        <ResetButton />
        <button type="button" className="settings-close" aria-label="关闭设置" title="关闭（Esc）" onClick={close}>
          ×
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-tree" aria-label="设置分类">
          {SETTINGS_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`settings-nav-item${c.id === active.id ? " active" : ""}`}
              aria-current={c.id === active.id ? "true" : undefined}
              onClick={() => setCategory(c.id)}
            >
              <span className="settings-nav-label">{c.label}</span>
              <span className="settings-nav-hint">{c.hint}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {/* key per category: fresh page state (drafts / errors) on switch */}
          <div className="settings-page" key={active.id} role="region" aria-label={`设置 · ${active.label}`}>
            {renderPage(active.id)}
          </div>
        </div>
      </div>
      <footer className="settings-foot">
        <span>修改即时保存 — 所有变更立即生效并写入服务端设置</span>
        <span className="settings-foot-dim">settings.json</span>
      </footer>
    </div>
  );
}
