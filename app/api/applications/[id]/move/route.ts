import { listApplications, moveApplication } from "@/lib/db";
import { freezeDocuments } from "@/lib/documents";
import { fail, idParam, json } from "@/lib/http";
import type { Status } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await idParam(params);
    const { status, beforeId } = (await req.json()) as { status: Status; beforeId?: number | null };
    moveApplication(id, status, beforeId ?? null);
    // On submission, store the exact PDFs that went out.
    await freezeDocuments(id).catch((e) => console.error("Couldn't freeze documents", e));
    return json(listApplications());
  } catch (e) {
    return fail(e, 400);
  }
}
