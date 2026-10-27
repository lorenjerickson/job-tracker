"use client";
import { SUBMITTED_STATUSES, statusLabel, type Status } from "@/lib/types";

export function Score({ value }: { value: number | null }) {
  if (value == null) return <span className="score" style={{ color: "var(--muted)" }}>—</span>;
  const cls = value >= 75 ? "hi" : value >= 50 ? "mid" : "lo";
  return <span className={`score ${cls}`} title="Fit score">{value}%</span>;
}

export function ScoreRing({ value }: { value: number }) {
  const c = value >= 75 ? "var(--good)" : value >= 50 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="score-ring" style={{ ["--p" as string]: value, ["--c" as string]: c }}>
      <div style={{ color: c }}>{value}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error" role="alert">{error}</div> : null;
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function relDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") || iso.length <= 10 ? iso : iso.replace(" ", "T") + "Z");
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Ask before the first move into a submitted stage, since that permanently locks the documents. */
export function confirmStatusChange(a: { submitted_at: string | null; title: string; company: string }, to: Status): boolean {
  if (a.submitted_at || !SUBMITTED_STATUSES.includes(to)) return true;
  const name = [a.title, a.company].filter(Boolean).join(" at ") || "this application";
  return window.confirm(
    `Mark ${name} as "${statusLabel(to)}"?\n\nThis locks the tailored resume and cover letter for this job so they always match what you sent. ` +
      "They can't be edited or regenerated after this (you can still download them and re-assess fit).",
  );
}

export function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
