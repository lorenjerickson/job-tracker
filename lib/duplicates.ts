// Duplicate-listing detection. Pure functions (no DB access) so they're easy to test.
import type { Status } from "./types";

export interface DupCandidate {
  job_url: string;
  company: string;
  title: string;
  jd_text: string;
}

export interface DupExisting extends DupCandidate {
  id: number;
  location: string;
  status: Status;
  fit_score: number | null;
  created_at: string;
}

export type DupStrength = "likely" | "possible" | "same_company";

export interface DuplicateMatch {
  id: number;
  company: string;
  title: string;
  location: string;
  status: Status;
  fit_score: number | null;
  created_at: string;
  strength: DupStrength;
  reasons: string[];
}

// ---------------- URLs ----------------

/** Query parameters that identify the job itself; everything else (tracking, referrers) is dropped. */
const ID_PARAMS = ["gh_jid", "jobid", "job_id", "jid", "jk", "currentjobid", "id", "req", "reqid", "requisitionid", "posting_id", "vjk", "token"];

export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "").toLowerCase();
    const keep = [...u.searchParams.entries()]
      .filter(([k]) => ID_PARAMS.includes(k.toLowerCase()))
      .map(([k, v]) => `${k.toLowerCase()}=${v}`)
      .sort();
    return `${host}${path}${keep.length ? `?${keep.join("&")}` : ""}`;
  } catch {
    return s.toLowerCase();
  }
}

/** The site a posting lives on, ignoring subdomains ("acme.wd5.myworkdayjobs.com" -> "myworkdayjobs.com"). */
function siteOf(raw: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`).hostname.toLowerCase();
    return host.split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

/**
 * Job identifiers embedded in a posting URL: Greenhouse/LinkedIn numeric ids, Lever/Ashby UUIDs,
 * Workday requisition numbers (R12345, JR-1234), Indeed "jk" keys, etc.
 */
export function urlJobIds(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  let text = s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const params = [...u.searchParams.entries()].filter(([k]) => ID_PARAMS.includes(k.toLowerCase())).map(([, v]) => v);
    text = `${decodeURIComponent(u.pathname)} ${params.join(" ")}`;
  } catch {
    /* use the raw string */
  }
  const ids = new Set<string>();
  for (const m of text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) ids.add(m[0].toLowerCase());
  for (const m of text.matchAll(/(?<![a-z0-9])(?:j?r|req)[-_]?\d{4,}(?![0-9])/gi)) ids.add(m[0].toLowerCase().replace(/[-_]/g, ""));
  for (const m of text.matchAll(/(?<![0-9a-f-])\d{6,}(?![0-9])/g)) ids.add(m[0]);
  for (const m of text.matchAll(/(?<![0-9a-z])[0-9a-f]{16}(?![0-9a-z])/gi)) ids.add(m[0].toLowerCase()); // Indeed jk
  return [...ids];
}

// ---------------- Company and title ----------------

const COMPANY_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|bv|pbc|holdings|group|technologies|technology|labs)\b\.?/g;

export function normCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, "");
}

const TITLE_WORDS: Record<string, string> = {
  sr: "senior", snr: "senior", jr: "junior", eng: "engineer", engr: "engineer", mgr: "manager", dev: "developer",
  swe: "software engineer", sde: "software engineer", ii: "2", iii: "3", iv: "4", vp: "vice president", dir: "director",
  fe: "frontend", "front-end": "frontend", "back-end": "backend", "full-stack": "fullstack", ml: "machine learning",
  ai: "artificial intelligence", ux: "user experience", ui: "user interface", pm: "product manager",
};

export function titleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // "(Remote)", "(Contract)"
    .replace(/\bfront end\b/g, "frontend")
    .replace(/\bback end\b/g, "backend")
    .replace(/\bfull stack\b/g, "fullstack")
    .split(/[^a-z0-9+#-]+/)
    .flatMap((w) => (TITLE_WORDS[w] ?? w).split(" "))
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w && !["the", "a", "an", "of", "and", "for", "to", "remote", "hybrid", "onsite"].includes(w));
}

export const normTitle = (s: string) => titleTokens(s).join(" ");

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------------- Job description text ----------------

function shingles(text: string, n = 5): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim().split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/**
 * How much two job descriptions overlap: `containment` is the share of the smaller one found in the larger
 * (high when one is a trimmed copy of the other); `jaccard` is overall overlap.
 */
export function textOverlap(a: string, b: string): { containment: number; jaccard: number } {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size < 40 || B.size < 40) return { containment: 0, jaccard: 0 };
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return { containment: inter / Math.min(A.size, B.size), jaccard: inter / (A.size + B.size - inter) };
}

// ---------------- Matching ----------------

export function findDuplicates(c: DupCandidate, existing: DupExisting[], opts: { excludeId?: number; ignore?: number[] } = {}): DuplicateMatch[] {
  const url = normalizeUrl(c.job_url);
  const ids = new Set(urlJobIds(c.job_url));
  const site = siteOf(c.job_url);
  const company = normCompany(c.company);
  const title = normTitle(c.title);
  const titleSet = new Set(titleTokens(c.title));
  const ignore = new Set(opts.ignore ?? []);
  const out: DuplicateMatch[] = [];

  for (const e of existing) {
    if (e.id === opts.excludeId || ignore.has(e.id)) continue;
    const likely: string[] = [];
    const possible: string[] = [];

    if (url && url === normalizeUrl(e.job_url)) likely.push("Same posting link");
    else if (ids.size) {
      const shared = urlJobIds(e.job_url).find((id) => ids.has(id));
      // Same site: a shared id is the same posting. Across sites (a company careers page embedding a Greenhouse
      // job, an aggregator) only long ids are distinctive enough to suggest it.
      if (shared && site && site === siteOf(e.job_url)) likely.push(`Same job ID in the link (${shared})`);
      else if (shared && (shared.length >= 7 || /[a-z]/.test(shared))) possible.push(`Same job ID in a different link (${shared})`);
    }

    const sameCompany = !!company && company === normCompany(e.company);
    if (sameCompany && title) {
      const et = normTitle(e.title);
      if (et && et === title) likely.push("Same company and job title");
      else if (et) {
        const sim = jaccard(titleSet, new Set(titleTokens(e.title)));
        if (sim >= 0.6 || (et.length > 6 && (et.includes(title) || title.includes(et)))) {
          possible.push(`Same company, similar title (“${e.title}”)`);
        }
      }
    }

    if (c.jd_text.length >= 300 && e.jd_text.length >= 300) {
      const { containment, jaccard: j } = textOverlap(c.jd_text, e.jd_text);
      const pct = Math.round(containment * 100);
      if (containment >= 0.85) likely.push(`Job description is ${pct}% the same`);
      else if (containment >= 0.6 && j >= 0.35) possible.push(`Job descriptions overlap ${pct}%`);
    }

    const strength: DupStrength | null = likely.length ? "likely" : possible.length ? "possible" : sameCompany ? "same_company" : null;
    if (!strength) continue;
    out.push({
      id: e.id,
      company: e.company,
      title: e.title,
      location: e.location,
      status: e.status,
      fit_score: e.fit_score,
      created_at: e.created_at,
      strength,
      reasons: strength === "same_company" ? ["Another application at this company"] : [...likely, ...possible],
    });
  }
  const rank: Record<DupStrength, number> = { likely: 0, possible: 1, same_company: 2 };
  return out.sort((a, b) => rank[a.strength] - rank[b.strength] || b.reasons.length - a.reasons.length || b.id - a.id);
}

export const isDuplicate = (m: DuplicateMatch) => m.strength !== "same_company";
