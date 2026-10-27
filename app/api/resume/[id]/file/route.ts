import { getResumeFile } from "@/lib/db";
import { fail, idParam } from "@/lib/http";

export const runtime = "nodejs";

/** Serve the originally uploaded file. PDFs open in the browser; Word files download. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const f = getResumeFile(await idParam(params));
    if (!f) return fail(new Error("Not found"), 404);
    const inline = f.mime === "application/pdf";
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.filename.replace(/[^\w.\- ]/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e, 400);
  }
}
