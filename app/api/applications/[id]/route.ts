import { deleteApplication, getApplication, listEvents, updateApplication } from "@/lib/db";
import { fail, idParam, json } from "@/lib/http";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = await idParam(params);
    const app = getApplication(id);
    return app ? json({ ...app, events: listEvents(id) }) : fail(new Error("Not found"), 404);
  } catch (e) {
    return fail(e, 400);
  }
}

/** Edit text fields, or save hand-edited tailored resume / cover letter. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = await idParam(params);
    if (!getApplication(id)) return fail(new Error("Not found"), 404);
    updateApplication(id, await req.json());
    return json({ ...getApplication(id), events: listEvents(id) });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    deleteApplication(await idParam(params));
    return json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}
