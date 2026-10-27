"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STATUSES, type AppEvent, type Application, type CoverLetter, type ParsedResume, type ResumeVersion, type Status, type TailoredResume } from "@/lib/types";
import ResumePaper from "./ResumePaper";
import { ErrorBox, LockIcon, ScoreRing, Spinner, api, confirmStatusChange, relDate } from "./ui";

type Full = Application & { events: AppEvent[] };
type Tab = "fit" | "resume" | "cover" | "jd" | "notes";
type Part = "assessment" | "resume" | "cover";

const MATCH_BADGE = { strong: "good", partial: "warn", gap: "bad" } as const;

export default function ApplicationDetail({
  initial,
  source: initialSource,
  sourceVersion: initialSourceVersion,
  activeVersion,
  assessedVersion: initialAssessedVersion,
  initialError,
}: {
  initial: Full;
  source: ParsedResume | null;
  sourceVersion: number | null;
  activeVersion: number | null;
  assessedVersion: number | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [app, setApp] = useState(initial);
  const [source, setSource] = useState(initialSource);
  const [sourceVersion, setSourceVersion] = useState(initialSourceVersion);
  const [tab, setTab] = useState<Tab>(initial.assessment ? "fit" : "jd");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function generate(parts: Part[] | null, label: string) {
    setBusy(label);
    setError(null);
    try {
      const next = await api<Full>(`/api/applications/${app.id}/generate`, { method: "POST", json: parts ? { parts } : {} });
      if (next.resume_id && next.resume_id !== app.resume_id) {
        const r = await api<ResumeVersion>(`/api/resume/${next.resume_id}`);
        setSource(r.parsed);
        setSourceVersion(r.version);
      }
      setApp(next);
      if (!parts) setTab("fit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function patch(fields: Record<string, unknown>) {
    setError(null);
    try {
      setApp(await api<Full>(`/api/applications/${app.id}`, { method: "PATCH", json: fields }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function setStatus(status: Status) {
    if (!confirmStatusChange(app, status)) return;
    try {
      await api(`/api/applications/${app.id}/move`, { method: "POST", json: { status } });
      setApp(await api<Full>(`/api/applications/${app.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const hasGenerated = !!(app.assessment || app.tailored || app.cover_letter);
  const locked = !!app.submitted_at;
  const resumeWarnings = app.warnings.filter((w) => w.where !== "Cover letter");
  const coverWarnings = app.warnings.filter((w) => w.where === "Cover letter");

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="row small muted" style={{ gap: "0.5rem" }}>
            <Link href="/">← Board</Link>
            {app.job_url && (
              <a href={app.job_url} target="_blank" rel="noreferrer">
                View posting ↗
              </a>
            )}
          </div>
          <h1 style={{ marginTop: "0.4rem" }}>{app.title || "Untitled role"}</h1>
          <div className="row" style={{ gap: "0.5rem", margin: "0.15rem 0 0.35rem" }}>
            <span className="status-pill" data-status={app.status}>
              <span className="status-dot" />
              {STATUSES.find((s) => s.id === app.status)?.label}
            </span>
            {locked && (
              <span className="badge" title="Submitted: the tailored resume and cover letter are locked">
                <LockIcon size={11} /> Documents locked
              </span>
            )}
          </div>
          <div className="subtle">
            {[app.company || "Unknown company", app.location].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="row">
          <select value={app.status} onChange={(e) => setStatus(e.target.value as Status)} style={{ width: 190 }} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {!locked && (
            <button className="btn primary" disabled={!!busy} onClick={() => generate(null, "Regenerating everything… (1–2 min)")}>
              {hasGenerated ? "Regenerate all" : "Generate"}
            </button>
          )}
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm("Delete this application?")) return;
              await api(`/api/applications/${app.id}`, { method: "DELETE" });
              router.push("/");
              router.refresh();
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {busy && (
        <div className="alert info row">
          <Spinner /> {busy}
        </div>
      )}
      <ErrorBox error={error} />
      {locked && (
        <div className="alert info row" style={{ gap: "0.5rem" }}>
          <LockIcon />
          <span>
            Submitted {relDate(app.submitted_at)}. The tailored resume and cover letter are locked to exactly what you sent and
            can&apos;t be edited or regenerated. You can still download them, re-assess fit, and update notes.
          </span>
        </div>
      )}
      {!locked && sourceVersion != null && activeVersion != null && sourceVersion !== activeVersion && (app.tailored || app.cover_letter) && (
        <div className="alert info">
          The tailored resume and cover letter were built from resume v{sourceVersion}; your active resume is v{activeVersion}.
          {" "}Use “Regenerate all” to rebuild them from the latest.
        </div>
      )}

      <div className="tabs" role="tablist">
        {(
          [
            ["fit", "Fit assessment"],
            ["resume", "Tailored resume"],
            ["cover", "Cover letter"],
            ["jd", "Job description"],
            ["notes", "Notes & activity"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
            {!locked && id === "resume" && resumeWarnings.length > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{resumeWarnings.length}</span>}
            {!locked && id === "cover" && coverWarnings.length > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{coverWarnings.length}</span>}
          </button>
        ))}
      </div>

      {tab === "fit" && (
        <FitTab
          app={app}
          busy={!!busy}
          activeVersion={activeVersion}
          assessedVersion={app.assessment?.resume_version ?? initialAssessedVersion}
          onRegen={() => generate(["assessment"], `Re-assessing fit against resume v${activeVersion ?? ""}…`)}
        />
      )}
      {tab === "resume" && (
        <ResumeTab app={app} source={source} busy={!!busy} locked={locked} warnings={resumeWarnings} onRegen={() => generate(["resume"], "Re-tailoring resume…")} onSave={(t) => patch({ tailored: t })} />
      )}
      {tab === "cover" && (
        <CoverTab app={app} source={source} busy={!!busy} locked={locked} warnings={coverWarnings} onRegen={() => generate(["cover"], "Rewriting cover letter…")} onSave={(c) => patch({ cover_letter: c })} />
      )}
      {tab === "jd" && <JdTab app={app} onSave={patch} />}
      {tab === "notes" && <NotesTab app={app} onSave={patch} />}
    </div>
  );
}

function Empty({ what, onGen, busy, locked }: { what: string; onGen: () => void; busy: boolean; locked?: boolean }) {
  if (locked) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
        <p className="subtle" style={{ margin: 0 }}>
          No {what} was generated before this application was submitted, and documents can&apos;t be created after submission.
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
      <p className="subtle">No {what} yet.</p>
      <button className="btn primary" onClick={onGen} disabled={busy}>
        Generate {what}
      </button>
    </div>
  );
}

// ---------------- Fit ----------------

function FitTab({
  app,
  busy,
  activeVersion,
  assessedVersion,
  onRegen,
}: {
  app: Full;
  busy: boolean;
  activeVersion: number | null;
  assessedVersion: number | null;
  onRegen: () => void;
}) {
  const a = app.assessment;
  if (!a) return <Empty what="fit assessment" onGen={onRegen} busy={busy} />;
  const outdated = activeVersion != null && assessedVersion !== activeVersion;
  const delta = a.previous_score != null ? a.score - a.previous_score : null;
  const versionNote = (
    <div className={`alert ${outdated ? "warn" : "info"} row`} style={{ justifyContent: "space-between" }}>
      <span>
        {assessedVersion != null ? `Scored against resume v${assessedVersion}.` : "Scored against an earlier resume version."}
        {outdated && ` Your active resume is v${activeVersion} — re-assess to see how it scores now.`}
        {delta != null && (
          <>
            {" "}Previous score {a.previous_score}% →{" "}
            <b style={{ color: delta > 0 ? "var(--good)" : delta < 0 ? "var(--bad)" : undefined }}>
              {a.score}% ({delta > 0 ? "+" : ""}
              {delta})
            </b>
          </>
        )}
      </span>
      {outdated && (
        <button className="btn sm primary" onClick={onRegen} disabled={busy}>
          Re-assess with v{activeVersion}
        </button>
      )}
    </div>
  );
  const must = a.requirements.filter((r) => r.importance === "must");
  const nice = a.requirements.filter((r) => r.importance === "nice");
  const count = (m: string) => a.requirements.filter((r) => r.match === m).length;
  return (
    <div className="two-col">
      <div className="stack">
        {versionNote}
        <div className="card row" style={{ alignItems: "flex-start", gap: "1.25rem", flexWrap: "nowrap" }}>
          <ScoreRing value={a.score} />
          <div>
            <h2 style={{ marginBottom: "0.25rem" }}>{a.verdict}</h2>
            <div className="row small" style={{ marginBottom: "0.5rem", gap: "0.4rem" }}>
              <span className="badge good">{count("strong")} strong</span>
              <span className="badge warn">{count("partial")} partial</span>
              <span className="badge bad">{count("gap")} gaps</span>
            </div>
            <p className="subtle" style={{ margin: 0 }}>{a.summary}</p>
          </div>
        </div>
        {[
          ["Required qualifications", must],
          ["Preferred qualifications", nice],
        ].map(([label, reqs]) =>
          (reqs as typeof a.requirements).length ? (
            <div className="card" key={label as string}>
              <h3>{label as string}</h3>
              {(reqs as typeof a.requirements).map((r, i) => (
                <div className="req" key={i}>
                  <div>
                    <span className={`badge ${MATCH_BADGE[r.match]}`}>{r.match}</span>
                  </div>
                  <div>
                    <div>{r.requirement}</div>
                    {r.evidence && (
                      <div className="evidence">
                        “{r.evidence}”
                        {r.evidence_verified === false && (
                          <span className="badge warn" style={{ marginLeft: 6 }} title="This quote couldn't be matched word-for-word on your resume — double-check it">
                            not verbatim on resume
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>
      <aside className="stack">
        <div className="card">
          <h3>Strengths to lead with</h3>
          <ul className="list">{a.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        {a.gaps.length > 0 && (
          <div className="card">
            <h3>Gaps</h3>
            <ul className="list">{a.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        <div className="card">
          <h3>Interview talking points</h3>
          <ul className="list">{a.talking_points.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        {a.missing_keywords.length > 0 && (
          <div className="card">
            <h3>JD keywords not on your resume</h3>
            <p className="muted small">Only add these to your master resume if they&apos;re true.</p>
            <div className="row" style={{ gap: "0.35rem" }}>
              {a.missing_keywords.map((k) => <span key={k} className="badge">{k}</span>)}
            </div>
          </div>
        )}
        <p className="muted small">
          Score = weighted share of requirements met (required count double, partial = half). Generated {relDate(app.generated_at)}.
        </p>
        <button className={`btn ${outdated ? "primary" : ""}`} onClick={onRegen} disabled={busy}>
          Re-assess against resume v{activeVersion ?? "?"}
        </button>
      </aside>
    </div>
  );
}

// ---------------- Warnings ----------------

function Warnings({ items }: { items: Full["warnings"] }) {
  if (!items.length) return null;
  return (
    <div className="card">
      <h3>Fact-check notes</h3>
      <p className="muted small">The fact guard caught these in the AI draft and corrected or flagged them. Review before sending.</p>
      <div className="warn-list">
        {items.map((w, i) => (
          <div className="warn-item" key={i}>
            <div className="w-where">{w.where}</div>
            <div style={{ margin: "0.15rem 0" }}>{w.text}</div>
            <div className="muted small">{w.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Resume ----------------

function ResumeTab({
  app,
  source,
  busy,
  locked,
  warnings,
  onRegen,
  onSave,
}: {
  app: Full;
  source: ParsedResume | null;
  busy: boolean;
  locked: boolean;
  warnings: Full["warnings"];
  onRegen: () => void;
  onSave: (t: TailoredResume) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<TailoredResume | null>(null);
  const t = app.tailored;
  if (!t) return <Empty what="tailored resume" onGen={onRegen} busy={busy} locked={locked} />;
  if (locked) return <LockedDoc app={app} kind="resume" notes={t.notes} />;
  if (!source) return <div className="alert warn">The resume version this was built from was deleted. Click “Regenerate all”.</div>;
  const pdf = `/api/applications/${app.id}/resume.pdf`;
  const stamp = encodeURIComponent(app.updated_at);

  return (
    <div className="two-col">
      <div>{editing ? <ResumeEditor src={source} value={editing} onChange={setEditing} /> : <ResumePaper src={source} t={t} />}</div>
      <aside className="stack">
        <div className="card stack">
          {editing ? (
            <>
              <button className="btn primary" onClick={async () => (await onSave(editing)) && setEditing(null)}>Save changes</button>
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            </>
          ) : (
            <>
              <a className="btn primary" href={`${pdf}?download&v=${stamp}`}>Download PDF</a>
              <a className="btn" href={`${pdf}?v=${stamp}`} target="_blank" rel="noreferrer">Open PDF in new tab</a>
              <button className="btn" onClick={() => setEditing(structuredClone(t))}>Edit</button>
              <button className="btn" onClick={onRegen} disabled={busy}>Re-tailor</button>
            </>
          )}
        </div>
        {t.notes && (
          <div className="card">
            <h3>What was emphasized</h3>
            <p className="subtle" style={{ margin: 0 }}>{t.notes}</p>
          </div>
        )}
        <Warnings items={warnings} />
      </aside>
    </div>
  );
}

function ResumeEditor({ src, value, onChange }: { src: ParsedResume; value: TailoredResume; onChange: (t: TailoredResume) => void }) {
  const set = (fn: (d: TailoredResume) => void) => {
    const d = structuredClone(value);
    fn(d);
    onChange(d);
  };
  return (
    <div className="card stack">
      <div className="alert info small">Edits are yours — the fact guard doesn&apos;t touch hand edits, so keep them truthful.</div>
      <label className="field">
        Headline
        <input type="text" value={value.headline} onChange={(e) => set((d) => void (d.headline = e.target.value))} />
      </label>
      <label className="field">
        Summary
        <textarea value={value.summary} onChange={(e) => set((d) => void (d.summary = e.target.value))} />
      </label>
      <div className="field">
        Skills (comma-separated)
        {value.skills.map((g, i) => (
          <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
            <input type="text" style={{ width: 180 }} value={g.category} onChange={(e) => set((d) => void (d.skills[i].category = e.target.value))} />
            <input
              type="text"
              value={g.items.join(", ")}
              onChange={(e) => set((d) => void (d.skills[i].items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)))}
            />
            <button className="btn ghost sm" onClick={() => set((d) => void d.skills.splice(i, 1))} aria-label="Remove skill group">✕</button>
          </div>
        ))}
        <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => set((d) => void d.skills.push({ category: "Skills", items: [] }))}>
          + Skill group
        </button>
      </div>
      <div className="field">
        Experience
        {value.experience.map((r, ri) => {
          const e = src.experience[r.source_index];
          if (!e) return null;
          return (
            <div className="edit-role" key={r.source_index}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b style={{ color: "var(--text)" }}>
                  {e.title} · {e.company} <span className="muted">({e.start} – {e.end})</span>
                </b>
                <div className="row small" style={{ gap: "0.75rem" }}>
                  <label className="row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={r.condensed} onChange={(ev) => set((d) => void (d.experience[ri].condensed = ev.target.checked))} />
                    One-line
                  </label>
                  <label className="row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={!!r.hidden} onChange={(ev) => set((d) => void (d.experience[ri].hidden = ev.target.checked))} />
                    Hide
                  </label>
                </div>
              </div>
              {!r.condensed && !r.hidden && (
                <div className="stack" style={{ gap: "0.4rem", marginTop: "0.5rem" }}>
                  {r.bullets.map((b, bi) => (
                    <div className="row" key={bi} style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                      <textarea style={{ minHeight: 54 }} value={b.text} onChange={(ev) => set((d) => void (d.experience[ri].bullets[bi].text = ev.target.value))} />
                      <div className="stack" style={{ gap: 2 }}>
                        <button className="btn ghost sm" disabled={bi === 0} aria-label="Move up"
                          onClick={() => set((d) => { const bs = d.experience[ri].bullets; [bs[bi - 1], bs[bi]] = [bs[bi], bs[bi - 1]]; })}>↑</button>
                        <button className="btn ghost sm" aria-label="Remove bullet" onClick={() => set((d) => void d.experience[ri].bullets.splice(bi, 1))}>✕</button>
                      </div>
                    </div>
                  ))}
                  <OriginalBullets bullets={e.bullets} used={r.bullets.flatMap((b) => b.source_ids)} roleIndex={r.source_index}
                    onAdd={(text, id) => set((d) => void d.experience[ri].bullets.push({ text, source_ids: [id] }))} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OriginalBullets({ bullets, used, roleIndex, onAdd }: { bullets: string[]; used: string[]; roleIndex: number; onAdd: (text: string, id: string) => void }) {
  const unused = bullets.map((b, j) => ({ b, id: `${roleIndex}.${j}` })).filter((x) => !used.includes(x.id));
  if (!unused.length) return null;
  return (
    <details>
      <summary className="small subtle" style={{ cursor: "pointer" }}>Add back an original bullet ({unused.length} unused)</summary>
      <div className="stack" style={{ gap: 4, marginTop: 6 }}>
        {unused.map((x) => (
          <button key={x.id} className="btn ghost sm" style={{ height: "auto", whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start", padding: "0.35rem 0.5rem" }} onClick={() => onAdd(x.b, x.id)}>
            + {x.b}
          </button>
        ))}
      </div>
    </details>
  );
}

// ---------------- Cover letter ----------------

function CoverTab({
  app,
  source,
  busy,
  locked,
  warnings,
  onRegen,
  onSave,
}: {
  app: Full;
  source: ParsedResume | null;
  busy: boolean;
  locked: boolean;
  warnings: Full["warnings"];
  onRegen: () => void;
  onSave: (c: CoverLetter) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ salutation: string; body: string; signoff: string } | null>(null);
  const c = app.cover_letter;
  if (!c) return <Empty what="cover letter" onGen={onRegen} busy={busy} locked={locked} />;
  if (locked) {
    return (
      <LockedDoc
        app={app}
        kind="cover"
        copyText={[c.salutation, ...c.paragraphs, c.signoff, source?.name ?? ""].filter(Boolean).join("\n\n")}
      />
    );
  }
  const pdf = `/api/applications/${app.id}/cover-letter.pdf`;
  const stamp = encodeURIComponent(app.updated_at);
  const words = (draft ? draft.body : c.paragraphs.join(" ")).split(/\s+/).filter(Boolean).length;

  return (
    <div className="two-col">
      <div>
        {draft ? (
          <div className="card stack">
            <label className="field">Salutation<input type="text" value={draft.salutation} onChange={(e) => setDraft({ ...draft, salutation: e.target.value })} /></label>
            <label className="field">Body (blank line between paragraphs)
              <textarea style={{ minHeight: 420 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </label>
            <label className="field">Sign-off<input type="text" value={draft.signoff} onChange={(e) => setDraft({ ...draft, signoff: e.target.value })} /></label>
          </div>
        ) : (
          <div className="paper" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {source && <h1 style={{ fontSize: 20 }}>{source.name}</h1>}
            <p style={{ margin: "1.25rem 0 1rem" }}>{c.salutation}</p>
            {c.paragraphs.map((p, i) => <p key={i} style={{ marginBottom: "0.9rem" }}>{p}</p>)}
            <p>{c.signoff}</p>
            {source && <p style={{ fontWeight: 700 }}>{source.name}</p>}
          </div>
        )}
      </div>
      <aside className="stack">
        <div className="card stack">
          {draft ? (
            <>
              <button className="btn primary" onClick={async () => {
                const ok = await onSave({ salutation: draft.salutation, signoff: draft.signoff, paragraphs: draft.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) });
                if (ok) setDraft(null);
              }}>Save changes</button>
              <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            </>
          ) : (
            <>
              <a className="btn primary" href={`${pdf}?download&v=${stamp}`}>Download PDF</a>
              <a className="btn" href={`${pdf}?v=${stamp}`} target="_blank" rel="noreferrer">Open PDF in new tab</a>
              <button className="btn" onClick={() => navigator.clipboard.writeText([c.salutation, ...c.paragraphs, c.signoff, source?.name ?? ""].join("\n\n"))}>Copy text</button>
              <button className="btn" onClick={() => setDraft({ salutation: c.salutation, body: c.paragraphs.join("\n\n"), signoff: c.signoff })}>Edit</button>
              <button className="btn" onClick={onRegen} disabled={busy}>Rewrite</button>
            </>
          )}
          <div className="muted small">{words} words</div>
        </div>
        <Warnings items={warnings} />
      </aside>
    </div>
  );
}

// ---------------- Locked (submitted) documents ----------------

/** Read-only view of exactly what was submitted: the frozen PDF itself. */
function LockedDoc({ app, kind, notes, copyText }: { app: Full; kind: "resume" | "cover"; notes?: string; copyText?: string }) {
  const [copied, setCopied] = useState(false);
  const pdf = `/api/applications/${app.id}/${kind === "resume" ? "resume" : "cover-letter"}.pdf`;
  const what = kind === "resume" ? "resume" : "cover letter";
  return (
    <div className="two-col">
      <iframe className="pdf-frame" src={pdf} title={`Submitted ${what}`} />
      <aside className="stack">
        <div className="card stack">
          <div className="row small subtle" style={{ gap: "0.4rem" }}>
            <LockIcon /> Locked — this is the {what} you submitted.
          </div>
          <a className="btn primary" href={`${pdf}?download`}>Download PDF</a>
          <a className="btn" href={pdf} target="_blank" rel="noreferrer">Open PDF in new tab</a>
          {copyText && (
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(copyText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy text"}
            </button>
          )}
        </div>
        {notes && (
          <div className="card">
            <h3>What was emphasized</h3>
            <p className="subtle" style={{ margin: 0 }}>{notes}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------------- Job description ----------------

function JdTab({ app, onSave }: { app: Full; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({ company: app.company, title: app.title, location: app.location, job_url: app.job_url, jd_text: app.jd_text, guidance: app.guidance });
  const [saved, setSaved] = useState(false);
  const dirty = Object.entries(f).some(([k, v]) => app[k as keyof Full] !== v);
  return (
    <div className="card stack">
      <div className="grid-2">
        <label className="field">Company<input type="text" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className="field">Role title<input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Location<input type="text" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <label className="field">Posting URL<input type="url" value={f.job_url} onChange={(e) => setF({ ...f, job_url: e.target.value })} /></label>
      </div>
      <label className="field">Job description<textarea style={{ minHeight: 420 }} value={f.jd_text} onChange={(e) => setF({ ...f, jd_text: e.target.value })} /></label>
      <label className="field">Guidance for generation<textarea style={{ minHeight: 60 }} value={f.guidance} onChange={(e) => setF({ ...f, guidance: e.target.value })} placeholder="e.g. Emphasize accessibility work." /></label>
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={async () => { if (await onSave(f)) { setSaved(true); setTimeout(() => setSaved(false), 2000); } }}>Save</button>
        {saved && <span className="small" style={{ color: "var(--good)" }}>Saved. Regenerate to apply changes to the documents.</span>}
      </div>
    </div>
  );
}

// ---------------- Notes ----------------

function NotesTab({ app, onSave }: { app: Full; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [notes, setNotes] = useState(app.notes);
  const [applied, setApplied] = useState(app.applied_at ?? "");
  return (
    <div className="two-col">
      <div className="card stack">
        <label className="field">
          Notes — contacts, interview dates, follow-ups, salary range…
          <textarea style={{ minHeight: 300 }} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== app.notes && onSave({ notes })} />
        </label>
        <span className="muted small">Saves automatically when you click away.</span>
      </div>
      <aside className="stack">
        <div className="card stack">
          <label className="field">
            Date applied
            <input type="date" value={applied} onChange={(e) => { setApplied(e.target.value); void onSave({ applied_at: e.target.value || null }); }} />
          </label>
        </div>
        <div className="card">
          <h3>Activity</h3>
          <ul className="timeline">
            {app.events.map((ev) => (
              <li key={ev.id}>
                <span className="muted small" style={{ minWidth: 70 }}>{relDate(ev.created_at)}</span>
                <span>{ev.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
