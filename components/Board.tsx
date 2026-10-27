"use client";
import Link from "next/link";
import { useState } from "react";
import { STATUSES, type ApplicationSummary, type Status } from "@/lib/types";
import { ErrorBox, LockIcon, Score, api, confirmStatusChange, relDate } from "./ui";

export default function Board({ initial }: { initial: ApplicationSummary[] }) {
  const [apps, setApps] = useState(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ status: Status; beforeId: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(id: number, status: Status, beforeId: number | null) {
    if (id === beforeId) return;
    const card = apps.find((a) => a.id === id);
    if (!card || (card.status !== status && !confirmStatusChange(card, status))) return;
    // Optimistic reorder.
    setApps((prev) => {
      const card = prev.find((a) => a.id === id);
      if (!card) return prev;
      const rest = prev.filter((a) => a.id !== id);
      const moved = { ...card, status };
      const idx = beforeId != null ? rest.findIndex((a) => a.id === beforeId) : -1;
      if (idx === -1) {
        const lastInCol = rest.map((a) => a.status).lastIndexOf(status);
        rest.splice(lastInCol + 1 || rest.length, 0, moved);
      } else rest.splice(idx, 0, moved);
      return rest;
    });
    try {
      setApps(await api<ApplicationSummary[]>(`/api/applications/${id}/move`, { method: "POST", json: { status, beforeId } }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setApps(await api<ApplicationSummary[]>("/api/applications").catch(() => initial));
    }
  }

  function onDrop(status: Status) {
    if (dragId != null) void move(dragId, status, over?.status === status ? over.beforeId : null);
    setDragId(null);
    setOver(null);
  }

  return (
    <>
      <ErrorBox error={error} />
      <div className="board">
        {STATUSES.map((col) => {
          const cards = apps.filter((a) => a.status === col.id);
          return (
            <section
              key={col.id}
              className={`column ${over?.status === col.id ? "drop" : ""}`}
              data-status={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                // Cards handle their own hover; anywhere else in the column means "append to end".
                const onEmptySpace = !(e.target as HTMLElement).closest(".kcard");
                if (onEmptySpace && (over?.status !== col.id || over.beforeId !== null)) {
                  setOver({ status: col.id, beforeId: null });
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={() => onDrop(col.id)}
              aria-label={`${col.label} column`}
            >
              <header className="column-head">
                <span className="row" style={{ gap: "0.45rem", flexWrap: "nowrap" }}>
                  <span className="status-dot" />
                  {col.label}
                </span>
                <span className="count">{cards.length}</span>
              </header>
              <div className="column-body">
                {cards.length === 0 && (
                  <div className="empty-col">
                    {col.id === "evaluating" ? <Link href="/applications/new">+ Add a job</Link> : "Drop cards here"}
                  </div>
                )}
                {cards.map((a) => (
                  <article
                    key={a.id}
                    draggable
                    className={`kcard ${dragId === a.id ? "dragging" : ""} ${
                      over?.beforeId === a.id && dragId !== a.id ? "insert-before" : ""
                    }`}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(a.id));
                      setDragId(a.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      const idx = cards.findIndex((c) => c.id === a.id);
                      const beforeId = after ? cards[idx + 1]?.id ?? null : a.id;
                      if (over?.status !== col.id || over.beforeId !== beforeId) setOver({ status: col.id, beforeId });
                    }}
                  >
                    <div className="company row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                      <span>{a.company || "Unknown company"}</span>
                      {a.submitted_at && (
                        <span className="locked-tag" title="Submitted: resume and cover letter are locked">
                          <LockIcon size={11} />
                        </span>
                      )}
                    </div>
                    <Link href={`/applications/${a.id}`} className="title" draggable={false}>
                      {a.title || "Untitled role"}
                    </Link>
                    <div className="meta">
                      <Score value={a.fit_score} />
                      <span title={a.applied_at ? `Applied ${a.applied_at}` : `Updated ${a.updated_at}`}>
                        {a.applied_at ? `applied ${relDate(a.applied_at)}` : relDate(a.updated_at)}
                      </span>
                      <select
                        aria-label="Move to column"
                        value={a.status}
                        onChange={(e) => move(a.id, e.target.value as Status, null)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
