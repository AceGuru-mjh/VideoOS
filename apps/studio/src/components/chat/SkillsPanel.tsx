// SkillsPanel (v0.2 §6 issue #52): slide-over from the left edge (~340px).
// Search (name/description/trigger), skill rows (name mono + version chip +
// 1-line description + dim trigger + 内置/自定义 badge + enable switch), the
// @ 引用 button (inserts `@name ` into the composer) and the footer 自动触发
// switch (PATCH /api/skills {autoTrigger}).
import { useEffect, useMemo, useState } from "react";
import type * as api from "../../api";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { Button, ErrorText, Spinner, Switch } from "../ui";

export function SkillsPanel(): JSX.Element {
  const { t } = useI18n();
  const open = useStudio((s) => s.skillsOpen);
  const close = useStudio((s) => s.closeSkillsPanel);
  const skillsState = useStudio((s) => s.skills);
  const toggleSkill = useStudio((s) => s.toggleSkill);
  const setAutoTrigger = useStudio((s) => s.setSkillsAutoTrigger);
  const mentionSkill = useStudio((s) => s.mentionSkill);
  const [search, setSearch] = useState("");

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const snapshot = skillsState.snapshot;
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (snapshot === null) return [];
    if (q.length === 0) return snapshot.skills;
    return snapshot.skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.trigger.toLowerCase().includes(q),
    );
  }, [snapshot, q]);

  if (!open) return <></>;

  return (
    <div className="s4-drawer-wrap" role="presentation">
      <div className="s4-drawer-bg" role="presentation" onClick={close} />
      <aside className="s4-drawer skills-drawer" role="dialog" aria-modal="true" aria-label={t("skills.panelAria")}>
        <header className="s4-drawer-head">
          <span className="s4-drawer-title">{t("skills.title")}</span>
          <span className="s4-drawer-sub">{snapshot !== null ? t("skills.countAvailable", { n: snapshot.skills.length }) : ""}</span>
          <button type="button" className="s4-drawer-close" aria-label={t("skills.closeAria")} onClick={close}>
            ×
          </button>
        </header>

        {snapshot !== null && snapshot.customDir !== null ? (
          <div className="s4-note" title={snapshot.customDir}>
            {t("skills.customDir", { dir: snapshot.customDir })}
          </div>
        ) : null}

        <div className="s4-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("skills.search")}
            aria-label={t("skills.searchAria")}
          />
        </div>

        <ErrorText>{skillsState.error}</ErrorText>

        <div className="s4-drawer-body">
          {skillsState.loading && snapshot === null ? (
            <div className="s4-empty">
              <Spinner label={t("skills.loading")} />
            </div>
          ) : snapshot === null ? (
            <div className="s4-empty">
              <span>{t("skills.unavailable")}</span>
              <span className="s4-empty-sub">{t("skills.unavailableSub")}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="s4-empty">
              <span>{snapshot.skills.length === 0 ? t("skills.empty") : t("skills.noMatch", { query: search })}</span>
              <span className="s4-empty-sub">{t("skills.emptySub")}</span>
            </div>
          ) : (
            <div className="s4-list" role="list">
              {filtered.map((skill) => (
                <SkillRow key={skill.name} skill={skill} onToggle={toggleSkill} onMention={mentionSkill} />
              ))}
            </div>
          )}
        </div>

        {snapshot !== null ? (
          <footer className="skills-foot">
            <div className="skills-foot-row">
              <Switch
                checked={snapshot.autoTrigger}
                onChange={(v) => void setAutoTrigger(v)}
                label={t("skills.autoTriggerHint")}
              />
              <span className="skills-foot-text">{t("skills.autoTrigger")}</span>
            </div>
            <span className="skills-foot-hint">{t("skills.autoTriggerHint")}</span>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

function SkillRow({
  skill,
  onToggle,
  onMention,
}: {
  skill: api.SkillListItem;
  onToggle: (name: string, enabled: boolean) => Promise<void>;
  onMention: (name: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className={`skill-row${skill.enabled ? "" : " off"}`} role="listitem">
      <div className="skill-row-main">
        <div className="skill-name-line">
          <span className="skill-name">{skill.name}</span>
          <span className="skill-ver" title={t("skills.versionTitle", { version: skill.version })}>
            v{skill.version}
          </span>
          <span className={`skill-src ${skill.source}`}>{t(skill.source === "builtin" ? "skills.builtin" : "skills.custom")}</span>
        </div>
        <div className="skill-desc" title={skill.description}>
          {skill.description}
        </div>
        <div className="skill-trigger" title={t("skills.triggerTitle", { trigger: skill.trigger })}>
          {t("skills.triggerLine", { trigger: skill.trigger })}
        </div>
      </div>
      <div className="skill-row-acts">
        <Button small ghost onClick={() => onMention(skill.name)} title={t("skills.mentionTitle", { name: skill.name })}>
          {t("skills.mentionBtn")}
        </Button>
        <Switch
          checked={skill.enabled}
          onChange={(v) => void onToggle(skill.name, v)}
          label={t("skills.enableLabel", { name: skill.name })}
          title={skill.enabled ? t("skills.enabledTitle") : t("skills.disabledTitle")}
        />
      </div>
    </div>
  );
}
