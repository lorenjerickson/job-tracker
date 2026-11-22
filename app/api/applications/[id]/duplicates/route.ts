import { duplicatesFor, getApplication, markNotDuplicates } from "@/lib/db";
import { isDuplicate } from "@/lib/duplicates";
import { fail, idParam, json } from "@/lib/http";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

function matches(id: number) {
  const app = getApplication(id);
  if (!app) return null;
  return duplicatesFor(app, id).filter(isDuplicate);
}

/** Likely/possible duplicates of this application (pairs marked "not a duplicate" are left out). */
export async function GET(_: Request, { params }: Ctx) {
  try {
    const m = matches(await idParam(params));
    return m ? json({ matches: m }) : fail(new Error("Not found"), 404);
  } catch (e) {
    return fail(e, 400);
  }
}

/** Body: { not_duplicate: number } — confirm the other application is a different job. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const id = await idParam(params);
    const { not_duplicate } = (await req.json()) as { not_duplicate?: unknown };
    if (typeof not_duplicate !== "number") return fail(new Error("not_duplicate must be an application id"), 400);
    markNotDuplicates(id, [not_duplicate]);
    const m = matches(id);
    return m ? json({ matches: m }) : fail(new Error("Not found"), 404);
  } catch (e) {
    return fail(e, 400);
  }
}
