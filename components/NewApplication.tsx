"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
      const { id } = await api<{ id: number }>("/api/applications", {
        method: "POST",
        json: { job_url: url, jd_text: jd, company, title, location, guidance },
      });
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
          <button className="btn primary" disabled={!ready || !hasResume || !!saving} onClick={() => save(true)}>
            Save &amp; analyze fit
          </button>
          <button className="btn" disabled={!ready || !!saving} onClick={() => save(false)}>
            {saving === "save" ? <Spinner /> : null} Just save to board
          </button>
          {!ready && <span className="muted small">Add the job description to continue.</span>}
        </div>
      )}
    </div>
  );
}
