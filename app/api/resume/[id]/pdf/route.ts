import { getResume } from "@/lib/db";
import { fail, idParam, pdfResponse } from "@/lib/http";
import { renderResumePdf } from "@/lib/pdf";
import { asTailored } from "@/lib/resume-format";

export const runtime = "nodejs";

/** This resume version as a clean PDF in the app's standard layout. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = getResume(await idParam(params));
    if (!r?.parsed) return fail(new Error("Not found"), 404);
    const pdf = await renderResumePdf(r.parsed, asTailored(r.parsed));
    return pdfResponse(pdf, `${r.parsed.name || "Resume"} - Resume v${r.version}.pdf`, new URL(req.url).searchParams.has("download"));
  } catch (e) {
    return fail(e);
  }
}
