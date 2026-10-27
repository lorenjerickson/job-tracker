import { insertResume, listResumes } from "@/lib/db";
import { fail, json } from "@/lib/http";
import { MIME, detectResumeKind, extractResumeText, parseResumeText } from "@/lib/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(listResumes());
}

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(new Error("No file uploaded."), 400);
    if (file.size > MAX_BYTES) return fail(new Error("File is larger than 10 MB."), 400);
    const buf = Buffer.from(await file.arrayBuffer());

    const kind = detectResumeKind(buf, file.name);
    if (kind === "doc") {
      return fail(new Error("That's an older Word .doc file. In Word, use File → Save As → Word Document (.docx), then upload it."), 400);
    }
    if (!kind) return fail(new Error("Please upload a PDF or Word (.docx) file."), 400);

    const text = await extractResumeText(buf, kind);
    if (text.length < 200) {
      return fail(
        new Error(
          kind === "pdf"
            ? "Couldn't extract text from this PDF. If it's a scanned image, export a text-based PDF or upload the Word file instead."
            : "Couldn't find enough text in this Word file. If your resume is built from text boxes or images, try exporting it to PDF.",
        ),
        400,
      );
    }
    const parsed = await parseResumeText(text);
    const id = insertResume(file.name || `resume.${kind}`, MIME[kind], buf, text, parsed);
    return json({ id });
  } catch (e) {
    return fail(e);
  }
}
