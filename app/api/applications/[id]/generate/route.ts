import { LockedError, addEvent, getActiveResume, getApplication, getResume, listEvents, saveGenerated } from "@/lib/db";
import { assess, generate, type GenContext, type Part } from "@/lib/generate";
import { fail, idParam, json } from "@/lib/http";
import { GENERATE_MIN_SCORE, type ResumeVersion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const DOCS: Part[] = ["resume", "cover"];

/**
 * Analysis and document generation are separate steps.
 *
 * Body: { parts: ["assessment"] }            — analyze fit (default). Always scored against your ACTIVE resume.
 *       { parts: ["resume"|"cover", ...] }   — generate documents. Requires a fit score of GENERATE_MIN_SCORE or more.
 *
 * Generating both documents (or the first one) builds from the active resume. Re-tailoring or rewriting just one keeps
 * the resume version the documents were built from, so the resume PDF and letter stay consistent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const app = getApplication(id);
    if (!app) return fail(new Error("Not found"), 404);
    const body = await req.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body.parts) ? body.parts : ["assessment"];

    const active = getActiveResume();
    if (!active?.parsed) return fail(new Error("Upload your resume first (My Resume page)."), 400);
    const ctx = (r: ResumeVersion): GenContext => ({ resume: r.parsed!, rawText: r.raw_text, jd: app.jd_text, guidance: app.guidance });

    // ---- Fit analysis ----
    if (requested.includes("assessment")) {
      if (requested.length > 1) return fail(new Error("Analyze fit first, then generate the documents as a separate step."), 400);
      const assessment = { ...(await assess(ctx(active))), previous_score: app.fit_score, resume_version: active.version };
      saveGenerated(id, {
        assessment,
        fit_score: assessment.score,
        assessment_resume_id: active.id,
        warnings: app.warnings,
        company: assessment.job.company,
        title: assessment.job.title,
        location: assessment.job.location,
      });
      if (app.fit_score != null) {
        const delta = assessment.score - app.fit_score;
        addEvent(id, "assessed", `Fit re-analyzed with resume v${active.version}: ${app.fit_score}% → ${assessment.score}% (${delta >= 0 ? "+" : ""}${delta})`);
      } else addEvent(id, "assessed", `Fit analyzed with resume v${active.version}: ${assessment.score}%`);
      return json({ ...getApplication(id), events: listEvents(id) });
    }

    // ---- Document generation ----
    const docs = DOCS.filter((p) => requested.includes(p));
    if (!docs.length) return fail(new Error("Nothing to generate."), 400);
    if (app.submitted_at) throw new LockedError();
    if (app.fit_score == null) return fail(new Error("Analyze fit before generating a resume and cover letter."), 400);
    if (app.fit_score < GENERATE_MIN_SCORE) {
      return fail(
        new Error(`Resume and cover letter generation unlocks at a fit score of ${GENERATE_MIN_SCORE}%. This job is at ${app.fit_score}%.`),
        400,
      );
    }

    const rebuild = docs.length === DOCS.length || !app.resume_id;
    const build: ResumeVersion = (!rebuild && app.resume_id && getResume(app.resume_id)) || active;
    if (!build.parsed) return fail(new Error("That resume version hasn't been parsed. Re-parse it on the My Resume page."), 400);

    const result = await generate(ctx(build), docs, {
      assessment: app.assessment,
      tailored: app.tailored,
      cover: app.cover_letter,
      warnings: app.warnings,
    });
    saveGenerated(id, {
      ...(rebuild || build.id !== app.resume_id ? { resume_id: build.id } : {}),
      tailored: result.tailored,
      cover_letter: result.cover_letter,
      warnings: result.warnings,
    });
    addEvent(id, "generated", `Generated ${docs.map((d) => (d === "resume" ? "tailored resume" : "cover letter")).join(" + ")} (resume v${build.version})`);
    return json({ ...getApplication(id), events: listEvents(id) });
  } catch (e) {
    return fail(e);
  }
}
