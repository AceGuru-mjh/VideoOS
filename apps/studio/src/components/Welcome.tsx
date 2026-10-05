// Welcome: open an existing project, init a new one, or pick a recent project
// (persisted in localStorage under "videoos.recents").
import { useState } from "react";
import { useStudio } from "../store";
import { useApiErrorMessage } from "../i18n/errors";
import { useI18n } from "../i18n";
import { Button, ErrorText } from "./ui";

export function Welcome(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const recents = useStudio((s) => s.recents);
  const projectError = useStudio((s) => s.projectError);
  const openProject = useStudio((s) => s.openProject);
  const initProject = useStudio((s) => s.initProject);

  const desktop = typeof window !== "undefined" ? window.videoosDesktop : undefined;

  const [root, setRoot] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState(false);
  const [initializing, setInitializing] = useState(false);
  /** 校验提示存词典键，渲染时 t() —— 切语言即时生效 */
  const [formError, setFormError] = useState<string | null>(null);

  const submitOpen = async (): Promise<void> => {
    if (root.trim().length === 0) {
      setFormError("welcome.errRootRequired");
      return;
    }
    setFormError(null);
    setOpening(true);
    await openProject(root.trim());
    setOpening(false);
  };

  const submitInit = async (): Promise<void> => {
    if (parentDir.trim().length === 0 || name.trim().length === 0) {
      setFormError("welcome.errParentNameRequired");
      return;
    }
    setFormError(null);
    setInitializing(true);
    await initProject(parentDir.trim(), name.trim());
    setInitializing(false);
  };

  return (
    <main className="welcome">
      <h1 className="welcome-title">
        <span className="glyph">▶</span> VideoOS Studio
      </h1>
      <p className="welcome-sub">{t("welcome.subtitle")}</p>

      <div className="welcome-grid">
        <div className="welcome-card">
          <h3>{t("welcome.openTitle")}</h3>
          <label>
            {t("welcome.rootLabel")}
            <input
              value={root}
              placeholder="/path/to/my-video"
              spellCheck={false}
              onChange={(e) => setRoot(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitOpen();
              }}
            />
            {desktop !== undefined ? (
              <Button
                ghost
                small
                onClick={() => {
                  void desktop.selectProjectRoot().then((picked) => {
                    if (picked !== null) setRoot(picked);
                  });
                }}
              >
                {t("welcome.browse")}
              </Button>
            ) : null}
          </label>
          <div className="row">
            <Button variant="primary" disabled={opening} onClick={() => void submitOpen()}>
              {opening ? t("welcome.opening") : t("welcome.open")}
            </Button>
          </div>
        </div>

        <div className="welcome-card">
          <h3>{t("welcome.initTitle")}</h3>
          <label>
            {t("welcome.parentLabel")}
            <input
              value={parentDir}
              placeholder="/path/to/projects"
              spellCheck={false}
              onChange={(e) => setParentDir(e.target.value)}
            />
            {desktop !== undefined ? (
              <Button
                ghost
                small
                onClick={() => {
                  void desktop.selectDirectory().then((picked) => {
                    if (picked !== null) setParentDir(picked);
                  });
                }}
              >
                {t("welcome.browse")}
              </Button>
            ) : null}
          </label>
          <label>
            {t("welcome.nameLabel")}
            <input
              value={name}
              placeholder="my-video"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitInit();
              }}
            />
          </label>
          <div className="row">
            <Button disabled={initializing} onClick={() => void submitInit()}>
              {initializing ? t("welcome.creating") : t("welcome.create")}
            </Button>
          </div>
        </div>
      </div>

      <ErrorText>{formError === null ? null : t(formError)}</ErrorText>
      <ErrorText>{errText(projectError)}</ErrorText>

      {recents.length > 0 ? (
        <div className="recents">
          <h3>{t("welcome.recent")}</h3>
          <div className="recents-list">
            {recents.map((r) => (
              <button key={r} type="button" className="recent-item" onClick={() => void openProject(r)} title={r}>
                <span className="glyph">▸</span>
                {r}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
