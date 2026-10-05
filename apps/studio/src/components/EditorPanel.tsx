// EditorPanel: Monaco host with file tabs (entry + test files), dirty tracking
// via model.getAlternativeVersionId(), Ctrl+S → PUT /api/file (recompiles).
// One editor instance; models are swapped per tab. Entry model URI is
// "file:///src/video.ts" so `import "@videoos/dsl"` resolves through the
// server-provided typings (addExtraLib "file:///node_modules/@videoos/…" paths).
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import * as api from "../api";
import { useStudio } from "../store";
import { useApiErrorMessage } from "../i18n/errors";
import { useI18n } from "../i18n";
import { getMonacoThemeName } from "../monaco-theme";
import { Button, Spinner } from "./ui";

// ---- module-level Monaco setup (runs once) ----
// (theme definitions live in ../monaco-theme.ts; the editor follows the
//  active app theme — see applyMonacoTheme in the store's setTheme/boot)

const workerEnv = {
  getWorker(_workerId: string, label: string): Worker {
    return label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker();
  },
};
(self as unknown as { MonacoEnvironment: typeof workerEnv }).MonacoEnvironment = workerEnv;

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  strict: true,
  allowNonTsExtensions: true,
  noEmit: true,
});

let typingsRequested = false;
/** Fetch /api/typings once per page load and register them as extra libs. */
async function ensureTypings(): Promise<void> {
  if (typingsRequested) return;
  typingsRequested = true;
  try {
    const res = await api.getTypings();
    for (const f of res.files) {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(f.content, f.path);
    }
  } catch {
    typingsRequested = false; // allow a retry on the next mount
  }
}

function modelUri(path: string): monaco.Uri {
  return monaco.Uri.parse(`file:///${path.replace(/\\/g, "/")}`);
}

/** Server diagnostics carry no line info (v1); parse an optional "line N" hint. */
function diagLine(message: string, model: monaco.editor.ITextModel): number {
  const m = /line (\d+)/.exec(message);
  if (m !== null) {
    const n = Number.parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, model.getLineCount());
  }
  return 1;
}

// ---- component ----

