import "server-only";
import { getApplication, getResume, getSnapshot, saveSnapshot, type SnapshotKind } from "./db";
import { renderCoverLetterPdf, renderResumePdf } from "./pdf";
import type { Application } from "./types";

export class DocError extends Error {}

async function render(app: Application, kind: SnapshotKind): Promise<Buffer> {
  if (kind === "resume" ? !app.tailored : !app.cover_letter) {
    throw new DocError(kind === "resume" ? "No tailored resume yet." : "No cover letter yet.");
  }
  const src = app.resume_id ? getResume(app.resume_id)?.parsed : null;
  if (!src) throw new DocError("The resume version this was built from was deleted. Regenerate.");
  return kind === "resume" ? renderResumePdf(src, app.tailored!) : renderCoverLetterPdf(src, app.cover_letter!, app.company);
}

/**
 * The PDF for an application. Once an application is submitted, the first rendering is frozen in the
 * database and that exact file is served from then on, even if resume versions are later edited or deleted.
 */
export async function getDocumentPdf(app: Application, kind: SnapshotKind): Promise<Buffer> {
  if (!app.submitted_at) return render(app, kind);
  const frozen = getSnapshot(app.id, kind);
  if (frozen) return frozen;
  const pdf = await render(app, kind);
  saveSnapshot(app.id, kind, pdf);
  return pdf;
}

/** Freeze both documents right when the application is submitted. Missing documents are skipped. */
export async function freezeDocuments(id: number) {
  const app = getApplication(id);
  if (!app?.submitted_at) return;
  for (const kind of ["resume", "cover"] as const) {
    if (getSnapshot(id, kind)) continue;
    try {
      saveSnapshot(id, kind, await render(app, kind));
    } catch (e) {
      if (!(e instanceof DocError)) throw e;
    }
  }
}
