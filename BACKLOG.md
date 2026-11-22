# Project backlog

## Deferred

### DB-001 — Concurrent first-run migrations

- Discovered during SEC-001: production-build workers initializing a new SQLite
  database can race in lib/db.ts migration transactions (SQLITE_BUSY_SNAPSHOT).
- The first build failed; schema initialization reached version 6. The second
  build passed without code changes. Fresh databases may need initialization
  before parallel builds. Existing-database behavior was not implicated.
- Proposed next step: serialize migrations and verify concurrent fresh startup.
  This is deferred; no database implementation changes were made in SEC-001.

---

## Completed

### SEC-001 — Next.js security patch

- Done locally (2026-11-22): upgraded Next.js 16.4.3 to exactly 16.4.6 and set
  experimental.agentUpgrade to "security"; preserved external package config.
- npm install succeeded (Node 24.18.0, npm 11.16.0); audit found zero vulnerabilities.
  Only Next.js package versions changed; npm refreshed better-sqlite3 install-script
  metadata without changing its version or configured script policy.
- Verified option support in installed config types/schema; npm exec -- next
  --version returned 16.4.6; npm run typecheck and npm run build passed.
- First build encountered DB-001; retry passed against initialized isolated DB.
- Production HTTP smoke checks passed for /, /resume, /applications/new and
  application detail; API create/read/update/delete and duplicate rejection passed.
  Test records were deleted and the verification server stopped. AI service calls
  and full browser interaction were not tested.
- Local branches/history, remote heads and available remote history, and GitHub
  open PRs showed no equivalent work. Open PR recheck also returned none.
- Checked same-major instructions and official agent-upgrade guide; no codemods
  or major-version migration were applicable.
- Approved bounds: one local upgrade, version/typecheck/build/runtime verification,
  at most two repair attempts, local commit, no delegated model calls. One repair
  attempt used (build retry). Allowance telemetry unavailable; user approved plan.
- Delivery: branch security/next-16.4.6 in /private/tmp/job-tracker-next-16.4.6.
  Original checkout unchanged. Draft PR opened with user permission:
  https://github.com/lorenjerickson/job-tracker/pull/1
  Includes pre-existing local commits 1e09360 and 64b53bd absent from remote main.
- Next: merge branch into main, install dependencies, restart development server.
- Exclusions: unrelated dependency updates, AI service calls, production data
  changes, deployment.
