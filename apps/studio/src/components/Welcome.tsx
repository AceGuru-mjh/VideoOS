// Welcome: open an existing project, init a new one, or pick a recent project
// (persisted in localStorage under "videoos.recents").
import { useState } from "react";
import { useStudio } from "../store";
import { Button, ErrorText } from "./ui";

export function Welcome(): JSX.Element {
  const recents = useStudio((s) => s.recents);
  const projectError = useStudio((s) => s.projectError);
  const openProject = useStudio((s) => s.openProject);
  const initProject = useStudio((s) => s.initProject);

  const [root, setRoot] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submitOpen = async (): Promise<void> => {
    if (root.trim().length === 0) {
      setFormError("enter a project root path");
      return;
    }
    setFormError(null);
    setOpening(true);
    await openProject(root.trim());
    setOpening(false);
  };

  const submitInit = async (): Promise<void> => {
    if (parentDir.trim().length === 0 || name.trim().length === 0) {
      setFormError("parent directory and project name are both required");
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
      <p className="welcome-sub">Agent-native video IDE — DSL → VIR → canvas render → MP4, with visual QA.</p>

      <div className="welcome-grid">
        <div className="welcome-card">
          <h3>Open project</h3>
          <label>
            project root (folder containing video.project.json)
            <input
              value={root}
              placeholder="/path/to/my-video"
              spellCheck={false}
              onChange={(e) => setRoot(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitOpen();
              }}
            />
          </label>
          <div className="row">
            <Button variant="primary" disabled={opening} onClick={() => void submitOpen()}>
              {opening ? "Opening…" : "Open"}
            </Button>
          </div>
        </div>

        <div className="welcome-card">
          <h3>Init new project</h3>
          <label>
            parent directory
            <input
              value={parentDir}
              placeholder="/path/to/projects"
              spellCheck={false}
              onChange={(e) => setParentDir(e.target.value)}
            />
          </label>
          <label>
            project name
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
              {initializing ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </div>

      <ErrorText>{formError}</ErrorText>
      <ErrorText>{projectError}</ErrorText>

      {recents.length > 0 ? (
        <div className="recents">
          <h3>Recent projects</h3>
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
