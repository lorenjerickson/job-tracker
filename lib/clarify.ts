import "server-only";
import { load as cheerioLoad } from "cheerio";
import { arr, enm, int, jsonCall, obj, str } from "./ai";
import { mentions, resumeFullText, unsupportedNumbers } from "./guards";
import { htmlToText } from "./jobfetch";
import { MIME, resumeForPrompt, sanitizeResumeHtml } from "./resume";
import { parsedToHtml } from "./resume-format";
import type { Clarification, ParsedResume, ResumeAddition, ResumeVersion } from "./types";

// ---------------- Draft resume additions from clarifications (AI) ----------------

const ADDITIONS_SCHEMA = obj({
  additions: arr(
    obj({
      clarification_id: str("The id in brackets of the clarification this comes from, e.g. 'c1'"),
      kind: enm(["bullet", "skill", "certification", "other"]),
      role_index: int("kind=bullet: the [ROLE n] index where this experience happened. -1 for other kinds."),
      section: str("kind=skill: skill category (reuse an existing category when one fits). kind=other: section heading such as 'Projects'. Empty otherwise."),
      text: str("The bullet, skill, certification, or item text exactly as it should appear on the resume"),
      note: str("Short note to the candidate if anything was a judgment call (e.g. which role it belongs to) or a detail was left out. Empty otherwise."),
    }),
  ),
});

export async function draftAdditions(resume: ParsedResume, rawText: string, jd: string, items: Clarification[]): Promise<ResumeAddition[]> {
  if (!items.length) return [];
  const keyed = items.map((c, i) => ({ key: `c${i + 1}`, c }));
  const r = await jsonCall<{ additions: ResumeAddition[] }>({
    name: "resume_additions",
    schema: ADDITIONS_SCHEMA,
    system: `You help a candidate add experience to their base resume that it currently leaves out.
A fit analysis flagged some job requirements as partial matches or gaps. For each one, the candidate wrote a
factual clarification describing what they have actually done. Turn each clarification into resume additions.

Rules:
- The clarification is the ONLY new source of facts. Use only what it states. Never invent tools, technologies,
  metrics, numbers, team sizes, scope, outcomes, dates, titles, or employers.
- Keep every number exactly as the candidate wrote it.
- Write bullets in the style of the existing resume: start with a strong verb, concise (one or two lines).
- You may use the job description's terminology only where the clarification describes the same thing.
- kind=bullet goes under the role where the experience happened. If the clarification names an employer, product,
  or time period, use the matching role. If that's unclear, pick the most plausible role and say so in note.
- Usually one bullet per clarification; two only if it describes clearly separate accomplishments.
- kind=skill only for a specific tool, technology, language, or method the candidate says they used and that is not
  already on the resume.
- kind=certification only for a named certification the candidate says they hold.
- kind=other for projects, publications, volunteering, or similar that don't belong to a role.
- Do not repeat what the resume already says. Do not mention the job, the employer you're applying to, or the requirement.
- If a clarification contains nothing factual to add, return no additions for it.`,
    user: `JOB DESCRIPTION:\n"""\n${jd.slice(0, 20_000)}\n"""\n\nCANDIDATE RESUME:\n"""\n${resumeForPrompt(resume)}\n"""\n\nCLARIFICATIONS:\n${keyed
      .map(({ key, c }) => `[${key}] Requirement (${c.match}): ${c.requirement}\nCandidate says: ${c.text}`)
      .join("\n\n")}`,
  });

  const full = resumeFullText(resume, rawText);
  const byKey = new Map(keyed.map(({ key, c }) => [key, c]));
  const out: ResumeAddition[] = [];
  for (const a of r.additions) {
    const c = byKey.get(a.clarification_id.replace(/[[\]]/g, "").trim());
    const text = a.text.trim();
    if (!c || !text) continue;
    const notes = a.note.trim() ? [a.note.trim()] : [];
    let kind = a.kind;
    let role = kind === "bullet" ? a.role_index : -1;
    if (kind === "bullet" && !resume.experience[role]) {
      if (resume.experience.length) {
        role = 0;
        notes.push("Couldn't tell which role this belongs to; placed under your most recent role.");
      } else {
        kind = "other";
        role = -1;
      }
    }
    if (kind === "skill" && mentions(full, text)) continue; // already on the resume
    const badNums = unsupportedNumbers(text, `${c.text}\n${full}`);
    if (badNums.length) notes.push(`Check: ${badNums.join(", ")} doesn't appear in what you wrote.`);
    out.push({
      clarification_id: c.id,
      kind,
      role_index: role,
      section: kind === "skill" ? a.section.trim() || "Skills" : kind === "other" ? a.section.trim() || "Additional Experience" : "",
      text,
      note: notes.join(" "),
    });
  }
  return out;
}

