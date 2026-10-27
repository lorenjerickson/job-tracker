"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { statusLabel, type Application, type ApplicationSummary, type ResumeVersion } from "@/lib/types";
import { Score, Spinner, api } from "./ui";

type RowState = { state: "idle" | "running" | "done" | "error"; before: number | null; after?: number; error?: string };

/**
 * Re-score open applications against the active resume — e.g. right after uploading an updated version.
 * Only the fit assessment is recomputed; tailored resumes and cover letters are left alone.
 */
export default function ReassessPanel({
  apps: initialApps,
  versions,
  highlight,
}: {
  apps: ApplicationSummary[];
  versions: ResumeVersion[];
  highlight: boolean;
}) {
  const active = versions.find((v) => v.is_active);
  const versionOf = useMemo(() => new Map(versions.map((v) => [v.id, v.version])), [versions]);
  const [apps, setApps] = useState(initialApps);
  const stale = (a: ApplicationSummary) => !!active && a.assessment_resume_id !== active.id;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialApps.filter(stale).map((a) => a.id)));
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [running, setRunning] = useState(false);

  if (!active?.parsed || !apps.length) return null;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function runAll() {
    const queue = apps.filter((a) => selected.has(a.id));
    setRunning(true);
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const app = a;
        setRows((r) => ({ ...r, [app.id]: { state: "running", before: app.fit_score } }));
        try {
          const res = await api<Application>(`/api/applications/${app.id}/generate`, { method: "POST", json: { parts: ["assessment"] } });
          setRows((r) => ({ ...r, [app.id]: { state: "done", before: app.fit_score, after: res.fit_score ?? undefined } }));
          setApps((list) => list.map((x) => (x.id === app.id ? { ...x, fit_score: res.fit_score, assessment_resume_id: active!.id } : x)));
          setSelected((s) => {
            const n = new Set(s);
            n.delete(app.id);
            return n;
          });
        } catch (e) {
          setRows((r) => ({ ...r, [app.id]: { state: "error", before: app.fit_score, error: (e as Error).message } }));
        }
      }
    };
    // Two at a time keeps it quick without hammering the API.
    await Promise.all([worker(), worker()]);
    setRunning(false);
  }

  const staleCount = apps.filter(stale).length;
  const label = statusLabel;

  return (
    <div className="card stack" style={highlight ? { borderColor: "var(--accent)" } : undefined}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>Re-assess applications with v{active.version}</h2>
          <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
            {highlight
              ? "New version uploaded. See how it scores against the jobs you're tracking."
              : staleCount
                ? `${staleCount} open application${staleCount === 1 ? " was" : "s were"} scored against an older resume or not scored yet.`
                : "Every open application is scored against your active resume."}{" "}
            Only fit scores change. Tailored resumes and cover letters stay as they are until you regenerate them.
          </p>
        </div>
        <button className="btn primary" disabled={running || selected.size === 0} onClick={runAll}>
          {running ? <Spinner /> : null} Re-assess {selected.size || ""} selected
        </button>
      </div>
      <div>
        {apps.map((a) => {
          const row = rows[a.id];
          const assessedWith = a.assessment_resume_id ? versionOf.get(a.assessment_resume_id) : undefined;
          return (
            <div key={a.id} className="row" style={{ padding: "0.45rem 0", borderTop: "1px solid var(--border)", flexWrap: "nowrap" }}>
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                disabled={running}
                onChange={() => toggle(a.id)}
                aria-label={`Select ${a.title || "application"}`}
              />
              <div className="grow" style={{ minWidth: 0 }}>
                <Link href={`/applications/${a.id}`}>{a.title || "Untitled role"}</Link>
                <span className="muted small"> · {a.company || "Unknown company"} · {label(a.status)}</span>
              </div>
              <span className="small muted" style={{ whiteSpace: "nowrap" }}>
                {assessedWith ? `scored on v${assessedWith}` : a.fit_score == null ? "not scored" : "scored on deleted version"}
              </span>
              <div className="row" style={{ gap: "0.35rem", flexWrap: "nowrap", minWidth: 150, justifyContent: "flex-end" }}>
                {row?.state === "running" && <Spinner />}
                <Score value={row?.state === "done" ? row.before : a.fit_score} />
                {row?.state === "done" && row.after != null && (
                  <>
                    <span className="muted">→</span>
                    <Score value={row.after} />
                    <Delta before={row.before} after={row.after} />
                  </>
                )}
                {row?.state === "error" && (
                  <span className="badge bad" title={row.error}>
                    failed
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Delta({ before, after }: { before: number | null; after: number }) {
  if (before == null) return null;
  const d = after - before;
  const color = d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : "var(--muted)";
  return (
    <span className="small" style={{ color, fontWeight: 650, minWidth: 34, textAlign: "right" }}>
      {d > 0 ? "+" : ""}
      {d}
    </span>
  );
}
