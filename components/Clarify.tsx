"use client";
import { useState } from "react";
import type { AppEvent, Application, Assessment, Clarification, ResumeAddition } from "@/lib/types";
import { Spinner, api } from "./ui";

type Full = Application & { events: AppEvent[] };
type Req = Assessment["requirements"][number];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

// ---------------- Per-requirement clarification ----------------

/**
 * Shown under each "partial" or "gap" requirement. The candidate describes relevant experience in their own words;
 * drafts are saved with the application and added to the base resume from the Clarify panel.
 */
export function ClarifyBox({
  req,
  items,
  onSave,
}: {
  req: Req;
  items: Clarification[];
  onSave: (c: Clarification, remove?: boolean) => Promise<boolean>;
}) {
  const draft = items.find((c) => c.applied_version == null);
  const applied = items.filter((c) => c.applied_version != null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(remove = false) {
    setSaving(true);
    const c: Clarification = draft
      ? { ...draft, text: text.trim() }
      : {
          id: newId(),
          requirement: req.requirement,
          match: req.match === "partial" ? "partial" : "gap",
          text: text.trim(),
          applied_version: null,
          created_at: new Date().toISOString(),
        };
    const ok = await onSave(c, remove || !text.trim());
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <div className="clarify">
      {applied.map((c) => (
        <div className="clar applied" key={c.id}>
          <span className="badge good">Added to v{c.applied_version}</span>
          <span>{c.text}</span>
        </div>
      ))}
      {editing ? (
        <div className="stack" style={{ gap: "0.4rem" }}>
          {req.probe && <div className="probe">{req.probe}</div>}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What have you actually done that relates? Name the company or project, what you did, the tools, and any results you can stand behind."
            style={{ minHeight: 90 }}
          />
          <div className="row" style={{ gap: "0.4rem" }}>
            <button className="btn sm primary" disabled={saving || !text.trim()} onClick={() => save()}>
              {saving ? <Spinner /> : null} Save clarification
            </button>
            <button className="btn sm ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
            {draft && (
              <button className="btn sm ghost danger" disabled={saving} onClick={() => save(true)}>
                Remove
              </button>
            )}
            <span className="muted small">Facts only — this goes onto your base resume.</span>
          </div>
        </div>
      ) : draft ? (
        <div className="clar draft">
          <span className="badge">Draft</span>
          <span style={{ flex: 1 }}>{draft.text}</span>
          <button
            className="btn sm ghost"
            onClick={() => {
              setText(draft.text);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="row" style={{ gap: "0.5rem", flexWrap: "nowrap", alignItems: "flex-start" }}>
          <button
            className="btn sm"
            onClick={() => {
              setText("");
              setEditing(true);
            }}
          >
            {applied.length ? "+ Add more detail" : "+ Clarify"}
          </button>
          {req.probe && !applied.length && <span className="probe">{req.probe}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- Review drafts and add them to the base resume ----------------

type Draft = {
  base_id: number;
  base_version: number;
  clarification_ids: string[];
  roles: { title: string; company: string; start: string; end: string }[];
  skill_categories: string[];
  additions: ResumeAddition[];
};

const KIND_LABEL: Record<ResumeAddition["kind"], string> = {
  bullet: "Experience bullet",
  skill: "Skill",
  certification: "Certification",
  other: "Other section",
};

export function ClarifyPanel({
  app,
  busy,
  onApplied,
}: {
  app: Full;
  busy: boolean;
  onApplied: (next: Full, version: number, reanalyze: boolean, rebuilt: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = app.clarifications.filter((c) => c.applied_version == null && c.text.trim());
  const applied = app.clarifications.filter((c) => c.applied_version != null);

  async function review() {
    setLoading("Drafting resume additions from your clarifications…");
    setError(null);
    try {
      setDraft(await api<Draft>(`/api/applications/${app.id}/clarify`, { method: "POST", json: {} }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function save(reanalyze: boolean) {
    if (!draft) return;
    setLoading(`Saving resume v${draft.base_version + 1}…`);
    setError(null);
    try {
      const additions = draft.additions.filter((a) => a.text.trim());
      const used = new Set(additions.map((a) => a.clarification_id));
      const res = await api<Full & { new_version: number; rebuilt: boolean }>(`/api/applications/${app.id}/clarify/apply`, {
        method: "POST",
        json: { base_id: draft.base_id, clarification_ids: draft.clarification_ids.filter((id) => used.has(id)), additions },
      });
      setDraft(null);
      onApplied(res, res.new_version, reanalyze, res.rebuilt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const set = (i: number, patch: Partial<ResumeAddition>) =>
    setDraft((d) => (d ? { ...d, additions: d.additions.map((a, j) => (j === i ? { ...a, ...patch } : a)) } : d));

  if (!draft) {
    if (!pending.length && !applied.length) {
      return (
        <div className="card clarify-panel">
          <h3>Is a gap not really a gap?</h3>
          <p className="subtle small" style={{ margin: 0 }}>
            Use <b>+ Clarify</b> on any partial match or gap below to describe experience your resume leaves out. Clarifications are added
            to your base resume as a new version, and then you can re-analyze this job against it.
          </p>
        </div>
      );
    }
    return (
      <div className="card clarify-panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h3 style={{ margin: 0 }}>Your clarifications</h3>
            <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
              {pending.length
                ? `${pending.length} draft${pending.length === 1 ? "" : "s"} ready to add to your base resume.`
                : "All clarifications have been added to your base resume."}
              {applied.length > 0 && ` ${applied.length} already added.`}
            </p>
          </div>
          <button className="btn primary" disabled={!pending.length || !!loading || busy} onClick={review}>
            {loading ? <Spinner /> : null} Review &amp; add to resume{pending.length ? ` (${pending.length})` : ""}
          </button>
        </div>
        {loading && <div className="muted small">{loading}</div>}
        {error && <div className="alert error">{error}</div>}
      </div>
    );
  }

  const byClar = new Map(app.clarifications.map((c) => [c.id, c]));
  const empty = draft.clarification_ids.filter((id) => !draft.additions.some((a) => a.clarification_id === id && a.text.trim()));
  const count = draft.additions.filter((a) => a.text.trim()).length;

  return (
    <div className="card clarify-panel stack" style={{ borderColor: "var(--accent)" }}>
      <div>
        <h3 style={{ margin: 0 }}>Proposed additions to resume v{draft.base_version}</h3>
        <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
          Drafted only from what you wrote. Edit anything, fix the role placement, or remove items. Saving creates resume v
          {draft.base_version + 1} and makes it active; v{draft.base_version} is kept.
        </p>
      </div>

      {draft.clarification_ids.map((cid) => {
        const c = byClar.get(cid);
        const items = draft.additions.map((a, i) => ({ a, i })).filter((x) => x.a.clarification_id === cid);
        return (
          <div className="addition-group" key={cid}>
            <div className="small">
              <b>{c?.requirement}</b>
            </div>
            <div className="muted small" style={{ margin: "0.15rem 0 0.5rem" }}>You wrote: “{c?.text}”</div>
            {items.map(({ a, i }) => (
              <div className="addition" key={i}>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  <select
                    value={a.kind}
                    style={{ width: 170 }}
                    aria-label="Where it goes"
                    onChange={(e) => {
                      const kind = e.target.value as ResumeAddition["kind"];
                      set(i, {
                        kind,
                        role_index: kind === "bullet" ? Math.max(0, a.role_index) : -1,
                        section: kind === "skill" ? draft.skill_categories[0] ?? "Skills" : kind === "other" ? "Additional Experience" : "",
                      });
                    }}
                  >
                    {Object.entries(KIND_LABEL).map(([k, l]) => (
                      <option key={k} value={k} disabled={k === "bullet" && !draft.roles.length}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {a.kind === "bullet" && (
                    <select value={a.role_index} style={{ flex: 1, minWidth: 220 }} aria-label="Role" onChange={(e) => set(i, { role_index: Number(e.target.value) })}>
                      {draft.roles.map((r, ri) => (
                        <option key={ri} value={ri}>
                          {[r.title, r.company].filter(Boolean).join(" · ")} ({[r.start, r.end].filter(Boolean).join(" – ")})
                        </option>
                      ))}
                    </select>
                  )}
                  {(a.kind === "skill" || a.kind === "other") && (
                    <input
                      type="text"
                      style={{ flex: 1, minWidth: 180 }}
                      value={a.section}
                      list={a.kind === "skill" ? "skill-cats" : undefined}
                      placeholder={a.kind === "skill" ? "Skill category" : "Section heading"}
                      onChange={(e) => set(i, { section: e.target.value })}
                    />
                  )}
                  <button
                    className="btn ghost sm"
                    aria-label="Remove"
                    onClick={() => setDraft((d) => (d ? { ...d, additions: d.additions.filter((_, j) => j !== i) } : d))}
                  >
                    ✕
                  </button>
                </div>
                <textarea style={{ minHeight: a.kind === "bullet" || a.kind === "other" ? 60 : 38, marginTop: "0.4rem" }} value={a.text} onChange={(e) => set(i, { text: e.target.value })} />
                {a.note && <div className="small" style={{ color: "var(--warn)", marginTop: "0.25rem" }}>{a.note}</div>}
              </div>
            ))}
            {!items.length && <div className="muted small">No change suggested: nothing here that isn&apos;t already on your resume. Add a bullet yourself or make the clarification more specific.</div>}
            <button
              className="btn ghost sm"
              style={{ marginTop: "0.35rem" }}
              onClick={() =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        additions: [
                          ...d.additions,
                          d.roles.length
                            ? { clarification_id: cid, kind: "bullet", role_index: 0, section: "", text: "", note: "" }
                            : { clarification_id: cid, kind: "other", role_index: -1, section: "Additional Experience", text: "", note: "" },
                        ],
                      }
                    : d,
                )
              }
            >
              + Add item
            </button>
          </div>
        );
      })}
      <datalist id="skill-cats">
        {draft.skill_categories.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {empty.length > 0 && count > 0 && (
        <div className="muted small">Clarifications with nothing to add stay as drafts so you can revise them.</div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={!count || !!loading} onClick={() => save(true)}>
          {loading ? <Spinner /> : null} Save as v{draft.base_version + 1} &amp; re-analyze
        </button>
        <button className="btn" disabled={!count || !!loading} onClick={() => save(false)}>
          Save as v{draft.base_version + 1}
        </button>
        <button className="btn ghost" disabled={!!loading} onClick={() => setDraft(null)}>
          Cancel
        </button>
        {loading && <span className="muted small">{loading}</span>}
      </div>
    </div>
  );
}
