import { getResume, updateResumeParsed } from "@/lib/db";
import { fail, idParam, json } from "@/lib/http";
import { parseResumeText } from "@/lib/resume";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const r = getResume(id);
    if (!r) return fail(new Error("Not found"), 404);
    updateResumeParsed(id, await parseResumeText(r.raw_text));
    return json(getResume(id));
  } catch (e) {
    return fail(e);
  }
}
