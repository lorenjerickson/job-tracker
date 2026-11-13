import { getActiveResume, getApplication } from "@/lib/db";
import { draftAdditions } from "@/lib/clarify";
import { fail, idParam, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Draft resume additions from this application's unapplied clarifications (nothing is saved).
 * Body: { ids?: string[] }  (default: every unapplied clarification with text)
 * Returns the proposals plus the active resume's roles, for review before anything touches the resume.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const app = getApplication(id);
    if (!app) return fail(new Error("Not found"), 404);
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? new Set(body.ids.filter((x): x is string => typeof x === "string")) : null;
    const items = app.clarifications.filter((c) => c.applied_version == null && c.text.trim() && (!ids || ids.has(c.id)));
    if (!items.length) return fail(new Error("Write at least one clarification first."), 400);

    const active = getActiveResume();
    if (!active?.parsed) return fail(new Error("Upload your resume first (My Resume page)."), 400);

    const additions = await draftAdditions(active.parsed, active.raw_text, app.jd_text, items);
    return json({
      base_id: active.id,
      base_version: active.version,
      clarification_ids: items.map((c) => c.id),
      roles: active.parsed.experience.map((e) => ({ title: e.title, company: e.company, start: e.start, end: e.end })),
      skill_categories: active.parsed.skills.map((s) => s.category),
      additions,
    });
  } catch (e) {
    return fail(e);
  }
}
