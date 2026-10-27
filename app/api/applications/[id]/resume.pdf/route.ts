import { getApplication, getResume } from "@/lib/db";
import { DocError, getDocumentPdf } from "@/lib/documents";
import { fail, idParam, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const app = getApplication(await idParam(params));
    if (!app) return fail(new Error("Not found"), 404);
    const pdf = await getDocumentPdf(app, "resume");
    const name = app.resume_id ? getResume(app.resume_id)?.parsed?.name : "";
    return pdfResponse(pdf, `${name || "Resume"} - Resume - ${app.company || "Tailored"}.pdf`, new URL(req.url).searchParams.has("download"));
  } catch (e) {
    return fail(e, e instanceof DocError ? 404 : 500);
  }
}