// ---------------- Apply reviewed additions to the base resume (deterministic) ----------------

const KINDS = new Set(["bullet", "skill", "certification", "other"]);

/** Validate client-supplied additions against the resume they will be applied to. */
export function cleanAdditions(v: unknown, resume: ParsedResume): ResumeAddition[] {
  if (!Array.isArray(v)) throw new Error("additions must be a list");
  return v.slice(0, 100).flatMap((x): ResumeAddition[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim().slice(0, 800) : "";
    const kind = typeof o.kind === "string" && KINDS.has(o.kind) ? (o.kind as ResumeAddition["kind"]) : null;
    if (!text || !kind) return [];
    const role = Number(o.role_index);
    if (kind === "bullet" && !(Number.isInteger(role) && resume.experience[role])) throw new Error("A bullet is assigned to a role that doesn't exist.");
    return [
      {
        clarification_id: typeof o.clarification_id === "string" ? o.clarification_id.slice(0, 64) : "",
        kind,
        role_index: kind === "bullet" ? role : -1,
        section: typeof o.section === "string" ? o.section.trim().slice(0, 80) : "",
        text,
        note: "",
      },
    ];
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function applyToParsed(src: ParsedResume, additions: ResumeAddition[]): ParsedResume {
  const r = structuredClone(src);
  for (const a of additions) {
    if (a.kind === "bullet") r.experience[a.role_index].bullets.push(a.text);
    else if (a.kind === "certification") r.certifications.push(a.text);
    else if (a.kind === "skill") {
      const cat = a.section || "Skills";
      const g = r.skills.find((s) => norm(s.category) === norm(cat));
      if (g) {
        if (!g.items.some((i) => norm(i) === norm(a.text))) g.items.push(a.text);
      } else r.skills.push({ category: cat, items: [a.text] });
    } else {
      const heading = a.section || "Additional Experience";
      const g = r.other.find((o) => norm(o.heading) === norm(heading));
      if (g) g.items.push(a.text);
      else r.other.push({ heading, items: [a.text] });
    }
  }
  return r;
}

/**
 * Insert additions into an editor-created resume's HTML, keeping its formatting.
 * Returns null if a role can't be located, so the caller can rebuild the layout from structured data.
 */
function insertIntoHtml(html: string, src: ParsedResume, additions: ResumeAddition[]): string | null {
  const $ = cheerioLoad(`<div id="__root">${html}</div>`);
  const root = $("#__root");
  const top = () => root.children().toArray();
  const tag = (el: unknown) => ((el as { tagName?: string }).tagName ?? "").toLowerCase();

  /** Top-level elements after `start` up to (not including) the next heading of the given tags. */
  const blockAfter = (start: unknown, stop: string[]) => {
    const kids = top();
    const i = kids.indexOf(start as (typeof kids)[number]);
    const out: typeof kids = [];
    for (let j = i + 1; j < kids.length && !stop.includes(tag(kids[j])); j++) out.push(kids[j]);
    return out;
  };
  const findSection = (re: RegExp) => top().find((el) => tag(el) === "h2" && re.test($(el).text()));
  const appendSection = (heading: string, body: string) => {
    root.append(`<h2>${esc(heading)}</h2>${body}`);
  };
  const appendToList = (block: ReturnType<typeof blockAfter>, h2: unknown, text: string) => {
    const ul = block.find((el) => tag(el) === "ul" || tag(el) === "ol");
    if (ul) $(ul).append(`<li><p>${esc(text)}</p></li>`);
    else $((block.at(-1) ?? h2) as never).after(`<ul><li><p>${esc(text)}</p></li></ul>`);
  };

  for (const a of additions) {
    if (a.kind === "bullet") {
      const role = src.experience[a.role_index];
      const want = [norm(role.title), norm(role.company)].filter(Boolean);
      // Several entries can share a title and company (e.g. repeated stints); pick the matching occurrence.
      const nth = src.experience.slice(0, a.role_index).filter((e) => e.title === role.title && e.company === role.company).length;
      const h3s = top().filter((el) => tag(el) === "h3" && want.every((w) => norm($(el).text()).includes(w)));
      const h3 = h3s[nth];
      if (!h3 || !want.length) return null;
      appendToList(blockAfter(h3, ["h2", "h3"]), h3, a.text);
    } else if (a.kind === "skill") {
      const h2 = findSection(/skill|technolog|competenc|expertise/i);
      const cat = a.section || "Skills";
      if (!h2) {
        const exp = findSection(/experience|employment|work history/i);
        const block = `<h2>Skills</h2><p><strong>${esc(cat)}:</strong> ${esc(a.text)}</p>`;
        if (exp) $(exp as never).before(block);
        else root.append(block);
        continue;
      }
      const block = blockAfter(h2, ["h2"]);
      const lines = block.flatMap((el) => [el, ...$(el).find("p, li").toArray()]).filter((el) => ["p", "li"].includes(tag(el)));
      const line = lines.find((el) => {
        const t = $(el).text();
        const colon = t.indexOf(":");
        return colon > 0 && norm(t.slice(0, colon)) === norm(cat);
      });
      if (line) {
        const target = tag(line) === "li" && $(line).children("p").length ? $(line).children("p").last() : $(line);
        target.append(`, ${esc(a.text)}`);
      } else if (!lines.some((el) => $(el).text().includes(":")) && block.some((el) => ["ul", "ol"].includes(tag(el)))) {
        appendToList(block, h2, a.text); // a plain list of skills without categories
      } else {
        $((block.at(-1) ?? h2) as never).after(`<p><strong>${esc(cat)}:</strong> ${esc(a.text)}</p>`);
      }
    } else {
      const heading = a.kind === "certification" ? "Certifications" : a.section || "Additional Experience";
      const h2 =
        a.kind === "certification" ? findSection(/certif|licen/i) : top().find((el) => tag(el) === "h2" && norm($(el).text()) === norm(heading));
      if (h2) appendToList(blockAfter(h2, ["h2"]), h2, a.text);
      else appendSection(heading, `<ul><li><p>${esc(a.text)}</p></li></ul>`);
    }
  }
  return root.html() ?? "";
}

export interface ClarifiedResume {
  parsed: ParsedResume;
  html: string;
  text: string;
  /** True when the editor formatting couldn't be kept and the layout was rebuilt from structured data. */
  rebuilt: boolean;
}

export function applyAdditions(base: ResumeVersion, additions: ResumeAddition[]): ClarifiedResume {
  if (!base.parsed) throw new Error("Your active resume hasn't been parsed yet.");
  const parsed = applyToParsed(base.parsed, additions);
  // Versions saved from the editor carry their own formatting; keep it when we can.
  const custom = base.mime === MIME.html && base.html ? insertIntoHtml(base.html, base.parsed, additions) : null;
  const html = sanitizeResumeHtml(custom ?? parsedToHtml(parsed));
  return { parsed, html, text: htmlToText(html), rebuilt: base.mime === MIME.html && custom === null };
}
