import { addEvent, getActiveResume, getApplication, getResume, insertResume, listEvents, setClarifications } from "@/lib/db";
import { applyAdditions, cleanAdditions } from "@/lib/clarify";
import { fail, idParam, json } from "@/lib/http";
import { MIME } from "@/lib/resume";

export const runtime = "nodejs";

/**
 * Add reviewed additions to the base resume as a NEW version (which becomes active), and mark the
 * clarifications as applied. Body: { base_id: number, clarification_ids: string[], additions: ResumeAddition[] }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const app = getApplication(id);
    if (!app) return fail(new Error("Not found"), 404);
    const body = (await req.json()) as { base_id?: unknown; clarification_ids?: unknown; additions?: unknown };

    const active = getActiveResume();
    if (!active?.parsed) return fail(new Error("Upload your resume first (My Resume page)."), 400);
    if (body.base_id !== active.id) {
      return fail(new Error("Your active resume changed since these additions were drafted. Review them again."), 409);
    }
    const additions = cleanAdditions(body.additions, active.parsed);
    if (!additions.length) return fail(new Error("There's nothing to add."), 400);
    const ids = new Set(Array.isArray(body.clarification_ids) ? body.clarification_ids.filter((x) => typeof x === "string") : []);

    const result = applyAdditions(active, additions);
    const label = [app.company, app.title].filter(Boolean).join(" — ") || `application ${id}`;
    const filename = `Clarified for ${label} (from v${active.version}).html`.replace(/[\\/:*?"<>|]/g, "-");
    const newId = insertResume(filename, MIME.html, Buffer.from(result.html, "utf8"), result.text, result.parsed, result.html);
    const version = getResume(newId)!.version;

    setClarifications(
      id,
      app.clarifications.map((c) => (ids.has(c.id) && c.applied_version == null && c.text.trim() ? { ...c, applied_version: version } : c)),
    );
    addEvent(id, "clarified", `Added ${additions.length} item${additions.length === 1 ? "" : "s"} from your clarifications to the base resume → v${version}`);

    return json({ ...getApplication(id), events: listEvents(id), new_version: version, rebuilt: result.rebuilt });
  } catch (e) {
    return fail(e, 400);
  }
}
