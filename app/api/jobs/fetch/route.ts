import { fail, json } from "@/lib/http";
import { fetchJob } from "@/lib/jobfetch";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) return fail(new Error("Enter a job posting URL."), 400);
    return json(await fetchJob(url));
  } catch (e) {
    return fail(e, 422);
  }
}
