import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  AppEvent,
  Application,
  ApplicationSummary,
  ParsedResume,
  ResumeVersion,
  Status,
} from "./types";
import { STATUSES, SUBMITTED_STATUSES, statusLabel } from "./types";

/** Thrown when something tries to change the documents of an application that has been submitted. */
export class LockedError extends Error {
  constructor(what = "The tailored resume and cover letter") {
    super(`${what} can't be changed: this application has been submitted, so they're locked to match what you sent.`);
  }
}

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "job-tracker.db");

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      filename TEXT NOT NULL,
      pdf BLOB NOT NULL,
      raw_text TEXT NOT NULL,
      parsed_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_url TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      jd_text TEXT NOT NULL DEFAULT '',
      guidance TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'evaluating',
      position REAL NOT NULL DEFAULT 0,
      fit_score INTEGER,
      assessment_json TEXT,
      tailored_json TEXT,
      cover_letter_json TEXT,
      warnings_json TEXT,
      resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      applied_at TEXT,
      generated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_app ON events(application_id);
  `);
  // Additive migrations for databases created by earlier versions of the app.
  const addColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn("resumes", "mime", "TEXT NOT NULL DEFAULT 'application/pdf'");
  addColumn("applications", "assessment_resume_id", "INTEGER REFERENCES resumes(id) ON DELETE SET NULL");
  // Earlier versions assessed against the same resume used for tailoring.
  db.exec("UPDATE applications SET assessment_resume_id = resume_id WHERE assessment_resume_id IS NULL AND assessment_json IS NOT NULL");
  // Submission lock + frozen copies of exactly what was sent.
  addColumn("applications", "submitted_at", "TEXT");
  addColumn("applications", "resume_pdf", "BLOB");
  addColumn("applications", "cover_pdf", "BLOB");
  // Map the original board columns onto the new status pipeline. Anything that had already gone out is locked.
  db.exec(`
    UPDATE applications SET status = CASE status
      WHEN 'saved' THEN 'evaluating'
      WHEN 'applied' THEN 'submitted'
      WHEN 'screening' THEN 'under_consideration'
      WHEN 'closed' THEN 'rejected'
      ELSE status END
    WHERE status IN ('saved', 'applied', 'screening', 'closed');
    UPDATE applications SET submitted_at = COALESCE(applied_at, updated_at)
    WHERE submitted_at IS NULL
      AND (status IN ('submitted', 'under_consideration', 'interviewing', 'offer', 'accepted')
           OR (status = 'rejected' AND applied_at IS NOT NULL));
  `);
  return db;
}

// Reuse one connection across hot reloads in dev.
const g = globalThis as unknown as { __jobTrackerDb?: Database.Database };
export const db = g.__jobTrackerDb ?? (g.__jobTrackerDb = open());

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

// ---------- Resumes ----------

type ResumeRow = {
  id: number;
  version: number;
  filename: string;
  mime: string;
  raw_text: string;
  parsed_json: string | null;
  is_active: number;
  created_at: string;
};

const toResume = (r: ResumeRow): ResumeVersion => ({
  id: r.id,
  version: r.version,
  filename: r.filename,
  mime: r.mime,
  is_active: !!r.is_active,
  created_at: r.created_at,
  raw_text: r.raw_text,
  parsed: parse<ParsedResume>(r.parsed_json),
});

const RESUME_COLS = "id, version, filename, mime, raw_text, parsed_json, is_active, created_at";

export function listResumes(): ResumeVersion[] {
  return (db.prepare(`SELECT ${RESUME_COLS} FROM resumes ORDER BY version DESC`).all() as ResumeRow[]).map(toResume);
}

export function getResume(id: number): ResumeVersion | null {
  const r = db.prepare(`SELECT ${RESUME_COLS} FROM resumes WHERE id = ?`).get(id) as ResumeRow | undefined;
  return r ? toResume(r) : null;
}

export function getActiveResume(): ResumeVersion | null {
  const r = db.prepare(`SELECT ${RESUME_COLS} FROM resumes WHERE is_active = 1 LIMIT 1`).get() as ResumeRow | undefined;
  return r ? toResume(r) : null;
}

/** The originally uploaded file (PDF or Word). */
export function getResumeFile(id: number): { filename: string; mime: string; data: Buffer } | null {
  return (
    (db.prepare("SELECT filename, mime, pdf AS data FROM resumes WHERE id = ?").get(id) as {
      filename: string;
      mime: string;
      data: Buffer;
    }) ?? null
  );
}

export const insertResume = db.transaction(
  (filename: string, mime: string, file: Buffer, rawText: string, parsed: ParsedResume | null): number => {
    const { v } = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM resumes").get() as { v: number };
    db.prepare("UPDATE resumes SET is_active = 0").run();
    const info = db
      .prepare("INSERT INTO resumes (version, filename, mime, pdf, raw_text, parsed_json, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)")
      .run(v, filename, mime, file, rawText, parsed ? JSON.stringify(parsed) : null);
    return Number(info.lastInsertRowid);
  },
);

export function updateResumeParsed(id: number, parsed: ParsedResume) {
  db.prepare("UPDATE resumes SET parsed_json = ? WHERE id = ?").run(JSON.stringify(parsed), id);
}

export const activateResume = db.transaction((id: number) => {
  db.prepare("UPDATE resumes SET is_active = 0").run();
  db.prepare("UPDATE resumes SET is_active = 1 WHERE id = ?").run(id);
});

export const deleteResume = db.transaction((id: number) => {
  const wasActive = (db.prepare("SELECT is_active FROM resumes WHERE id = ?").get(id) as { is_active: number } | undefined)?.is_active;
  db.prepare("DELETE FROM resumes WHERE id = ?").run(id);
  if (wasActive) {
    db.prepare("UPDATE resumes SET is_active = 1 WHERE id = (SELECT id FROM resumes ORDER BY version DESC LIMIT 1)").run();
  }
});

// ---------- Applications ----------

type AppRow = {
  id: number;
  job_url: string;
  company: string;
  title: string;
  location: string;
  jd_text: string;
  guidance: string;
  status: Status;
  position: number;
  fit_score: number | null;
  assessment_json: string | null;
  tailored_json: string | null;
  cover_letter_json: string | null;
  warnings_json: string | null;
  resume_id: number | null;
  assessment_resume_id: number | null;
  notes: string;
  applied_at: string | null;
  submitted_at: string | null;
  has_resume_snapshot: number;
  has_cover_snapshot: number;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

const toApp = (r: AppRow): Application => ({
  id: r.id,
  job_url: r.job_url,
  company: r.company,
  title: r.title,
  location: r.location,
  jd_text: r.jd_text,
  guidance: r.guidance,
  status: r.status,
  position: r.position,
  fit_score: r.fit_score,
  resume_id: r.resume_id,
  assessment_resume_id: r.assessment_resume_id,
  notes: r.notes,
  applied_at: r.applied_at,
  submitted_at: r.submitted_at,
  has_resume_snapshot: !!r.has_resume_snapshot,
  has_cover_snapshot: !!r.has_cover_snapshot,
  generated_at: r.generated_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
  assessment: parse(r.assessment_json),
  tailored: parse(r.tailored_json),
  cover_letter: parse(r.cover_letter_json),
  warnings: parse(r.warnings_json) ?? [],
});

export function listApplications(): ApplicationSummary[] {
  return db
    .prepare(
      "SELECT id, company, title, location, status, position, fit_score, assessment_resume_id, applied_at, submitted_at, updated_at, created_at FROM applications ORDER BY position ASC, id ASC",
    )
    .all() as ApplicationSummary[];
}

export function getApplication(id: number): Application | null {
  const r = db
    .prepare(
      `SELECT *, resume_pdf IS NOT NULL AS has_resume_snapshot, cover_pdf IS NOT NULL AS has_cover_snapshot
       FROM applications WHERE id = ?`,
    )
    .get(id) as AppRow | undefined;
  return r ? toApp(r) : null;
}

export function isLocked(id: number): boolean {
  const r = db.prepare("SELECT submitted_at FROM applications WHERE id = ?").get(id) as { submitted_at: string | null } | undefined;
  return !!r?.submitted_at;
}

export function submittedAppsUsingResume(resumeId: number): number[] {
  return (db.prepare("SELECT id FROM applications WHERE resume_id = ? AND submitted_at IS NOT NULL").all(resumeId) as { id: number }[]).map(
    (r) => r.id,
  );
}

export type SnapshotKind = "resume" | "cover";
const SNAP_COL: Record<SnapshotKind, string> = { resume: "resume_pdf", cover: "cover_pdf" };

/** Frozen PDF of what was submitted (stored the first time it's rendered after submission). */
export function getSnapshot(id: number, kind: SnapshotKind): Buffer | null {
  const r = db.prepare(`SELECT ${SNAP_COL[kind]} AS pdf FROM applications WHERE id = ?`).get(id) as { pdf: Buffer | null } | undefined;
  return r?.pdf ?? null;
}

export function saveSnapshot(id: number, kind: SnapshotKind, pdf: Buffer) {
  // Never overwrite an existing snapshot.
  db.prepare(`UPDATE applications SET ${SNAP_COL[kind]} = ? WHERE id = ? AND ${SNAP_COL[kind]} IS NULL`).run(pdf, id);
}

export function createApplication(input: {
  job_url: string;
  company: string;
  title: string;
  location: string;
  jd_text: string;
  guidance: string;
}): number {
  const { p } = db.prepare("SELECT COALESCE(MIN(position), 1) - 1 AS p FROM applications WHERE status = 'evaluating'").get() as { p: number };
  const info = db
    .prepare(
      "INSERT INTO applications (job_url, company, title, location, jd_text, guidance, position, status) VALUES (@job_url, @company, @title, @location, @jd_text, @guidance, @p, 'evaluating')",
    )
    .run({ ...input, p });
  const id = Number(info.lastInsertRowid);
  addEvent(id, "created", "Application created");
  return id;
}

const EDITABLE = new Set(["job_url", "company", "title", "location", "jd_text", "guidance", "notes", "applied_at"]);

export function updateApplication(id: number, fields: Record<string, unknown>) {
  const sets: string[] = [];
  const vals: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(fields)) {
    if (EDITABLE.has(k) && (typeof v === "string" || v === null)) {
      sets.push(`${k} = @${k}`);
      vals[k] = v;
    }
  }
  if (("tailored" in fields || "cover_letter" in fields) && isLocked(id)) throw new LockedError();
  if ("tailored" in fields) {
    sets.push("tailored_json = @tailored_json");
    vals.tailored_json = JSON.stringify(fields.tailored);
  }
  if ("cover_letter" in fields) {
    sets.push("cover_letter_json = @cover_letter_json");
    vals.cover_letter_json = JSON.stringify(fields.cover_letter);
  }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE applications SET ${sets.join(", ")} WHERE id = @id`).run(vals);
}

