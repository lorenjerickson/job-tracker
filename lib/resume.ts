import "server-only";
import { load as cheerioLoad } from "cheerio";
import JSZip from "jszip";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { arr, jsonCall, obj, str } from "./ai";
import { htmlToText } from "./jobfetch";
import type { ParsedResume } from "./types";

export const MIME = {
  html: "text/html",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

const tidy = (s: string) =>
  s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export async function extractPdfText(pdf: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return tidy(text);
}

/** Text from Word header/footer parts, which mammoth skips. Resumes often keep name and contact info there. */
async function docxHeaderFooterText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = Object.keys(zip.files)
    .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
    .sort();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of parts) {
    const xml = await zip.files[name].async("string");
    for (const para of xml.split(/<\/w:p>/)) {
      const line = [...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
        .map((m) => (m[1] === undefined ? " " : m[1]))
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      // Skip page numbers and repeated headers.
      if (line && !/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(line) && !seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out.join("\n");
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  // HTML keeps list structure (bullets), which raw-text extraction loses.
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const body = htmlToText(html);
  const hf = await docxHeaderFooterText(buf).catch(() => "");
  const extra = hf
    .split("\n")
    .filter((l) => !body.includes(l))
    .join("\n");
  return tidy(extra ? `${extra}\n\n${body}` : body);
}

export type ResumeFileKind = "pdf" | "docx";

/** Identify an uploaded resume by its bytes (not just its name). */
export function detectResumeKind(buf: Buffer, filename: string): ResumeFileKind | "doc" | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip && (/\.docx$/i.test(filename) || buf.includes("word/document.xml"))) return "docx";
  // Legacy binary Word (.doc) starts with the OLE compound file signature.
  if (buf.subarray(0, 4).toString("hex") === "d0cf11e0") return "doc";
  return null;
}

export async function extractResumeText(buf: Buffer, kind: ResumeFileKind): Promise<string> {
  return kind === "pdf" ? extractPdfText(buf) : extractDocxText(buf);
}

const RESUME_SCHEMA = obj({
  name: str(),
  headline: str("Professional headline/title line under the name, verbatim, or empty string"),
  contact: obj({ email: str(), phone: str(), location: str(), links: arr(str()) }),
  summary: str("Summary/profile section verbatim, or empty string"),
  skills: arr(obj({ category: str("Category label as written, or 'Skills' if none"), items: arr(str()) })),
  experience: arr(
    obj({
      company: str(),
      title: str(),
      location: str(),
      start: str("Start date exactly as written"),
      end: str("End date exactly as written, e.g. 'Present'"),
      bullets: arr(str("One accomplishment/responsibility, verbatim")),
    }),
    "Most recent first, in resume order",
  ),
  education: arr(obj({ institution: str(), degree: str(), details: str(), year: str() })),
  certifications: arr(str()),
  other: arr(obj({ heading: str(), items: arr(str()) }), "Any other sections: projects, awards, publications, volunteering, etc."),
});

export async function parseResumeText(rawText: string): Promise<ParsedResume> {
  return jsonCall<ParsedResume>({
    name: "parsed_resume",
    schema: RESUME_SCHEMA,
    system: `You convert resume text (extracted from a PDF) into structured data.
Copy content VERBATIM. Do not paraphrase, summarize, correct, or add anything.
Only repair PDF extraction artifacts: re-join words/lines broken by wrapping, remove stray bullet glyphs and page numbers.
If one job has multiple titles (promotions), create one experience entry per title with the same company.
If a role is described in paragraph form, split it into sentences and use those as bullets.
Use empty strings / empty arrays for anything not present.`,
    user: `RESUME TEXT:\n"""\n${rawText}\n"""`,
  });
}

/** Plain-text rendering of a parsed resume with bullet ids, used in prompts. */
export function resumeForPrompt(r: ParsedResume): string {
  const lines: string[] = [];
  lines.push(`NAME: ${r.name}`);
  if (r.headline) lines.push(`HEADLINE: ${r.headline}`);
  if (r.summary) lines.push(`SUMMARY: ${r.summary}`);
  if (r.skills.length) {
    lines.push("SKILLS:");
    for (const s of r.skills) lines.push(`  ${s.category}: ${s.items.join(", ")}`);
  }
  lines.push("EXPERIENCE:");
  r.experience.forEach((e, i) => {
    lines.push(`  [ROLE ${i}] ${e.title} | ${e.company} | ${e.location} | ${e.start} – ${e.end}`);
    e.bullets.forEach((b, j) => lines.push(`    [${i}.${j}] ${b}`));
  });
  if (r.education.length) {
    lines.push("EDUCATION:");
    for (const e of r.education) lines.push(`  ${[e.degree, e.institution, e.details, e.year].filter(Boolean).join(" | ")}`);
  }
  if (r.certifications.length) lines.push(`CERTIFICATIONS: ${r.certifications.join("; ")}`);
  for (const o of r.other) lines.push(`${o.heading.toUpperCase()}:\n  ${o.items.join("\n  ")}`);
  return lines.join("\n");
}

/** Allow only the formatting the resume editor produces; drop scripts, styles (except alignment), and handlers. */
export function sanitizeResumeHtml(html: string): string {
  const $ = cheerioLoad(`<div id="__root">${html}</div>`);
  const ALLOWED = new Set(["h1", "h2", "h3", "p", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "br", "hr", "span"]);
  // Script/style elements aren't plain "tag" nodes in the DOM tree, so remove them explicitly first.
  $("script, style, iframe, object, embed, noscript, template, link, meta").remove();
  // Unwrap anything outside the allow-list (keeping its text), repeating until none remain.
  for (let guard = 0; guard < 5000; guard++) {
    const bad = $("#__root *")
      .filter((_, el) => !ALLOWED.has((el as { tagName: string }).tagName.toLowerCase()))
      .first();
    if (!bad.length) break;
    bad.replaceWith(bad.contents());
  }
  // Strip every attribute except safe links and text alignment.
  $("#__root *").each((_, el) => {
    if (el.type !== "tag") return;
    const node = $(el);
    for (const name of Object.keys(el.attribs ?? {})) {
      const v = el.attribs[name];
      const keep =
        (name === "href" && el.tagName === "a" && /^(https?:|mailto:|tel:)/i.test(v.trim())) ||
        (name === "style" && /^\s*text-align:\s*(left|center|right|justify);?\s*$/i.test(v));
      if (!keep) node.removeAttr(name);
    }
    if (el.tagName === "a") node.attr("rel", "noopener noreferrer");
  });
  return $("#__root").html() ?? "";
}
