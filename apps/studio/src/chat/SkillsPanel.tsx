// Skills 面板（#52 UI）：右栏卡片 —— 搜索 + 技能清单（启用开关 / 点击名插入 @引用 /
// 描述省略 + title 提示 / 来源 chip）+ autoTrigger 设置开关（getSettings/putSettings 缓存进 store）。
import { useMemo, useState } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Chip } from "../components/ui";
import { Collapse, EmptyState, Toggle } from "./ui";

export function SkillsPanel({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element {
  const { t } = useI18n();
  const skills = useStudio((s) => s.skills);
  const skillsLoading = useStudio((s) => s.skillsLoading);
  const settings = useStudio((s) => s.settings);
  const loadSkills = useStudio((s) => s.loadSkills);
  const toggleSkill = useStudio((s) => s.toggleSkill);
  const insertSkillRef = useStudio((s) => s.insertSkillRef);
  const setAutoTrigger = useStudio((s) => s.setAutoTrigger);

  const [query, setQuery] = useState("");
  const [saveError, setSaveError] = useState(false);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q.length === 0 ? skills : skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))),
    [skills, q],
  );
  const autoTrigger = settings?.skills.autoTrigger ?? false;

  return (
    <Collapse
      title={t("skills.title")}
      open={open}
      onToggle={onToggle}
      actions={
        <>
          <Chip tone="default" title={t("skills.count", { n: skills.length })}>
            {skills.length}
          </Chip>
          <button type="button" className="icon-btn" title={t("skills.refresh")} onClick={() => void loadSkills()}>
            ↻
          </button>
        </>
      }
    >
      <input
        className="skill-search"
        type="text"
        value={query}
        placeholder={t("skills.search")}
        aria-label={t("skills.search")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="skill-list">
        {skillsLoading && skills.length === 0 ? (
          <>
            <div className="skeleton-row" />
            <div className="skeleton-row" style={{ width: "85%" }} />
            <div className="skeleton-row" style={{ width: "92%" }} />
          </>
        ) : filtered.length === 0 ? (
          <EmptyState>{t("skills.empty")}</EmptyState>
        ) : (
          filtered.map((s) => (
            <div key={s.name} className="skill-item">
              <div className="skill-info">
                <button
                  type="button"
                  className="skill-name"
                  title={t("skills.insert")}
                  onClick={() => insertSkillRef(s.name)}
                >
                  @{s.name}
                </button>
                <span className="skill-desc" title={s.description}>
                  {s.description}
                </span>
              </div>
              <Chip tone="default" title={s.source === "custom" ? t("skills.custom") : t("skills.builtin")}>
                {s.source === "custom" ? t("skills.custom") : t("skills.builtin")}
              </Chip>
              <Toggle
                checked={s.enabled}
                onChange={(v) => void toggleSkill(s.name, v)}
                label={`${s.name} · ${s.enabled ? t("skills.enabled") : t("skills.disabled")}`}
              />
            </div>
          ))
        )}
      </div>
      <div className="rail-setting">
        <span className="rail-setting-label" title={t("skills.autoTriggerHint")}>
          {t("skills.autoTrigger")}
        </span>
        {saveError ? <span className="settings-error" role="alert">{t("settings.saveFailed")}</span> : null}
        <Toggle
          checked={autoTrigger}
          onChange={(v) => {
            setSaveError(false);
            void setAutoTrigger(v).then((ok) => setSaveError(!ok));
          }}
          label={t("skills.autoTrigger")}
        />
      </div>
    </Collapse>
  );
}
