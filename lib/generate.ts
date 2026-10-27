import "server-only";
import { FACT_RULES, arr, bool, enm, int, jsonCall, obj, str } from "./ai";
import { computeScore, guardAssessment, guardTailored } from "./guards";
import { resumeForPrompt } from "./resume";
import type { Assessment, CoverLetter, FactWarning, ParsedResume, TailoredResume } from "./types";

export interface GenContext {
  resume: ParsedResume;
  rawText: string;
  jd: string;
  guidance: string;
}

const jdBlock = (jd: string) => `JOB DESCRIPTION:\n"""\n${jd.slice(0, 30_000)}\n"""`;
const resumeBlock = (r: ParsedResume) => `CANDIDATE RESUME (bullet ids in brackets):\n"""\n${resumeForPrompt(r)}\n"""`;
const guidanceBlock = (g: string) =>
  g.trim() ? `\nCANDIDATE'S EXTRA GUIDANCE (follow it, but the fact rules always win):\n${g.trim()}\n` : "";

// ---------------- Fit assessment ----------------

const ASSESSMENT_SCHEMA = obj({
  verdict: enm(["Excellent fit", "Strong fit", "Moderate fit", "Stretch", "Poor fit"]),
  summary: str("2-4 sentence candid overview of fit"),
  job: obj({
    company: str("Hiring company name from the JD, or empty"),
    title: str("Job title from the JD"),
    location: str("Location / remote policy from the JD, or empty"),
    hiring_manager: str("Hiring manager's name ONLY if the JD names one, else empty"),
  }),
  requirements: arr(
    obj({
      requirement: str("A single concrete requirement from the JD, concise"),
      importance: enm(["must", "nice"], "'must' for required/minimum qualifications, 'nice' for preferred/bonus"),
      match: enm(["strong", "partial", "gap"]),
      evidence: str("Short VERBATIM quote(s) from the resume proving the match, joined with ' … '. Empty for gaps."),
    }),
    "8-16 of the most important requirements",
  ),
  strengths: arr(str(), "Where the candidate clearly exceeds or strongly matches, grounded in the resume"),
  gaps: arr(str(), "Requirements not evidenced on the resume, stated plainly"),
  talking_points: arr(str(), "Interview talking points tying specific resume accomplishments to the role"),
  missing_keywords: arr(str(), "Important JD keywords/technologies that do not appear on the resume"),
});

export async function assess(ctx: GenContext): Promise<Assessment> {
  const raw = await jsonCall<Omit<Assessment, "score">>({
    name: "fit_assessment",
    schema: ASSESSMENT_SCHEMA,
    system: `You are a candid, experienced technical recruiter assessing how well a candidate fits a job.
Be honest — do not inflate. A requirement is "strong" only when the resume explicitly shows it,
"partial" when the resume shows something closely related or less depth/years than asked, "gap" otherwise.
Years of experience may be computed from the role dates on the resume.
Evidence must be quoted verbatim from the resume.
${FACT_RULES}`,
    user: `${jdBlock(ctx.jd)}\n\n${resumeBlock(ctx.resume)}`,
  });
  const a = guardAssessment({ ...raw, score: 0 }, ctx.resume, ctx.rawText);
  a.score = computeScore(a);
  return a;
}

// ---------------- Tailored resume ----------------

const TAILOR_SCHEMA = obj({
  headline: str("Headline under the name. Must be a title/role the candidate has held or their own headline, optionally with focus areas from the resume"),
  summary: str("3-4 sentence professional summary aimed at this role, using only resume facts"),
  skills: arr(
    obj({ category: str(), items: arr(str()) }),
    "Skill groups, most relevant first. Items must appear on the resume. 3-5 groups.",
  ),
  experience: arr(
    obj({
      source_index: int("The [ROLE n] index from the resume"),
      condensed: bool("true to list this role as a one-line entry with no bullets (older/less relevant roles)"),
      bullets: arr(
        obj({
          text: str("The bullet as it should appear"),
          source_ids: arr(str(), "Ids like '2.3' of the resume bullets this bullet is based on — must be from the same role"),
        }),
      ),
    }),
    "Every role from the resume exactly once, in resume order",
  ),
  notes: str("1-3 sentences for the candidate explaining what you emphasized and why"),
});

