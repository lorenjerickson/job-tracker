import { getResume, insertResume } from "@/lib/db";
import { fail, json } from "@/lib/http";
import { htmlToText } from "@/lib/jobfetch";
import { MIME, parseResumeText, sanitizeResumeHtml } from "@/lib/resume";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Save the rich-text editor's content as a NEW resume version — handled exactly like an upload:
 * text is extracted, parsed into structured data, stored as the next version, and made active.
 * Body: { html: string, baseId?: number }
 */
export async function POST(req: Request) {
  try {
    const { html, baseId } = (await req.json()) as { html?: unknown; baseId?: unknown };
    if (typeof html !== "string" || !html.trim()) return fail(new Error("The resume is empty."), 400);
    if (html.length > 500_000) return fail(new Error("The resume is too long."), 400);

    const clean = sanitizeResumeHtml(html);
    const text = htmlToText(clean);
    if (text.length < 200) return fail(new Error("There isn't enough text to save as a resume."), 400);

    const base = typeof baseId === "number" ? getResume(baseId) : null;
    const parsed = await parseResumeText(text);
    const filename = `Edited in app${base ? ` (from v${base.version})` : ""}.html`;
    const id = insertResume(filename, MIME.html, Buffer.from(clean, "utf8"), text, parsed, clean);
    return json({ id });
  } catch (e) {
    return fail(e);
  }
}
