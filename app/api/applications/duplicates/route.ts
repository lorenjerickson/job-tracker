import { duplicatesFor } from "@/lib/db";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Check a listing that hasn't been saved yet. Body: { job_url, company, title, jd_text } */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    return json({
      matches: duplicatesFor({ job_url: s(b.job_url, 2000), company: s(b.company, 200), title: s(b.title, 200), jd_text: s(b.jd_text, 50_000) }),
    });
  } catch (e) {
    return fail(e, 400);
  }
}