export function saveGenerated(
  id: number,
  data: {
    resume_id?: number;
    assessment_resume_id?: number;
    assessment?: unknown;
    fit_score?: number;
    tailored?: unknown;
    cover_letter?: unknown;
    warnings: unknown;
    company?: string;
    title?: string;
    location?: string;
  },
) {
  if ((data.tailored !== undefined || data.cover_letter !== undefined) && isLocked(id)) throw new LockedError();
  const sets = ["warnings_json = @warnings_json", "generated_at = datetime('now')", "updated_at = datetime('now')"];
  const vals: Record<string, unknown> = { id, warnings_json: JSON.stringify(data.warnings) };
  if (data.resume_id !== undefined) (sets.push("resume_id = @resume_id"), (vals.resume_id = data.resume_id));
  if (data.assessment_resume_id !== undefined)
    (sets.push("assessment_resume_id = @assessment_resume_id"), (vals.assessment_resume_id = data.assessment_resume_id));
  if (data.assessment !== undefined) {
    sets.push("assessment_json = @assessment_json", "fit_score = @fit_score");
    vals.assessment_json = JSON.stringify(data.assessment);
    vals.fit_score = data.fit_score ?? null;
  }
  if (data.tailored !== undefined) (sets.push("tailored_json = @tailored_json"), (vals.tailored_json = JSON.stringify(data.tailored)));
  if (data.cover_letter !== undefined)
    (sets.push("cover_letter_json = @cover_letter_json"), (vals.cover_letter_json = JSON.stringify(data.cover_letter)));
  // Only fill in job metadata the user hasn't already set.
  for (const k of ["company", "title", "location"] as const) {
    if (data[k]) {
      sets.push(`${k} = CASE WHEN ${k} = '' THEN @${k} ELSE ${k} END`);
      vals[k] = data[k];
    }
  }
  db.prepare(`UPDATE applications SET ${sets.join(", ")} WHERE id = @id`).run(vals);
}

