// SkillsPanel (v0.2 §6 issue #52): slide-over from the left edge (~340px).
// Search (name/description/trigger), skill rows (name mono + version chip +
// 1-line description + dim trigger + 内置/自定义 badge + enable switch), the
// @ 引用 button (inserts `@name ` into the composer) and the footer 自动触发
// switch (PATCH /api/skills {autoTrigger}).
import { useEffect, useMemo, useState } from "react";
import type * as api from "../../api";
import { useStudio } from "../../store";
import { Button, ErrorText, Spinner, Switch } from "../ui";

export function SkillsPanel(): JSX.Element {
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
      <aside className="s4-drawer skills-drawer" role="dialog" aria-modal="true" aria-label="技能面板">
        <header className="s4-drawer-head">
          <span className="s4-drawer-title">技能 Skills</span>
          <span className="s4-drawer-sub">{snapshot !== null ? `${snapshot.skills.length} 个可用` : ""}</span>
          <button type="button" className="s4-drawer-close" aria-label="关闭技能面板" onClick={close}>
            ×
          </button>
        </header>

        {snapshot !== null && snapshot.customDir !== null ? (
          <div className="s4-note" title={snapshot.customDir}>
            自定义技能目录 · {snapshot.customDir}
          </div>
        ) : null}

        <div className="s4-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能（名称 / 描述 / 触发语）…"
            aria-label="搜索技能"
          />
        </div>

        <ErrorText>{skillsState.error}</ErrorText>

        <div className="s4-drawer-body">
          {skillsState.loading && snapshot === null ? (
            <div className="s4-empty">
              <Spinner label="加载技能…" />
            </div>
          ) : snapshot === null ? (
            <div className="s4-empty">
              <span>技能服务不可用</span>
              <span className="s4-empty-sub">需要 v0.2 S4 及之后的服务端（GET /api/skills）。</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="s4-empty">
              <span>{snapshot.skills.length === 0 ? "没有可用技能" : `没有匹配「${search}」的技能`}</span>
              <span className="s4-empty-sub">技能由 skills/ 目录与自定义目录提供。</span>
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
                label="根据消息内容自动匹配技能注入 Agent"
              />
              <span className="skills-foot-text">自动触发</span>
            </div>
            <span className="skills-foot-hint">根据消息内容自动匹配技能注入 Agent</span>
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
  return (
    <div className={`skill-row${skill.enabled ? "" : " off"}`} role="listitem">
      <div className="skill-row-main">
        <div className="skill-name-line">
          <span className="skill-name">{skill.name}</span>
          <span className="skill-ver" title={`版本 ${skill.version}`}>
            v{skill.version}
          </span>
          <span className={`skill-src ${skill.source}`}>{skill.source === "builtin" ? "内置" : "自定义"}</span>
        </div>
        <div className="skill-desc" title={skill.description}>
          {skill.description}
        </div>
        <div className="skill-trigger" title={`触发语：${skill.trigger}`}>
          触发 · {skill.trigger}
        </div>
      </div>
      <div className="skill-row-acts">
        <Button small ghost onClick={() => onMention(skill.name)} title={`在输入框插入 @${skill.name} 显式引用`}>
          @ 引用
        </Button>
        <Switch
          checked={skill.enabled}
          onChange={(v) => void onToggle(skill.name, v)}
          label={`启用技能 ${skill.name}`}
          title={skill.enabled ? "已启用 — 点击停用" : "已停用 — 点击启用"}
        />
      </div>
    </div>
  );
}
