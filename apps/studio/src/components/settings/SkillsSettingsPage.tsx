// SkillsSettingsPage (S6, v0.2 §5 issue #57): the settings center Skills page —
// 自动触发 switch + 自定义技能目录 (PATCH /api/skills，与技能面板同一写路径)
// and the compact enable list (SkillsPanel rows without the drawer chrome).
// The snapshot from GET /api/skills is mirrored into settings.values.skills so
// the advanced JSON editor always prefills with the live enabled map.
import { useEffect, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { normalizeSkillsSection } from "../../settings";
import { Spinner, Switch } from "../ui";
import { SettingsError, SettingsRow, SettingsSection, TextField } from "./fields";

export function SkillsSettingsPage(): JSX.Element {
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
      setOptError(`保存失败：${api.errorMessage(e)}`);
    } finally {
      setOptBusy(false);
    }
  };

  const customDir = snapshot?.customDir ?? "";

  return (
    <>
      <SettingsSection title="技能触发" hint="技能由 skills/ 目录（内置）与自定义目录提供，以 @名称 显式引用">
        <SettingsRow label="自动触发" hint="根据消息内容自动匹配技能注入 Agent（触发语匹配，无需 @ 引用）">
          <Switch
            checked={snapshot?.autoTrigger === true}
            disabled={snapshot === null || optBusy}
            onChange={(v) => void applyOptions({ autoTrigger: v })}
            label="自动触发技能"
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
          label="自定义目录"
          htmlFor="set-skills-dir"
          hint="技能 SKILL.md 所在目录的绝对路径（不存在时静默跳过；同名自定义技能覆盖内置）"
        >
          <TextField
            id="set-skills-dir"
            value={customDir}
            ariaLabel="自定义技能目录"
            placeholder="/home/you/my-skills"
            width={320}
            onCommit={(v) => void applyOptions({ customDir: v.length === 0 ? null : v })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={optError ?? skillsError} />

      <SettingsSection
        title="可用技能"
        hint={snapshot !== null ? `${snapshot.skills.filter((s) => s.enabled).length}/${snapshot.skills.length} 个启用` : undefined}
      >
        {skillsLoading && snapshot === null ? (
          <div className="set-loading">
            <Spinner label="加载技能清单…" />
          </div>
        ) : snapshot === null ? (
          <div className="set-loading">技能服务不可用 — 需要 v0.2 S4 及之后的服务端（GET /api/skills）。</div>
        ) : snapshot.skills.length === 0 ? (
          <div className="set-loading">没有可用技能 — 在 skills/ 目录或自定义目录放置 SKILL.md 后显示在这里。</div>
        ) : (
          <div className="set-skill-list" role="list">
            {snapshot.skills.map((skill) => (
              <div className={`set-skill-row${skill.enabled ? "" : " off"}`} role="listitem" key={skill.name}>
                <div className="set-skill-main">
                  <span className="set-skill-name mono">{skill.name}</span>
                  <span className="set-skill-ver" title={`版本 ${skill.version}`}>
                    v{skill.version}
                  </span>
                  <span className={`set-skill-src ${skill.source}`}>{skill.source === "builtin" ? "内置" : "自定义"}</span>
                  <span className="set-skill-desc" title={skill.description}>
                    {skill.description}
                  </span>
                </div>
                <Switch
                  checked={skill.enabled}
                  onChange={(v) => void toggleSkill(skill.name, v)}
                  label={`启用技能 ${skill.name}`}
                  title={skill.enabled ? "已启用 — 点击停用" : "已停用 — 点击启用"}
                />
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      <div className="set-note">技能变更即时生效 — 下一次对话即可 @ 引用或自动触发。</div>
    </>
  );
}
