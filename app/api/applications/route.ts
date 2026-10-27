import { createApplication, listApplications } from "@/lib/db";
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
    const id = createApplication({
      job_url: s(b.job_url, 2000),
      company: s(b.company, 200),
      title: s(b.title, 200),
      location: s(b.location, 200),
      jd_text,
      guidance: s(b.guidance, 2000),
    });
    return json({ id }, 201);
  } catch (e) {
    return fail(e, 400);
  }
}