export async function tailor(ctx: GenContext, feedback?: string): Promise<{ tailored: TailoredResume; warnings: FactWarning[] }> {
  const t = await jsonCall<TailoredResume>({
    name: "tailored_resume",
    schema: TAILOR_SCHEMA,
    system: `You are an expert resume writer for senior software engineers. You tailor an existing resume
to a specific job so hiring managers and ATS systems immediately see the match.

How to tailor:
- Lead with what this job cares most about. Order bullets within each role by relevance to the job.
- Recent and relevant roles: 3-6 bullets. Mirror the job's terminology where the resume supports it.
- Start bullets with strong verbs; lead with impact/outcome where the source states one.
- Each bullet must cite the source bullet id(s) it is derived from (same role only). You may merge two
  bullets from the same role, or keep wording unchanged. Drop bullets that are irrelevant.
- Roles older than ~15 years or irrelevant to this job may be condensed (condensed=true, no bullets),
  but every role must still be listed.
- Skills: choose and group skills from the resume that matter for this job, most relevant first.
${FACT_RULES}`,
    user: `${jdBlock(ctx.jd)}\n\n${resumeBlock(ctx.resume)}${guidanceBlock(ctx.guidance)}${
      feedback ? `\nA FACT-CHECKER FLAGGED THESE PROBLEMS IN YOUR PREVIOUS DRAFT. Fix them:\n${feedback}\n` : ""
    }`,
  });
  return guardTailored(t, ctx.resume, ctx.rawText);
}

// ---------------- Cover letter ----------------

const COVER_SCHEMA = obj({
  salutation: str("e.g. 'Dear Jane Smith,' if the JD names the hiring manager, otherwise 'Dear <Company> Hiring Team,'"),
  paragraphs: arr(str(), "3-4 paragraphs"),
  signoff: str("e.g. 'Sincerely,'"),
});

export async function writeCoverLetter(
  ctx: GenContext,
  assessment: Assessment | null,
  tailored: TailoredResume | null,
  feedback?: string,
): Promise<CoverLetter> {
  return jsonCall<CoverLetter>({
    name: "cover_letter",
    schema: COVER_SCHEMA,
    system: `You write cover letters that make busy hiring managers stop skimming.

Style:
- Open with a specific hook: connect something concrete the JD says about the team, product, or
  problem to a specific, relevant accomplishment from the resume. Never open with
  "I am writing to apply/express interest" or similar.
- Middle: 2-3 concrete proof points from the resume mapped to the job's top needs. Keep resume numbers exact.
- Close: confident, brief call to action. No groveling, no clichés ("passionate", "perfect fit", "hit the ground running").
- Plain, warm, senior voice. 250-350 words total. No headers, no bullet lists, no placeholders like [Company].
- Do not mention gaps or missing qualifications. Do not mention salary.
- Do not claim personal history with, admiration for, or knowledge of the company beyond what the JD says.
- Do not include the candidate's name or contact details; they are added separately.
${FACT_RULES}`,
    user: `${jdBlock(ctx.jd)}\n\n${resumeBlock(ctx.resume)}${
      assessment
        ? `\nKEY STRENGTHS FOR THIS ROLE (from an assessment):\n- ${assessment.strengths.join("\n- ")}\nHiring manager: ${assessment.job.hiring_manager || "unknown"}; Company: ${assessment.job.company || "see JD"}\n`
        : ""
    }${tailored ? `\nTAILORED SUMMARY FOR REFERENCE:\n${tailored.summary}\n` : ""}${guidanceBlock(ctx.guidance)}${
      feedback ? `\nA FACT-CHECKER FLAGGED THESE PROBLEMS IN YOUR PREVIOUS DRAFT. Fix them:\n${feedback}\n` : ""
    }`,
  });
}

// ---------------- Independent fact check ----------------

const VERIFY_SCHEMA = obj({
  issues: arr(
    obj({
      location: str("The [ID] of the checked item"),
      claim: str("The specific unsupported phrase"),
      reason: str("Why it is not supported by the resume"),
    }),
  ),
});

type VerifyIssue = { location: string; claim: string; reason: string };

async function verify(ctx: GenContext, items: { id: string; text: string }[]): Promise<VerifyIssue[]> {
  if (!items.length) return [];
  const r = await jsonCall<{ issues: VerifyIssue[] }>({
    name: "fact_check",
    schema: VERIFY_SCHEMA,
    system: `You are a strict fact-checker. For each item, find any claim about the CANDIDATE that is not
supported by the resume: invented technologies, tools, metrics, numbers, scope, titles, employers, degrees,
years of experience that the dates don't support, or outcomes. Rewording and emphasis are fine; new facts are not.
Statements about the employer that come from the job description are fine. Generic, non-factual phrases
("I'd welcome a conversation") are fine. Only report real problems. Return an empty list if everything is supported.`,
    user: `${resumeBlock(ctx.resume)}\n\n${jdBlock(ctx.jd)}\n\nITEMS TO CHECK:\n${items.map((i) => `[${i.id}] ${i.text}`).join("\n\n")}`,
  });
  return r.issues.filter((i) => items.some((it) => it.id === i.location));
}

