import ApplicationDetail from "@/components/ApplicationDetail";
import { getActiveResume, getApplication, getResume, listEvents } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const id = Number((await params).id);
  const app = Number.isInteger(id) ? getApplication(id) : null;
  if (!app) notFound();
  const source = app.resume_id ? getResume(app.resume_id) : null;
  const active = getActiveResume();
  const assessed = app.assessment_resume_id ? getResume(app.assessment_resume_id) : null;
  return (
    <main className="main">
      <ApplicationDetail
        initial={{ ...app, events: listEvents(id) }}
        source={source?.parsed ?? null}
        sourceVersion={source?.version ?? null}
        activeVersion={active?.version ?? null}
        assessedVersion={assessed?.version ?? null}
        initialError={(await searchParams).error ?? null}
      />
    </main>
  );
}
