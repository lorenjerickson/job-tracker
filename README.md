# Job Tracker

A local Next.js + SQLite app that:

1. Pulls a job description from a link (or pasted text)
2. Scores how well your resume fits it, requirement by requirement, with quoted evidence
3. Lets you clarify partial matches and gaps with real experience, adds it to your base resume, and re-scores
4. Once a job scores 75% or more, builds a tailored resume **PDF** and a cover letter **PDF** using only facts from your resume
5. Tracks every application on a dark-themed Kanban board

## Setup

Requires **Node 22+**.

```bash
npm install
cp .env.example .env.local   # then put your OpenAI key in it
npm run dev                  # http://localhost:3000
```

For day-to-day use, `npm run build && npm start` is faster than dev mode.

`.env.local`:

| Variable | Required | Default |
|---|---|---|
| `OPENAI_API_KEY` | yes | — |
| `OPENAI_MODEL` | no | `gpt-5.5` (any chat model with structured outputs) |
| `DATABASE_PATH` | no | `./data/job-tracker.db` |

## Using it

1. **My Resume** → upload your resume as a PDF or Word (.docx) file. It opens in a **rich-text editor**, a page-styled document with headings for your name, sections, and roles; bold, italic, underline, and strikethrough; bulleted and numbered lists with indenting; alignment; links; divider lines; and undo/redo.
   - **Save as new version** treats your edits exactly like a re-upload: the text is re-read, saved as the next version, and made active. Earlier versions are kept. You'll be warned before switching versions or leaving the page with unsaved edits.
   - Upload a new file at any time; every upload is also a new version.
   - **Download vN as PDF** exports any version in the app's standard resume layout.
   - **Structured data** shows exactly what the app understood (the source for every generated document), and you can correct it there.
   After uploading a new version, the **Re-assess applications** panel on that page re-scores your open applications against it and shows each score change.
2. **+ New application** → paste the job link → **Fetch description** → review the text → **Save & analyze fit**.
   - **Duplicate check.** As you fill in the link, company, title, and description, the app looks for jobs you've already added. It flags them as *likely* (same posting link ignoring tracking parameters, same job ID in the link on the same site, same company and title, or a description that's 85%+ the same) or *possible* (similar title at the same company, the same long job ID on a different site, or descriptions that overlap 60%+). To save a flagged job, tick **It's a different job**; the server enforces this too. Other applications at the same company are listed for reference but don't block saving.
   - The application page shows a **Possible duplicate** banner too. This re-checks after the fit analysis fills in the company and title. **Not a duplicate** stops flagging that pair.
3. On the application page, review the fit analysis. Analysis and document generation are separate steps.
   - **Clarify gaps.** Every *partial* or *gap* requirement has a **+ Clarify** button and a question meant to draw out experience your resume may leave out. Describe what you actually did (company, what you did, tools, results). Drafts are saved with the application.
   - **Review & add to resume** drafts resume additions from your clarifications only: experience bullets under the right role, skills, certifications, or other items. Edit the wording, change the role, or remove items, then **Save as vN & re-analyze** (or just **Save as vN**). This creates a new base resume version and makes it active; the old version is kept. Editor formatting is preserved where the app can find the right role and section.
   - The fit analysis is always scored against your active resume. If it was scored against an older version, the Fit tab says so and offers **Re-analyze with vN**.
4. **Generate resume & cover letter** unlocks once the fit score is **75% or more** (enforced by the server too). Edit anything, then download the PDFs. Tailored resumes and cover letters stay on the resume version they were built from until you regenerate them.
5. Track progress by dragging cards across the board, or by changing the status on the application page:
   **Evaluating → Applied → Contact → Interviewing → Offer**, or **Unsuccessful** at any point

### Applied applications are locked

The first time an application moves to **Applied** or any later stage, the app asks you to confirm. It then:

- locks the tailored resume and cover letter. They can't be edited, re-tailored, rewritten, or regenerated, and this is enforced by the server as well as hidden in the UI.
- saves a copy of the exact PDFs, so the download always matches what you sent, even if you later edit or delete resume versions.
- sets the applied date if it's empty.

The lock stays on even if you move the card back to Evaluating. You can still re-assess fit, edit notes and job details, and download or copy the documents. Moving a card straight from Evaluating to Unsuccessful (you passed on the job) doesn't lock it.

Column history: Submitted was renamed Applied, Under Consideration became Contact, and Rejected became Unsuccessful. The Accepted column was removed, and any cards in it moved to Offer. (Earlier still: Saved → Evaluating, Applied → Submitted, Screening → Under Consideration, Closed → Rejected.) Any card that had already been applied to stays locked.

## How "no invented facts" is enforced

The prompt tells the model to use only resume facts, but the app doesn't rely on that alone:

- **Employers, titles, dates, education, and certifications** are never written by the AI. They're copied from your parsed resume when the PDF is rendered.
- **Every tailored bullet must cite the original bullet(s)** it came from, in the same role. A bullet with no valid source is removed.
- **Numbers are checked.** If a rewritten bullet has a number (%, $, counts) that isn't in its source bullet, it goes back to your original wording.
- **Skills** that don't appear anywhere on your resume are removed.
- **A separate fact-check pass** reviews the headline, summary, bullets, and cover letter against your resume. Flagged bullets go back to your original wording. A flagged summary or cover letter gets rewritten once with the feedback, and anything still flagged is shown to you.
- Every correction is listed under **Fact-check notes** so you can see what was caught.
- In the fit assessment, evidence quotes that can't be found word for word on your resume are labeled.

Hand edits you make in the app aren't checked.

Clarifications are the one way new facts enter your resume, and they come only from what you write. Drafted additions use only your clarification's content; any number that isn't in what you wrote is flagged for review, and nothing is saved until you approve it. After that, they're ordinary resume facts, so tailored resumes and cover letters can use them.

## Notes

- Job links: most applicant tracking systems (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters) embed structured job data, which the app reads directly. Pages that need a login or JavaScript (often LinkedIn) can't be fetched. Paste the description in that case.
- All data stays on your machine in `data/job-tracker.db`. Only your resume text and the job description are sent to OpenAI.
- Resume upload accepts text-based PDFs and Word .docx files, including name and contact details kept in the Word header. Older .doc files need to be re-saved as .docx. Scanned image PDFs have no text to extract.
