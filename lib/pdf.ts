import "server-only";
import PDFDocument from "pdfkit";
import type { CoverLetter, ParsedResume, TailoredResume } from "./types";

// pdfkit's built-in fonts only cover WinAnsi; map common Unicode to safe equivalents.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function clean(s: string): string {
  return (s ?? "")
    .replace(/[‐‑‒]/g, "-")
    .replace(/−/g, "-")
    .replace(/[→⇒]/g, "->")
    .replace(/ /g, " ")
    .replace(/[​-‍﻿]/g, "")
    .split("")
    .filter((c) => c.charCodeAt(0) < 256 || WINANSI_EXTRA.has(c))
    .join("");
}

const C = {
  ink: "#111827",
  muted: "#4b5563",
  accent: "#1f4e79",
  rule: "#c7cdd6",
};

const PAGE = { size: "LETTER" as const, margins: { top: 46, bottom: 46, left: 54, right: 54 } };

/** Start collecting output; call doc.end() when finished writing. */
function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function contactLine(r: ParsedResume): string {
  return [r.contact.email, r.contact.phone, r.contact.location, ...r.contact.links].filter(Boolean).map(clean).join("  |  ");
}

function header(doc: PDFKit.PDFDocument, r: ParsedResume, headline: string) {
  doc.font("Helvetica-Bold").fontSize(22).fillColor(C.ink).text(clean(r.name), { align: "left" });
  if (headline) doc.moveDown(0.1).font("Helvetica").fontSize(11.5).fillColor(C.accent).text(clean(headline));
  const cl = contactLine(r);
  if (cl) doc.moveDown(0.25).font("Helvetica").fontSize(9).fillColor(C.muted).text(cl);
  doc.moveDown(0.5);
  rule(doc);
}

function rule(doc: PDFKit.PDFDocument) {
  const { left, right } = doc.page.margins;
  const y = doc.y;
  doc.moveTo(left, y).lineTo(doc.page.width - right, y).lineWidth(0.75).strokeColor(C.rule).stroke();
  doc.y = y + 6;
}

function section(doc: PDFKit.PDFDocument, title: string) {
  // Avoid orphaned section headings at the bottom of a page.
  if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.accent).text(title.toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(0.15);
  rule(doc);
}

function twoCol(doc: PDFKit.PDFDocument, leftText: string, rightText: string, leftFont: string, size: number, color = C.ink) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const y = doc.y;
  doc.font("Helvetica").fontSize(size - 0.5);
  const rw = rightText ? doc.widthOfString(rightText) + 8 : 0;
  doc.font("Helvetica").fontSize(size - 0.5).fillColor(C.muted).text(rightText, left, y, { width, align: "right" });
  const afterRight = doc.y;
  doc.font(leftFont).fontSize(size).fillColor(color).text(leftText, left, y, { width: width - rw });
  doc.y = Math.max(doc.y, afterRight);
  doc.x = left;
}

function bullet(doc: PDFKit.PDFDocument, text: string) {
  const { left, right } = doc.page.margins;
  const indent = 12;
  const width = doc.page.width - left - right - indent;
  const y = doc.y;
  doc.font("Helvetica").fontSize(9.8).fillColor(C.ink);
  doc.text("•", left + 2, y, { lineBreak: false });
  doc.text(clean(text), left + indent, y, { width, lineGap: 1.2 });
  doc.x = left;
  doc.moveDown(0.18);
}

const dates = (s: string, e: string) => clean([s, e].filter(Boolean).join(" – "));

export async function renderResumePdf(src: ParsedResume, t: TailoredResume): Promise<Buffer> {
  const doc = new PDFDocument({ ...PAGE, info: { Title: `${src.name} – Resume`, Author: src.name } });
  const done = collect(doc);

  header(doc, src, t.headline || src.headline);

  if (t.summary) {
    section(doc, "Summary");
    doc.font("Helvetica").fontSize(10).fillColor(C.ink).text(clean(t.summary), { lineGap: 1.5 });
  }

  if (t.skills.length) {
    section(doc, "Core Skills");
    for (const g of t.skills) {
      doc.font("Helvetica-Bold").fontSize(9.8).fillColor(C.ink).text(`${clean(g.category)}: `, { continued: true });
      doc.font("Helvetica").text(clean(g.items.join(", ")), { lineGap: 1.2 });
      doc.moveDown(0.15);
    }
  }

  const visible = t.experience.filter((r) => !r.hidden && src.experience[r.source_index]);
  const full = visible.filter((r) => !r.condensed);
  const condensed = visible.filter((r) => r.condensed);

  if (full.length) {
    section(doc, "Experience");
    full.forEach((r, idx) => {
      const e = src.experience[r.source_index];
      if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
      if (idx > 0) doc.moveDown(0.45);
      twoCol(doc, clean(e.title), dates(e.start, e.end), "Helvetica-Bold", 10.8);
      twoCol(doc, clean(e.company), clean(e.location), "Helvetica-Oblique", 10, C.muted);
      doc.moveDown(0.2);
      for (const b of r.bullets) bullet(doc, b.text);
    });
  }

  if (condensed.length) {
    section(doc, full.length ? "Earlier Experience" : "Experience");
    for (const r of condensed) {
      const e = src.experience[r.source_index];
      twoCol(doc, `${clean(e.title)}, ${clean(e.company)}`, dates(e.start, e.end), "Helvetica", 9.8);
      doc.moveDown(0.12);
    }
  }

  if (src.education.length) {
    section(doc, "Education");
    for (const ed of src.education) {
      twoCol(doc, clean([ed.degree, ed.institution].filter(Boolean).join(", ")), clean(ed.year), "Helvetica", 9.8);
      if (ed.details) doc.font("Helvetica").fontSize(9).fillColor(C.muted).text(clean(ed.details));
      doc.moveDown(0.12);
    }
  }

  if (src.certifications.length) {
    section(doc, "Certifications");
    for (const c of src.certifications) bullet(doc, c);
  }

  for (const o of src.other) {
    if (!o.items.length) continue;
    section(doc, o.heading);
    for (const it of o.items) bullet(doc, it);
  }

  doc.end();
  return done;
}

export async function renderCoverLetterPdf(src: ParsedResume, letter: CoverLetter, company: string): Promise<Buffer> {
  const doc = new PDFDocument({
    ...PAGE,
    margins: { top: 60, bottom: 60, left: 72, right: 72 },
    info: { Title: `${src.name} – Cover Letter${company ? ` – ${company}` : ""}`, Author: src.name },
  });
  const done = collect(doc);

  doc.font("Helvetica-Bold").fontSize(20).fillColor(C.ink).text(clean(src.name));
  const cl = contactLine(src);
  if (cl) doc.moveDown(0.2).font("Helvetica").fontSize(9).fillColor(C.muted).text(cl);
  doc.moveDown(0.5);
  rule(doc);
  doc.moveDown(1);

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.font("Helvetica").fontSize(10.5).fillColor(C.ink).text(date);
  if (company) doc.text(clean(company));
  doc.moveDown(1.2);

  const p = { lineGap: 2.5, align: "left" as const };
  doc.text(clean(letter.salutation), p);
  doc.moveDown(0.8);
  for (const para of letter.paragraphs) {
    doc.text(clean(para), p);
    doc.moveDown(0.8);
  }
  doc.moveDown(0.4).text(clean(letter.signoff), p);
  doc.moveDown(0.3).font("Helvetica-Bold").text(clean(src.name), p);

  doc.end();
  return done;
}
