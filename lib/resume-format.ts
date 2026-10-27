// Pure helpers for presenting a parsed resume (safe to import on the client or the server).
import type { ParsedResume, TailoredResume } from "./types";

/** Treat an untailored resume as a "tailored" one that keeps everything as-is. */
export function asTailored(r: ParsedResume): TailoredResume {
  return {
    headline: r.headline,
    summary: r.summary,
    skills: r.skills,
    experience: r.experience.map((e, i) => ({
      source_index: i,
      condensed: false,
      bullets: e.bullets.map((text, j) => ({ text, source_ids: [`${i}.${j}`] })),
    })),
    notes: "",
  };
}

const esc = (s: string) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const join = (parts: (string | undefined)[], sep: string) => parts.filter((p) => p && p.trim()).map((p) => esc(p!)).join(sep);

/**
 * Starting document for the rich-text editor, built from the structured resume
 * (so PDF and Word uploads open in the same clean, conventional layout).
 */
export function parsedToHtml(r: ParsedResume): string {
  const out: string[] = [];
  out.push(`<h1 style="text-align: center">${esc(r.name)}</h1>`);
  if (r.headline) out.push(`<p style="text-align: center"><strong>${esc(r.headline)}</strong></p>`);
  const contact = join([r.contact.email, r.contact.phone, r.contact.location, ...r.contact.links], " | ");
  if (contact) out.push(`<p style="text-align: center">${contact}</p>`);

  if (r.summary) out.push(`<h2>Summary</h2>`, `<p>${esc(r.summary)}</p>`);

  if (r.skills.length) {
    out.push(`<h2>Skills</h2>`);
    for (const g of r.skills) out.push(`<p><strong>${esc(g.category)}:</strong> ${join(g.items, ", ")}</p>`);
  }

  if (r.experience.length) {
    out.push(`<h2>Experience</h2>`);
    for (const e of r.experience) {
      out.push(`<h3>${join([e.title, e.company], " — ")}</h3>`);
      const meta = join([e.location, join([e.start, e.end], " – ")], " | ");
      if (meta) out.push(`<p><em>${meta}</em></p>`);
      if (e.bullets.length) out.push(`<ul>${e.bullets.map((b) => `<li><p>${esc(b)}</p></li>`).join("")}</ul>`);
    }
  }

  if (r.education.length) {
    out.push(`<h2>Education</h2>`);
    for (const ed of r.education) {
      const line = join([ed.degree, ed.institution, ed.year], ", ");
      out.push(`<p>${line}${ed.details ? ` — ${esc(ed.details)}` : ""}</p>`);
    }
  }

  if (r.certifications.length) {
    out.push(`<h2>Certifications</h2>`, `<ul>${r.certifications.map((c) => `<li><p>${esc(c)}</p></li>`).join("")}</ul>`);
  }

  for (const o of r.other) {
    if (!o.items.length) continue;
    out.push(`<h2>${esc(o.heading)}</h2>`, `<ul>${o.items.map((i) => `<li><p>${esc(i)}</p></li>`).join("")}</ul>`);
  }
  return out.join("\n");
}
