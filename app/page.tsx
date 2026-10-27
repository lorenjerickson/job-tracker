import Board from "@/components/Board";
import { getActiveResume, listApplications } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  const apps = listApplications();
  const resume = getActiveResume();
  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p className="muted">Drag cards between columns to update their status.</p>
        </div>
      </div>
      {!resume && (
        <div className="alert info" style={{ marginBottom: "1rem" }}>
          Start by <Link href="/resume">uploading your resume</Link> — every tailored resume, cover letter, and fit assessment is built only from it.
        </div>
      )}
      <Board initial={apps} />
    </main>
  );
}