export function EditorPanel(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const savedVersionsRef = useRef(new Map<string, number>());
  const updatingRef = useRef(new Set<string>());

  const project = useStudio((s) => s.project);
  const openTabs = useStudio((s) => s.openTabs);
  const activeTab = useStudio((s) => s.activeTab);
  const dirty = useStudio((s) => s.dirty);
  const contents = useStudio((s) => s.contents);
  const fileErrors = useStudio((s) => s.fileErrors);
  const compile = useStudio((s) => s.compile);
  const saving = useStudio((s) => s.saving);
  const saveError = useStudio((s) => s.saveError);
  const closeTab = useStudio((s) => s.closeTab);
  const setActiveTab = useStudio((s) => s.setActiveTab);
  const markDirty = useStudio((s) => s.markDirty);

  /** Create (or adopt) the model for a tab path. */
  const ensureModel = (path: string, content: string): monaco.editor.ITextModel => {
    const existing = modelsRef.current.get(path);
    if (existing !== undefined) return existing;
    const uri = modelUri(path);
    let model = monaco.editor.getModel(uri);
    if (model === null) model = monaco.editor.createModel(content, "typescript", uri);
    const m = model;
    savedVersionsRef.current.set(path, m.getAlternativeVersionId());
    m.onDidChangeContent(() => {
      if (updatingRef.current.has(path)) return;
      const saved = savedVersionsRef.current.get(path);
      markDirty(path, saved !== undefined && m.getAlternativeVersionId() !== saved);
    });
    modelsRef.current.set(path, m);
    return m;
  };

  /** Save the active tab: PUT /api/file (recompiles server-side). */
  const saveActive = (): void => {
    const st = useStudio.getState();
    const path = st.activeTab;
    if (path === null) return;
    const model = modelsRef.current.get(path);
    if (model === undefined) return;
    const versionAtSend = model.getAlternativeVersionId();
    void st.saveFile(path, model.getValue()).then(() => {
      const still = modelsRef.current.get(path);
      if (still === undefined) return;
      savedVersionsRef.current.set(path, versionAtSend);
      markDirty(path, still.getAlternativeVersionId() !== versionAtSend);
    });
  };

  // editor lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const editor = monaco.editor.create(host, {
      theme: getMonacoThemeName(),
      model: null,
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      renderWhitespace: "none",
      lineNumbersMinChars: 4,
      padding: { top: 8 },
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveActive());
    void ensureTypings();
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveActive is stable (refs only)
  }, []);

  // dispose all models when the project closes or switches
  const projectRoot = project?.root ?? null;
  const prevRootRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevRootRef.current;
    if (prev !== null && prev !== projectRoot) {
      for (const m of modelsRef.current.values()) m.dispose();
      modelsRef.current.clear();
      savedVersionsRef.current.clear();
      editorRef.current?.setModel(null);
    }
    prevRootRef.current = projectRoot;
  }, [projectRoot]);

  // sync models with tabs/content (includes external updates, e.g. agent edits)
  useEffect(() => {
    if (project === null) return;
    for (const path of openTabs) {
      const content = contents[path];
      if (content === undefined) continue;
      const model = ensureModel(path, content);
      const isDirty = useStudio.getState().dirty[path] ?? false;
      if (model.getValue() !== content && !isDirty) {
        updatingRef.current.add(path);
        model.setValue(content);
        savedVersionsRef.current.set(path, model.getAlternativeVersionId());
        updatingRef.current.delete(path);
      }
    }
  }, [project, openTabs, contents]);

  // activate the model of the active tab
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || activeTab === null) return;
    const model = modelsRef.current.get(activeTab);
    if (model === undefined) return;
    if (editor.getModel() !== model) {
      editor.setModel(model);
      editor.focus();
    }
  }, [activeTab, openTabs, contents]);

  // push compile diagnostics as entry-file markers (whole-file on line 1)
  useEffect(() => {
    if (project === null) return;
    const entryPath = project.entry;
    const model = modelsRef.current.get(entryPath);
    if (model === undefined) return;
    const markers: monaco.editor.IMarkerData[] = (compile?.diagnostics ?? []).map((d) => ({
      severity:
        d.level === "error" ? monaco.MarkerSeverity.Error : d.level === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: `${d.code}: ${d.message}`,
      startLineNumber: diagLine(d.message, model),
      startColumn: 1,
      endLineNumber: diagLine(d.message, model),
      endColumn: 2,
    }));
    monaco.editor.setModelMarkers(model, "videoos", markers);
  }, [project, compile, openTabs, contents]);

  const activeDirty = activeTab !== null && (dirty[activeTab] ?? false);

  return (
    <section className="editor-panel panel" aria-label={t("editor.aria")}>
      <div className="file-tabs" role="tablist">
        {openTabs.map((path) => {
          const isActive = path === activeTab;
          const isDirty = dirty[path] ?? false;
          const loadError = fileErrors[path];
          return (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={loadError !== undefined ? (errText(loadError) ?? "") : path}
              className={`file-tab${isActive ? " active" : ""}${isDirty ? " dirty" : ""}`}
              onClick={() => setActiveTab(path)}
            >
              <span className="dirty-dot" aria-hidden="true" />
              {api.basename(path)}
              {loadError !== undefined ? <span className="error-mark" title={errText(loadError) ?? ""}>!</span> : null}
              <span
                className="close"
                role="button"
                aria-label={t("editor.closeFile", { name: api.basename(path) })}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(path);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      <div className="editor-toolbar">
        <Button variant="primary" small disabled={!activeDirty || saving} onClick={saveActive} title="Ctrl+S">
          {saving ? <Spinner /> : null} {t("editor.save")} {activeTab !== null ? api.basename(activeTab) : ""}
        </Button>
        <span className="editor-hint">{t("editor.hint")}</span>
        {saveError !== null ? <span className="error-text" role="alert">{errText(saveError)}</span> : null}
      </div>
      <div ref={hostRef} className="editor-host" />
    </section>
  );
}
