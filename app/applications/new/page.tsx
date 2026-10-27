import NewApplication from "@/components/NewApplication";
import { getActiveResume } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function NewPage() {
  return (
    <main className="main narrow">
      <div className="page-head">
        <div>
          <h1>New application</h1>
          <p className="muted">Paste a job link. You&apos;ll get a fit assessment, a tailored resume PDF, and a cover letter.</p>
        </div>
      </div>
      <NewApplication hasResume={!!getActiveResume()?.parsed} />
    </main>
  );
}
