import { activateResume, deleteResume, getResume, submittedAppsUsingResume, updateResumeParsed } from "@/lib/db";
import { freezeDocuments } from "@/lib/documents";
import { fail, idParam, json } from "@/lib/http";
import type { ParsedResume } from "@/lib/types";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const r = getResume(await idParam(params));
    return r ? json(r) : fail(new Error("Not found"), 404);
  } catch (e) {
    return fail(e, 400);
  }
}

/** Body: { activate: true } or { parsed: ParsedResume } (manual corrections to the parsed data). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = await idParam(params);
    if (!getResume(id)) return fail(new Error("Not found"), 404);
    const body = await req.json();
    if (body.activate) activateResume(id);
    if (body.parsed) {
      const p = body.parsed as ParsedResume;
      if (!p || typeof p.name !== "string" || !Array.isArray(p.experience)) throw new Error("Parsed resume is missing required fields.");
      updateResumeParsed(id, p);
    }
    return json(getResume(id));
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const id = await idParam(params);
    // Submitted applications built from this version keep a frozen copy of what was sent.
    for (const appId of submittedAppsUsingResume(id)) await freezeDocuments(appId);
    deleteResume(id);
    return json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}
