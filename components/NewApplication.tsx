"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DuplicateMatch } from "@/lib/duplicates";
import { DuplicateList } from "./Duplicates";
import { ErrorBox, Spinner, api } from "./ui";

type Fetched = { text: string; company: string; title: string; location: string; source: string };

export default function NewApplication({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [jd, setJd] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [guidance, setGuidance] = useState("");
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"save" | "analyze" | null>(null);
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [confirmedNew, setConfirmedNew] = useState(false);

  // Check for duplicates as the link, company, title, or description change.
  useEffect(() => {
    if (!url.trim() && !company.trim() && !title.trim() && jd.trim().length < 300) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<{ matches: DuplicateMatch[] }>("/api/applications/duplicates", {
          method: "POST",
          json: { job_url: url, company, title, jd_text: jd },
        });
        setMatches(r.matches);
      } catch {
        /* the check is advisory; saving re-checks on the server */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [url, company, title, jd]);

  const dups = matches.filter((m) => m.strength !== "same_company");
  const sameCompany = matches.filter((m) => m.strength === "same_company");
  // A newly found duplicate needs a fresh confirmation.
  const dupKey = dups.map((d) => d.id).join(",");
  useEffect(() => setConfirmedNew(false), [dupKey]);

  async function fetchJd() {
    setFetching(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<Fetched>("/api/jobs/fetch", { method: "POST", json: { url } });
      setJd(r.text);
      if (r.company) setCompany(r.company);
      if (r.title) setTitle(r.title);
      if (r.location) setLocation(r.location);
      setNote(
        r.source === "structured-data"
          ? "Found the posting's structured job data. Review the text below."
          : "Extracted the page text. Trim anything that isn't part of the job description (navigation, other jobs, etc.).",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  }

  async function save(analyze: boolean) {
    setSaving(analyze ? "analyze" : "save");
    setError(null);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_url: url, jd_text: jd, company, title, location, guidance, allow_duplicate: confirmedNew }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicates) {
        setMatches(data.duplicates);
        setSaving(null);
        return;
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const id = data.id as number;
      if (analyze) {
        try {
          await api(`/api/applications/${id}/generate`, { method: "POST", json: { parts: ["assessment"] } });
        } catch (e) {
          // The application exists; send the user there to retry.
          router.push(`/applications/${id}?error=${encodeURIComponent((e as Error).message)}`);
          return;
        }
      }
      router.push(`/applications/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(null);
    }
  }

  const ready = jd.trim().length >= 100;
  const blocked = dups.length > 0 && !confirmedNew;

  return (
    <div className="stack">
      {!hasResume && (
        <div className="alert warn">
          You haven&apos;t uploaded a resume yet. You can save the job now, but analyzing fit needs your resume — <a href="/resume">upload it here</a>.
        </div>
      )}
      <div className="card stack">
        <h2>1. Job posting</h2>
        <div className="row">
          <input
            type="url"
            className="grow"
            style={{ flex: 1, minWidth: 260 }}
            placeholder="https://boards.greenhouse.io/company/jobs/12345"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && fetchJd()}
          />
          <button className="btn" onClick={fetchJd} disabled={!url || fetching}>
            {fetching ? <Spinner /> : null} Fetch description
          </button>
        </div>
        {note && <div className="alert info">{note}</div>}
        <label className="field">
          <span>Job description <span className="muted">(fetched from the link, or paste it here)</span></span>
          <textarea style={{ minHeight: 280 }} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description…" />
        </label>
        <div className="grid-2">
          <label className="field">
            Company
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Auto-detected if blank" />
          </label>
          <label className="field">
            Role title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-detected if blank" />
          </label>
          <label className="field">
            Location
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card stack">
        <h2>2. Anything to emphasize? <span className="muted small">(optional)</span></h2>
        <textarea
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="e.g. Lead with my design-system work. Keep the cover letter under 250 words. I'd prefer not to list roles before 2000."
          style={{ minHeight: 70 }}
        />
        <p className="muted small" style={{ margin: 0 }}>
          Used later, when you generate the tailored resume and cover letter. Guidance shapes emphasis and tone only — nothing is ever
          added that isn&apos;t on your resume.
        </p>
      </div>

      {dups.length > 0 && (
        <div className="card stack dup-card">
          <div>
            <h2 style={{ margin: 0 }}>You may have added this job already</h2>
            <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
              {dups.length === 1 ? "This application looks" : `These ${dups.length} applications look`} like the same listing.
            </p>
          </div>
          <DuplicateList matches={dups} />
          <label className="row small" style={{ gap: "0.5rem" }}>
            <input type="checkbox" checked={confirmedNew} onChange={(e) => setConfirmedNew(e.target.checked)} />
            It&apos;s a different job — save it anyway
          </label>
        </div>
      )}
      {sameCompany.length > 0 && (
        <details className="card">
          <summary className="small subtle" style={{ cursor: "pointer" }}>
            You have {sameCompany.length} other application{sameCompany.length === 1 ? "" : "s"} at this company
          </summary>
          <div style={{ marginTop: "0.6rem" }}>
            <DuplicateList matches={sameCompany} />
          </div>
        </details>
      )}

      <ErrorBox error={error} />
      {saving === "analyze" ? (
        <div className="card">
          <div className="row">
            <Spinner /> <b>Analyzing your fit for this job — usually under a minute.</b>
          </div>
          <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
            Next you can clarify any partial matches or gaps. The tailored resume and cover letter unlock at a 75% fit score.
          </p>
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" disabled={!ready || !hasResume || !!saving || blocked} onClick={() => save(true)}>
            Save &amp; analyze fit
          </button>
          <button className="btn" disabled={!ready || !!saving || blocked} onClick={() => save(false)}>
            {saving === "save" ? <Spinner /> : null} Just save to board
          </button>
          {!ready && <span className="muted small">Add the job description to continue.</span>}
          {ready && blocked && <span className="muted small">Possible duplicate: confirm it&apos;s a different job above.</span>}
        </div>
      )}
    </div>
  );
}
