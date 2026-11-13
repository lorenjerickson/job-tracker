"use client";
import Link from "next/link";
import type { DuplicateMatch } from "@/lib/duplicates";
import { STATUSES } from "@/lib/types";
import { Score, relDate } from "./ui";

/** Existing applications that look like the same job, with the reasons. */
export function DuplicateList({ matches, onDismiss }: { matches: DuplicateMatch[]; onDismiss?: (id: number) => void }) {
  return (
    <ul className="dup-list">
      {matches.map((m) => (
        <li key={m.id} className="dup-item">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div>
              <Link href={`/applications/${m.id}`} target="_blank" rel="noreferrer">
                <b>{m.title || "Untitled role"}</b>
              </Link>
              <span className="subtle"> · {[m.company || "Unknown company", m.location].filter(Boolean).join(" · ")}</span>
              <div className="row small" style={{ gap: "0.4rem", marginTop: "0.2rem" }}>
                <span className={`badge ${m.strength === "likely" ? "bad" : m.strength === "possible" ? "warn" : ""}`}>
                  {m.strength === "likely" ? "Likely duplicate" : m.strength === "possible" ? "Possible duplicate" : "Same company"}
                </span>
                <span className="status-pill" data-status={m.status}>
                  <span className="status-dot" />
                  {STATUSES.find((s) => s.id === m.status)?.label ?? m.status}
                </span>
                {m.fit_score != null && <Score value={m.fit_score} />}
                <span className="muted">added {relDate(m.created_at)}</span>
              </div>
            </div>
            {onDismiss && (
              <button className="btn sm ghost" onClick={() => onDismiss(m.id)} title="Stop flagging these two as duplicates">
                Not a duplicate
              </button>
            )}
          </div>
          {m.strength !== "same_company" && (
            <ul className="dup-reasons">
              {m.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