function itemsFor(tailored: TailoredResume | null, cover: CoverLetter | null) {
  const items: { id: string; text: string }[] = [];
  if (tailored) {
    items.push({ id: "headline", text: tailored.headline }, { id: "summary", text: tailored.summary });
    tailored.experience.forEach((r, ri) => r.bullets.forEach((b, bi) => items.push({ id: `bullet-${ri}-${bi}`, text: b.text })));
  }
  if (cover) items.push({ id: "cover", text: [cover.salutation, ...cover.paragraphs].join("\n\n") });
  return items;
}

const fmtIssues = (issues: VerifyIssue[]) => issues.map((i) => `- "${i.claim}": ${i.reason}`).join("\n");

/** Revert fact-check-flagged bullets to the original resume wording. */
function revertFlaggedBullets(t: TailoredResume, src: ParsedResume, issues: VerifyIssue[], warnings: FactWarning[]) {
  for (const issue of issues) {
    const m = issue.location.match(/^bullet-(\d+)-(\d+)$/);
    if (!m) continue;
    const role = t.experience[Number(m[1])];
    const b = role?.bullets[Number(m[2])];
    if (!role || !b) continue;
    const srcRole = src.experience[role.source_index];
    const orig = srcRole.bullets[Number(b.source_ids[0].split(".")[1])];
    warnings.push({
      where: `${srcRole.title} @ ${srcRole.company}`,
      text: b.text,
      reason: `Reverted to your original wording — fact-check: ${issue.reason}`,
    });
    role.bullets[Number(m[2])] = { text: orig, source_ids: [b.source_ids[0]] };
  }
}

export type Part = "assessment" | "resume" | "cover";

export interface GenResult {
  assessment?: Assessment;
  tailored?: TailoredResume;
  cover_letter?: CoverLetter;
  warnings: FactWarning[];
}

/**
 * Generate the requested parts, then fact-check them and self-correct once.
 * `existing` supplies parts that aren't being regenerated (for context).
 */
export async function generate(
  ctx: GenContext,
  parts: Part[],
  existing: { assessment: Assessment | null; tailored: TailoredResume | null; cover: CoverLetter | null; warnings: FactWarning[] },
): Promise<GenResult> {
  const want = new Set(parts);
  const warnings: FactWarning[] = [];

  const [assessment, tailoredRes] = await Promise.all([
    want.has("assessment") ? assess(ctx) : Promise.resolve(existing.assessment),
    want.has("resume") ? tailor(ctx) : Promise.resolve(null),
  ]);
  let tailored = tailoredRes?.tailored ?? existing.tailored;
  let tailorWarnings = tailoredRes?.warnings ?? [];
  let cover = want.has("cover") ? await writeCoverLetter(ctx, assessment, tailored) : existing.cover;

  // Fact-check only freshly generated content.
  const check = () => itemsFor(want.has("resume") ? tailored : null, want.has("cover") ? cover : null);
  let issues = await verify(ctx, check());

  const proseIssues = (prefix: string[]) => issues.filter((i) => prefix.includes(i.location));
  const resumeProse = proseIssues(["headline", "summary"]);
  const coverIssues = proseIssues(["cover"]);
  if (resumeProse.length || coverIssues.length) {
    // One self-correction round with the fact-checker's feedback.
    const [t2, c2] = await Promise.all([
      resumeProse.length ? tailor(ctx, fmtIssues(resumeProse)) : Promise.resolve(null),
      coverIssues.length ? writeCoverLetter(ctx, assessment, tailored, fmtIssues(coverIssues)) : Promise.resolve(null),
    ]);
    if (t2) ((tailored = t2.tailored), (tailorWarnings = t2.warnings));
    if (c2) cover = c2;
    issues = await verify(ctx, check());
  }

  if (want.has("resume") && tailored) {
    revertFlaggedBullets(tailored, ctx.resume, issues, tailorWarnings);
    warnings.push(...tailorWarnings);
    for (const i of issues.filter((x) => x.location === "headline" || x.location === "summary")) {
      warnings.push({ where: i.location === "headline" ? "Headline" : "Summary", text: i.claim, reason: `Please review — ${i.reason}` });
    }
  }
  if (want.has("cover")) {
    for (const i of issues.filter((x) => x.location === "cover")) {
      warnings.push({ where: "Cover letter", text: i.claim, reason: `Please review — ${i.reason}` });
    }
  }

  // Preserve warnings for parts we didn't regenerate.
  const keep = existing.warnings.filter((w) => {
    if (w.where === "Cover letter") return !want.has("cover");
    return !want.has("resume");
  });

  return {
    ...(want.has("assessment") && assessment ? { assessment } : {}),
    ...(want.has("resume") && tailored ? { tailored } : {}),
    ...(want.has("cover") && cover ? { cover_letter: cover } : {}),
    warnings: [...keep, ...warnings],
  };
}
