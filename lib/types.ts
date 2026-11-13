// Shared types used by both the server and the client.

export interface ParsedResume {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string; links: string[] };
  summary: string;
  skills: { category: string; items: string[] }[];
  experience: {
    company: string;
    title: string;
    location: string;
    start: string;
    end: string;
    bullets: string[];
  }[];
  education: { institution: string; degree: string; details: string; year: string }[];
  certifications: string[];
  other: { heading: string; items: string[] }[];
}

export interface TailoredBullet {
  text: string;
  /** Ids ("roleIndex.bulletIndex") of the original resume bullets this was derived from. */
  source_ids: string[];
}

export interface TailoredRole {
  source_index: number;
  /** Condensed roles are listed without bullets under "Earlier Experience". */
  condensed: boolean;
  /** Hidden roles are left off the PDF entirely (user-controlled). */
  hidden?: boolean;
  bullets: TailoredBullet[];
}

export interface TailoredResume {
  headline: string;
  summary: string;
  skills: { category: string; items: string[] }[];
  experience: TailoredRole[];
  notes: string;
}

export type MatchLevel = "strong" | "partial" | "gap";

export interface Assessment {
  score: number;
  /** Score from the previous assessment, kept so a re-assessment can show the change. */
  previous_score?: number | null;
  /** Resume version this assessment was scored against. */
  resume_version?: number;
  verdict: string;
  summary: string;
  job: { company: string; title: string; location: string; hiring_manager: string };
  requirements: {
    requirement: string;
    importance: "must" | "nice";
    match: MatchLevel;
    evidence: string;
    evidence_verified?: boolean;
    /** For partial/gap matches: a question meant to draw out relevant experience the resume may not mention. */
    probe?: string;
  }[];
  strengths: string[];
  gaps: string[];
  talking_points: string[];
  missing_keywords: string[];
}

export interface CoverLetter {
  salutation: string;
  paragraphs: string[];
  signoff: string;
}

export interface FactWarning {
  where: string;
  text: string;
  reason: string;
}

/** Tailored resume and cover letter generation is only offered at or above this fit score. */
export const GENERATE_MIN_SCORE = 75;

/**
 * A factual clarification the candidate wrote for a "partial" or "gap" requirement in a fit assessment.
 * Once added to the base resume, applied_version records the resume version it went into.
 */
export interface Clarification {
  id: string;
  requirement: string;
  match: "partial" | "gap";
  text: string;
  applied_version: number | null;
  created_at: string;
}

/** A proposed change to the base resume, drafted from a clarification and reviewed by the candidate. */
export interface ResumeAddition {
  clarification_id: string;
  kind: "bullet" | "skill" | "certification" | "other";
  /** kind=bullet: index into ParsedResume.experience. -1 otherwise. */
  role_index: number;
  /** kind=skill: skill category. kind=other: section heading. Empty otherwise. */
  section: string;
  text: string;
  /** Anything the candidate should double-check (role placement guess, unverified number…). */
  note: string;
}

// Internal ids are kept stable across label changes (Nov 2026: Submitted → Applied, Under Consideration → Contact,
// Rejected → Unsuccessful; Accepted removed and its cards moved to Offer by migration 5).
export const STATUSES = [
  { id: "evaluating", label: "Evaluating" },
  { id: "submitted", label: "Applied" },
  { id: "under_consideration", label: "Contact" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Unsuccessful" },
] as const;

export type Status = (typeof STATUSES)[number]["id"];

/**
 * Entering any of these means the application has gone out. The tailored resume and cover letter
 * are locked at that point and stay locked, even if the card is moved back later.
 * ("rejected" — shown as Unsuccessful — is not here because you can reject a job yourself while still evaluating it.)
 */
export const SUBMITTED_STATUSES: readonly Status[] = ["submitted", "under_consideration", "interviewing", "offer"];

/** Applications that are no longer in play. */
export const FINAL_STATUSES: readonly Status[] = ["rejected"];

export const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;

export interface ApplicationSummary {
  id: number;
  company: string;
  title: string;
  location: string;
  status: Status;
  position: number;
  fit_score: number | null;
  /** Resume version the fit assessment was scored against (can be newer than resume_id). */
  assessment_resume_id: number | null;
  applied_at: string | null;
  /** Set the first time the application is marked submitted. Once set, the resume and cover letter are locked. */
  submitted_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface Application extends ApplicationSummary {
  job_url: string;
  jd_text: string;
  guidance: string;
  notes: string;
  /** Resume version the tailored resume and cover letter were built from. */
  resume_id: number | null;
  assessment: Assessment | null;
  tailored: TailoredResume | null;
  cover_letter: CoverLetter | null;
  warnings: FactWarning[];
  /** Factual clarifications written against this job's fit assessment. */
  clarifications: Clarification[];
  /** True when a frozen copy of the submitted resume / cover letter PDF is stored. */
  has_resume_snapshot: boolean;
  has_cover_snapshot: boolean;
  generated_at: string | null;
}

export interface ResumeVersion {
  id: number;
  version: number;
  filename: string;
  mime: string;
  is_active: boolean;
  created_at: string;
  parsed: ParsedResume | null;
  raw_text: string;
  /** Rich-text body for the editor. */
  html: string;
}

export interface AppEvent {
  id: number;
  type: string;
  detail: string;
  created_at: string;
}
