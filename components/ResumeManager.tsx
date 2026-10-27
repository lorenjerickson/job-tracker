"use client";
import { useRef, useState } from "react";
import type { ApplicationSummary, ParsedResume, ResumeVersion } from "@/lib/types";
import ReassessPanel from "./ReassessPanel";
import RichResumeEditor from "./RichResumeEditor";
import { ErrorBox, Spinner, api, relDate } from "./ui";

export default function ResumeManager({ initial, apps }: { initial: ResumeVersion[]; apps: ApplicationSummary[] }) {
  const [versions, setVersions] = useState(initial);
  const [justUploaded, setJustUploaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initial.find((v) => v.is_active)?.id ?? initial[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [view, setView] = useState<"edit" | "json" | "raw">("edit");
  const [dirty, setDirty] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  async function refresh(selectId?: number) {
    const list = await api<ResumeVersion[]>("/api/resume");
    setVersions(list);
    if (selectId) setSelectedId(selectId);
    else if (!list.some((v) => v.id === selectedId)) setSelectedId(list[0]?.id ?? null);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      return setError(/\.doc$/i.test(file.name) ? "Older .doc files aren't supported — in Word, use Save As → Word Document (.docx)." : "Please choose a PDF or Word (.docx) file.");
    }
    void run("Reading and structuring your resume… (about 30–60 seconds)", async () => {
      const fd = new FormData();
      fd.append("file", file);
      const { id } = await api<{ id: number }>("/api/resume", { method: "POST", body: fd });
      await refresh(id);
      setView("edit");
      setJustUploaded(true);
    });
  }

  /** Save the editor's content as a new version, processed exactly like an upload. */
  function saveEdited(html: string) {
    void run("Saving as a new version and re-reading it… (about 30–60 seconds)", async () => {
      const { id } = await api<{ id: number }>("/api/resume/edited", { method: "POST", json: { html, baseId: selected?.id } });
      setDirty(false);
      await refresh(id);
      setJustUploaded(true);
    });
  }

  const confirmDiscard = () => !dirty || window.confirm("You have unsaved edits in the resume editor. Discard them?");

  function selectVersion(id: number) {
    if (id === selectedId || !confirmDiscard()) return;
    setDirty(false);
    setSelectedId(id);
  }

  function openJson() {
    if (selected?.parsed) setJsonDraft(JSON.stringify(selected.parsed, null, 2));
    setView("json");
  }

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) upload(e.dataTransfer.files[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => upload(e.target.files?.[0])} />
        {busy ? (
          <div className="row" style={{ justifyContent: "center" }}>
            <Spinner /> {busy}
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600 }}>{versions.length ? "Upload an updated resume" : "Upload your resume"} <span className="muted">(PDF or Word .docx)</span></div>
            <div className="muted small">Drop a file here or click to browse. Each upload becomes a new version and is made active.</div>
          </>
        )}
      </div>

      <ReassessPanel
        key={versions.find((v) => v.is_active)?.id ?? 0}
        apps={apps}
        versions={versions}
        highlight={justUploaded}
      />

      {versions.length > 0 && (
        <div className="two-col">
          <div className="card">
            {selected && (
              <>
                <div className="row" style={{ marginBottom: "0.75rem" }}>
                  <h2 style={{ margin: 0 }}>Version {selected.version}</h2>
                  {selected.is_active && <span className="badge good">Active</span>}
                  <div className="grow" />
                  <div className="tabs" style={{ margin: 0, border: "none" }}>
                    <button className={`tab ${view === "edit" ? "active" : ""}`} onClick={() => setView("edit")}>
                      Edit resume
                    </button>
                    <button className={`tab ${view === "json" ? "active" : ""}`} onClick={openJson}>
                      Structured data
                    </button>
                    <button className={`tab ${view === "raw" ? "active" : ""}`} onClick={() => setView("raw")}>
                      Extracted text
                    </button>
                  </div>
                </div>
                {/* Kept mounted while other tabs are open so unsaved edits aren't lost. */}
                <div style={{ display: view === "edit" ? "block" : "none" }}>
                  {selected.html ? (
                    <>
                      <p className="muted small">
                        Edit your resume like a document. <b>Save as new version</b> treats it exactly like a fresh upload:
                        it&apos;s re-read, becomes v{Math.max(...versions.map((v) => v.version)) + 1}, and is made active.
                        Earlier versions are kept.
                      </p>
                      <RichResumeEditor
                        html={selected.html}
                        versionLabel={`v${selected.version}`}
                        saving={!!busy}
                        onSave={saveEdited}
                        onDirtyChange={setDirty}
                      />
                    </>
                  ) : (
                    <div className="alert warn">This version hasn&apos;t been parsed yet. Click “Re-parse”.</div>
                  )}
                </div>
                {view === "json" && (
                  <div className="stack">
                    <p className="muted small" style={{ margin: 0 }}>
                      Correct any mistakes in the structured data (keep the same shape). This is the source of truth for every generated document.
                    </p>
                    <textarea className="mono" style={{ minHeight: 520 }} value={jsonDraft} onChange={(e) => setJsonDraft(e.target.value)} spellCheck={false} />
                    <div className="row">
                      <button
                        className="btn primary"
                        disabled={!!busy}
                        onClick={() =>
                          run("Saving…", async () => {
                            let parsed: ParsedResume;
                            try {
                              parsed = JSON.parse(jsonDraft);
                            } catch {
                              throw new Error("That isn't valid JSON — check for a missing comma or quote.");
                            }
                            await api(`/api/resume/${selected.id}`, { method: "PATCH", json: { parsed } });
                            await refresh(selected.id);
                            setView("edit");
                          })
                        }
                      >
                        Save corrections
                      </button>
                      <button className="btn ghost" onClick={() => setView("edit")}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {view === "raw" && (
                  <pre className="pre mono card" style={{ maxHeight: 640, overflow: "auto", margin: 0 }}>
                    {selected.raw_text}
                  </pre>
                )}
              </>
            )}
          </div>

          <aside className="card">
            <h3>Versions</h3>
            <div className="stack" style={{ gap: "0.5rem" }}>
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="edit-role"
                  style={{ cursor: "pointer", borderColor: v.id === selectedId ? "var(--accent)" : undefined }}
                  onClick={() => selectVersion(v.id)}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>v{v.version}</b>
                    {v.is_active && <span className="badge good">Active</span>}
                  </div>
                  <div className="small subtle" style={{ wordBreak: "break-all" }}>{v.filename}</div>
                  <div className="small muted">Uploaded {relDate(v.created_at)}</div>
                </div>
              ))}
            </div>
            {selected && (
              <div className="stack" style={{ marginTop: "1rem" }}>
                {!selected.is_active && (
                  <button
                    className="btn"
                    disabled={!!busy}
                    onClick={() => run("Activating…", async () => (await api(`/api/resume/${selected.id}`, { method: "PATCH", json: { activate: true } }), await refresh(selected.id)))}
                  >
                    Make v{selected.version} active
                  </button>
                )}
                <a className="btn" href={`/api/resume/${selected.id}/pdf?download`}>
                  Download v{selected.version} as PDF
                </a>
                {selected.mime !== "text/html" && (
                  <a className="btn" href={`/api/resume/${selected.id}/file`} target="_blank" rel="noreferrer">
                    {selected.mime === "application/pdf" ? "View original PDF" : "Download original .docx"}
                  </a>
                )}
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => run("Re-parsing…", async () => (await api(`/api/resume/${selected.id}/reparse`, { method: "POST" }), await refresh(selected.id)))}
                >
                  Re-parse from original
                </button>
                <button
                  className="btn danger"
                  disabled={!!busy}
                  onClick={() => {
                    if (confirm(`Delete resume v${selected.version}? Applications built from it will need regenerating to download PDFs.`))
                      void run("Deleting…", async () => (await api(`/api/resume/${selected.id}`, { method: "DELETE" }), await refresh()));
                  }}
                >
                  Delete version
                </button>
                {busy && (
                  <div className="row small subtle">
                    <Spinner /> {busy}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
