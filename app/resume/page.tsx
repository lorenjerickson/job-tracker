import ResumeManager from "@/components/ResumeManager";
import { listApplications, listResumes } from "@/lib/db";
import { FINAL_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function ResumePage() {
  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1>My Resume</h1>
          <p className="muted">Your master resume. Tailored versions only ever reorder, trim, and reword what&apos;s here.</p>
        </div>
      </div>
      <ResumeManager initial={listResumes()} apps={listApplications().filter((a) => !FINAL_STATUSES.includes(a.status))} />
    </main>
  );
}
