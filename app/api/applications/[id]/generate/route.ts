import { LockedError, addEvent, getActiveResume, getApplication, getResume, listEvents, saveGenerated } from "@/lib/db";
import { assess, generate, type GenContext, type Part } from "@/lib/generate";
import { fail, idParam, json } from "@/lib/http";
import type { Assessment, ResumeVersion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALL: Part[] = ["assessment", "resume", "cover"];

/**
 * Body: { parts?: Part[] }  (default: all)
 *
 * - The fit assessment is always scored against your ACTIVE resume, so re-assessing after uploading
 *   a new version shows how the new resume stacks up.
 * - Re-tailoring / rewriting the letter alone keeps the resume version they were originally built from
 *   (so the resume PDF and letter stay consistent). "All" rebuilds everything from the active resume.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const app = getApplication(id);
    if (!app) return fail(new Error("Not found"), 404);
    const body = await req.json().catch(() => ({}));
    const parts: Part[] = Array.isArray(body.parts) ? ALL.filter((p) => body.parts.includes(p)) : ALL;
    if (!parts.length) return fail(new Error("Nothing to generate."), 400);
    // After submission only the fit assessment can be refreshed; the documents stay as sent.
    if (app.submitted_at && parts.some((p) => p !== "assessment")) throw new LockedError();
    const full = parts.length === ALL.length;

    const active = getActiveResume();
    if (!active?.parsed) return fail(new Error("Upload your resume first (My Resume page)."), 400);
    const build: ResumeVersion = (!full && app.resume_id && getResume(app.resume_id)) || active;
    if (!build.parsed) return fail(new Error("That resume version hasn't been parsed. Re-parse it on the My Resume page."), 400);

    const ctx = (r: ResumeVersion): GenContext => ({ resume: r.parsed!, rawText: r.raw_text, jd: app.jd_text, guidance: app.guidance });
    const stamp = (a: Assessment): Assessment => ({ ...a, previous_score: app.fit_score, resume_version: active.version });

    let assessment: Assessment | undefined;
    let rest: Part[] = parts;
    if (parts.includes("assessment") && build.id !== active.id) {
      // Partial regeneration on an older build: score against the active resume separately.
      assessment = stamp(await assess(ctx(active)));
      rest = parts.filter((p) => p !== "assessment");
    }

    const result = rest.length
      ? await generate(ctx(build), rest, {
          assessment: assessment ?? app.assessment,
          tailored: app.tailored,
          cover: app.cover_letter,
          warnings: app.warnings,
        })
      : { warnings: app.warnings };
    if ("assessment" in result && result.assessment) assessment = stamp(result.assessment);

    const builtDocs = rest.includes("resume") || rest.includes("cover");
    saveGenerated(id, {
      ...(builtDocs || !app.resume_id ? { resume_id: build.id } : {}),
      ...(assessment ? { assessment, fit_score: assessment.score, assessment_resume_id: active.id } : {}),
      tailored: "tailored" in result ? result.tailored : undefined,
      cover_letter: "cover_letter" in result ? result.cover_letter : undefined,
      warnings: result.warnings,
      company: assessment?.job.company,
      title: assessment?.job.title,
      location: assessment?.job.location,
    });

    if (assessment && !full && app.fit_score != null) {
      const delta = assessment.score - app.fit_score;
      addEvent(id, "assessed", `Fit re-assessed with resume v${active.version}: ${app.fit_score}% → ${assessment.score}% (${delta >= 0 ? "+" : ""}${delta})`);
    }
    const docs = rest.filter((p) => p !== "assessment");
    if (docs.length || full) addEvent(id, "generated", `Generated ${(full ? parts : docs).join(", ")} (resume v${build.version})`);
    else if (app.fit_score == null && assessment) addEvent(id, "assessed", `Fit assessed with resume v${active.version}: ${assessment.score}%`);

    return json({ ...getApplication(id), events: listEvents(id) });
  } catch (e) {
    return fail(e);
  }
}
