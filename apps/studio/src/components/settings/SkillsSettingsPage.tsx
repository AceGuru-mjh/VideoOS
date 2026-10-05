// SkillsSettingsPage (S6, v0.2 §5 issue #57): the settings center Skills page —
// 自动触发 switch + 自定义技能目录 (PATCH /api/skills，与技能面板同一写路径)
// and the compact enable list (SkillsPanel rows without the drawer chrome).
// The snapshot from GET /api/skills is mirrored into settings.values.skills so
// the advanced JSON editor always prefills with the live enabled map.
import { useEffect, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { normalizeSkillsSection } from "../../settings";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { Spinner, Switch } from "../ui";
import { SettingsError, SettingsRow, SettingsSection, TextField } from "./fields";

export function SkillsSettingsPage(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const snapshot = useStudio((s) => s.skills.snapshot);
  const skillsLoading = useStudio((s) => s.skills.loading);
  const skillsError = useStudio((s) => s.skills.error);
  const loadSkills = useStudio((s) => s.loadSkills);
  const toggleSkill = useStudio((s) => s.toggleSkill);

  const [optBusy, setOptBusy] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  // fresh roster whenever the page mounts
  useEffect(() => {
    void loadSkills(true);
  }, [loadSkills]);

  // mirror the live enabled map into settings.values (JSON editor prefill)
  useEffect(() => {
    if (snapshot === null) return;
    useStudio.setState((st) =>
      st.settings.values === null
        ? {}
        : {
            settings: {
              values: {
                ...st.settings.values,
                skills: {
                  ...normalizeSkillsSection(st.settings.values.skills),
                  autoTrigger: snapshot.autoTrigger,
                  injectRecipes: snapshot.injectRecipes === true,
                  customDir: snapshot.customDir,
                  enabled: Object.fromEntries(snapshot.skills.map((s) => [s.name, s.enabled])),
                },
              },
            },
          },
    );
  }, [snapshot]);

  /** both options share the /api/skills write path (single source of truth) */
  const applyOptions = async (body: {
    autoTrigger?: boolean;
    injectRecipes?: boolean;
    customDir?: string | null;
  }): Promise<void> => {
    if (optBusy) return;
    setOptBusy(true);
    setOptError(null);
    try {
      const res = await api.patchSkillsOptions(body);
      useStudio.setState((st) => {
        const next: Partial<import("../../store").StudioState> = {};
        if (st.skills.snapshot !== null) {
          next.skills = {
            ...st.skills,
            snapshot: {
              ...st.skills.snapshot,
              autoTrigger: res.autoTrigger,
              injectRecipes: res.injectRecipes === true,
              customDir: res.customDir,
            },
          };
        }
        if (st.settings.values !== null) {
          next.settings = {
            values: {
              ...st.settings.values,
              skills: {
                ...normalizeSkillsSection(st.settings.values.skills),
                autoTrigger: res.autoTrigger,
                injectRecipes: res.injectRecipes === true,
                customDir: res.customDir,
              },
            },
          };
        }
        return next;
      });
    } catch (e) {
      const raw = api.errorMessage(e);
      setOptError(t("skills.errSaveFailed", { msg: errText(raw) ?? raw }));
    } finally {
      setOptBusy(false);
    }
  };

  const customDir = snapshot?.customDir ?? "";

  return (
    <>
      <SettingsSection title={t("skills.settingsTriggerTitle")} hint={t("skills.settingsTriggerHint")}>
        <SettingsRow label={t("skills.autoTrigger")} hint={t("skills.settingsAutoTriggerHint")}>
          <Switch
            checked={snapshot?.autoTrigger === true}
            disabled={snapshot === null || optBusy}
            onChange={(v) => void applyOptions({ autoTrigger: v })}
            label={t("skills.settingsAutoTriggerLabel")}
          />
        </SettingsRow>
        <SettingsRow label="注入配方代码" hint="向系统提示注入技能的 Recipes 代码示例，普通模型建议开启">
          <Switch
            checked={snapshot?.injectRecipes === true}
            disabled={snapshot === null || optBusy}
            onChange={(v) => void applyOptions({ injectRecipes: v })}
            label="注入配方代码"
          />
        </SettingsRow>
        <SettingsRow
          label={t("skills.settingsCustomDirLabel")}
          htmlFor="set-skills-dir"
          hint={t("skills.settingsCustomDirHint")}
        >
          <TextField
            id="set-skills-dir"
            value={customDir}
            ariaLabel={t("skills.settingsCustomDirAria")}
            placeholder="/home/you/my-skills"
            width={320}
            onCommit={(v) => void applyOptions({ customDir: v.length === 0 ? null : v })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={optError ?? errText(skillsError)} />

      <SettingsSection
        title={t("skills.settingsListTitle")}
        hint={
          snapshot !== null
            ? t("skills.settingsEnabledCount", {
                enabled: snapshot.skills.filter((s) => s.enabled).length,
                total: snapshot.skills.length,
              })
            : undefined
        }
      >
        {skillsLoading && snapshot === null ? (
          <div className="set-loading">
            <Spinner label={t("skills.settingsLoading")} />
          </div>
        ) : snapshot === null ? (
          <div className="set-loading">
            {t("skills.unavailable")} — {t("skills.unavailableSub")}
          </div>
        ) : snapshot.skills.length === 0 ? (
          <div className="set-loading">
            {t("skills.empty")} — {t("skills.settingsEmptySub")}
          </div>
        ) : (
          <div className="set-skill-list" role="list">
            {snapshot.skills.map((skill) => (
              <div className={`set-skill-row${skill.enabled ? "" : " off"}`} role="listitem" key={skill.name}>
                <div className="set-skill-main">
                  <span className="set-skill-name mono">{skill.name}</span>
                  <span className="set-skill-ver" title={t("skills.versionTitle", { version: skill.version })}>
                    v{skill.version}
                  </span>
                  <span className={`set-skill-src ${skill.source}`}>{skill.source === "builtin" ? t("skills.builtin") : t("skills.custom")}</span>
                  <span className="set-skill-desc" title={skill.description}>
                    {skill.description}
                  </span>
                </div>
                <Switch
                  checked={skill.enabled}
                  onChange={(v) => void toggleSkill(skill.name, v)}
                  label={t("skills.enableLabel", { name: skill.name })}
                  title={skill.enabled ? t("skills.enabledTitle") : t("skills.disabledTitle")}
                />
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      <div className="set-note">{t("skills.settingsNote")}</div>
    </>
  );
}
