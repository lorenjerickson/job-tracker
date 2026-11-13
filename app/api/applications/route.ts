import { createApplication, duplicatesFor, listApplications, markNotDuplicates } from "@/lib/db";
import { isDuplicate } from "@/lib/duplicates";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(listApplications());
}

const s = (v: unknown, max = 50_000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const jd_text = s(b.jd_text);
    if (jd_text.length < 100) return fail(new Error("The job description is too short. Fetch it from a link or paste it in."), 400);
    const input = {
      job_url: s(b.job_url, 2000),
      company: s(b.company, 200),
      title: s(b.title, 200),
      location: s(b.location, 200),
      jd_text,
      guidance: s(b.guidance, 2000),
    };
    // Refuse likely/possible duplicates unless the user has confirmed it's a different job.
    const dups = duplicatesFor(input).filter(isDuplicate);
    if (dups.length && b.allow_duplicate !== true) {
      return json({ error: "This looks like a job you've already added.", duplicates: dups }, 409);
    }
    const id = createApplication(input);
    if (dups.length) markNotDuplicates(id, dups.map((d) => d.id));
    return json({ id }, 201);
  } catch (e) {
    return fail(e, 400);
  }
}
