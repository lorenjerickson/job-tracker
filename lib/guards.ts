// Deterministic checks that catch fabricated facts in model output.
// These run after every generation, independent of the model's own promises.
import type { Assessment, FactWarning, ParsedResume, TailoredResume } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/** Numeric "cores" in a string: "$1.2M" -> "1.2", "40%" -> "40", "1,500" -> "1500". */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Every number in `candidate` must appear somewhere in `source`. Returns the offenders. */
export function unsupportedNumbers(candidate: string, source: string): string[] {
  const allowed = new Set(numbersIn(source));
  return numbersIn(candidate).filter((n) => !allowed.has(n));
}

/** True if `term` appears in `haystack` ignoring case, spacing, and punctuation (e.g. "Node.js" ~ "NodeJS"). */
export function mentions(haystack: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  const h = norm(haystack);
  if (h.includes(t)) return true;
  // tolerate a trailing "js" difference: "React" vs "React.js"
  return t.endsWith("js") ? h.includes(t.slice(0, -2)) : false;
}

/** Years from the earliest role start year to now (or the latest end year). */
export function careerSpanYears(r: ParsedResume): number {
  const years = r.experience.flatMap((e) => [e.start, e.end]).flatMap((d) => (d.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number));
  if (!years.length) return 0;
  const hasPresent = r.experience.some((e) => /present|current|now/i.test(e.end));
  const end = hasPresent ? new Date().getFullYear() : Math.max(...years);
  return end - Math.min(...years);
}

export function resumeFullText(r: ParsedResume, raw: string): string {
  return `${raw}\n${JSON.stringify(r)}`;
}

/**
 * Enforce structure and facts on a tailored resume:
 * - every role from the source appears exactly once, in a valid index
 * - bullets must cite real source bullets from the same role; numbers must match those sources
 * - skills must appear somewhere in the original resume
 */
export function guardTailored(t: TailoredResume, src: ParsedResume, raw: string): { tailored: TailoredResume; warnings: FactWarning[] } {
  const warnings: FactWarning[] = [];
  const full = resumeFullText(src, raw);
  const seen = new Set<number>();
  const experience: TailoredResume["experience"] = [];

  for (const role of t.experience) {
    const i = role.source_index;
    const srcRole = src.experience[i];
    if (!srcRole || seen.has(i)) continue;
    seen.add(i);
    const bullets: TailoredResume["experience"][number]["bullets"] = [];
    for (const b of role.bullets) {
      const ids = b.source_ids.filter((id) => {
        const [ri, bi] = id.split(".").map(Number);
        return ri === i && srcRole.bullets[bi] !== undefined;
      });
      const where = `${srcRole.title} @ ${srcRole.company}`;
      if (!ids.length) {
        warnings.push({ where, text: b.text, reason: "Removed: not traceable to a bullet in this role on your resume." });
        continue;
      }
      const sourceText = ids.map((id) => srcRole.bullets[Number(id.split(".")[1])]).join(" ");
      const badNums = unsupportedNumbers(b.text, sourceText);
      if (badNums.length) {
        const original = srcRole.bullets[Number(ids[0].split(".")[1])];
        warnings.push({
          where,
          text: b.text,
          reason: `Reverted to your original wording: number(s) ${badNums.join(", ")} not in the source bullet.`,
        });
        bullets.push({ text: original, source_ids: [ids[0]] });
      } else {
        bullets.push({ text: b.text, source_ids: ids });
      }
    }
    experience.push({ source_index: i, condensed: role.condensed, bullets: role.condensed ? [] : bullets });
  }
  // Never silently drop a role: append any the model omitted, condensed.
  src.experience.forEach((_, i) => {
    if (!seen.has(i)) experience.push({ source_index: i, condensed: true, bullets: [] });
  });
  // Keep reverse-chronological order (source order).
  experience.sort((a, b) => a.source_index - b.source_index);

  const skills = t.skills
    .map((g) => {
      const items = g.items.filter((s) => {
        const ok = mentions(full, s);
        if (!ok) warnings.push({ where: "Skills", text: s, reason: "Removed: skill not found on your resume." });
        return ok;
      });
      return { category: g.category, items };
    })
    .filter((g) => g.items.length);

  // Years-of-experience claims ("25+ years") are fine if the role dates support them.
  const span = careerSpanYears(src);
  for (const field of ["headline", "summary"] as const) {
    const bad = unsupportedNumbers(t[field], full).filter((n) => !(Number.isInteger(Number(n)) && Number(n) > 0 && Number(n) <= span));
    if (bad.length) {
      warnings.push({ where: field === "headline" ? "Headline" : "Summary", text: t[field], reason: `Contains number(s) not on your resume: ${bad.join(", ")}. Please review.` });
    }
  }

  return { tailored: { ...t, experience, skills }, warnings };
}

/** Mark whether each assessment evidence quote is actually traceable to the resume. */
export function guardAssessment(a: Assessment, src: ParsedResume, raw: string): Assessment {
  const full = norm(resumeFullText(src, raw));
  return {
    ...a,
    requirements: a.requirements.map((r) => {
      if (r.match === "gap" || !r.evidence.trim()) return { ...r, evidence_verified: r.match === "gap" };
      // Evidence quotes may be joined with "…" or "; " — each fragment should be on the resume.
      const parts = r.evidence.split(/…|\.\.\.|;|"|“|”/).map(norm).filter((p) => p.length > 8);
      const verified = parts.length > 0 && parts.every((p) => full.includes(p));
      return { ...r, evidence_verified: verified };
    }),
  };
}

/** Deterministic fit score: must-haves count double; partial = half credit. */
export function computeScore(a: Assessment): number {
  let total = 0;
  let got = 0;
  for (const r of a.requirements) {
    const w = r.importance === "must" ? 2 : 1;
    total += w;
    got += w * (r.match === "strong" ? 1 : r.match === "partial" ? 0.5 : 0);
  }
  return total ? Math.round((got / total) * 100) : 0;
}