/** Move a card to a column, placing it before `beforeId` (or at the end). */
export const moveApplication = db.transaction((id: number, status: Status, beforeId: number | null) => {
  if (!STATUSES.some((s) => s.id === status)) throw new Error("Invalid status");
  const current = db.prepare("SELECT status, applied_at, submitted_at FROM applications WHERE id = ?").get(id) as
    | { status: Status; applied_at: string | null; submitted_at: string | null }
    | undefined;
  if (!current) throw new Error("Not found");

  const ids = (db.prepare("SELECT id FROM applications WHERE status = ? AND id != ? ORDER BY position, id").all(status, id) as {
    id: number;
  }[]).map((r) => r.id);
  const idx = beforeId != null ? ids.indexOf(beforeId) : -1;
  ids.splice(idx === -1 ? ids.length : idx, 0, id);
  const upd = db.prepare("UPDATE applications SET position = ? WHERE id = ?");
  ids.forEach((appId, i) => upd.run(i, appId));

  if (current.status !== status) {
    db.prepare("UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    addEvent(id, "status", `${statusLabel(current.status)} → ${statusLabel(status)}`);
    if (SUBMITTED_STATUSES.includes(status)) {
      if (!current.applied_at) db.prepare("UPDATE applications SET applied_at = date('now') WHERE id = ?").run(id);
      if (!current.submitted_at) {
        db.prepare("UPDATE applications SET submitted_at = datetime('now') WHERE id = ?").run(id);
        addEvent(id, "locked", "Submitted — tailored resume and cover letter locked");
      }
    }
  }
});

export function deleteApplication(id: number) {
  db.prepare("DELETE FROM applications WHERE id = ?").run(id);
}

export function addEvent(applicationId: number, type: string, detail: string) {
  db.prepare("INSERT INTO events (application_id, type, detail) VALUES (?, ?, ?)").run(applicationId, type, detail);
}

export function listEvents(applicationId: number): AppEvent[] {
  return db
    .prepare("SELECT id, type, detail, created_at FROM events WHERE application_id = ? ORDER BY id DESC")
    .all(applicationId) as AppEvent[];
}
