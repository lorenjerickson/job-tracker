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

export const STATUSES = [
  { id: "evaluating", label: "Evaluating" },
  { id: "submitted", label: "Submitted" },
  { id: "under_consideration", label: "Under Consideration" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
] as const;

export type Status = (typeof STATUSES)[number]["id"];

/**
 * Entering any of these means the application has gone out. The tailored resume and cover letter
 * are locked at that point and stay locked, even if the card is moved back later.
 * ("rejected" is not here because you can reject a job yourself while still evaluating it.)
 */
export const SUBMITTED_STATUSES: readonly Status[] = ["submitted", "under_consideration", "interviewing", "offer", "accepted"];

/** Applications that are no longer in play. */
export const FINAL_STATUSES: readonly Status[] = ["accepted", "rejected"];

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
}

export interface AppEvent {
  id: number;
  type: string;
  detail: string;
  created_at: string;
}
