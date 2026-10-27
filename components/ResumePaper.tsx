import type { ParsedResume, TailoredResume } from "@/lib/types";

export { asTailored } from "@/lib/resume-format";

const dates = (s: string, e: string) => [s, e].filter(Boolean).join(" – ");

/** HTML preview that mirrors the PDF layout. */
export default function ResumePaper({ src, t }: { src: ParsedResume; t: TailoredResume }) {
  const visible = t.experience.filter((r) => !r.hidden && src.experience[r.source_index]);
  const full = visible.filter((r) => !r.condensed);
  const condensed = visible.filter((r) => r.condensed);
  const contact = [src.contact.email, src.contact.phone, src.contact.location, ...src.contact.links].filter(Boolean).join("  |  ");
  return (
    <div className="paper">
      <h1>{src.name}</h1>
      {(t.headline || src.headline) && <div className="headline">{t.headline || src.headline}</div>}
      {contact && <div className="contact">{contact}</div>}
      {t.summary && (
        <>
          <h4>Summary</h4>
          <p>{t.summary}</p>
        </>
      )}
      {t.skills.length > 0 && (
        <>
          <h4>Core Skills</h4>
          {t.skills.map((g, i) => (
            <p key={i} style={{ marginBottom: 3 }}>
              <b>{g.category}:</b> {g.items.join(", ")}
            </p>
          ))}
        </>
      )}
      {full.length > 0 && <h4>Experience</h4>}
      {full.map((r) => {
        const e = src.experience[r.source_index];
        return (
          <div key={r.source_index}>
            <div className="role-head">
              <span>{e.title}</span>
              <span className="dates">{dates(e.start, e.end)}</span>
            </div>
            <div className="role-sub">
              <span>{e.company}</span>
              <span>{e.location}</span>
            </div>
            {r.bullets.length > 0 && (
              <ul>
                {r.bullets.map((b, i) => (
                  <li key={i}>{b.text}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {condensed.length > 0 && <h4>{full.length ? "Earlier Experience" : "Experience"}</h4>}
      {condensed.map((r) => {
        const e = src.experience[r.source_index];
        return (
          <div key={r.source_index} className="role-head" style={{ fontWeight: 400, marginTop: 3 }}>
            <span>
              {e.title}, {e.company}
            </span>
            <span className="dates">{dates(e.start, e.end)}</span>
          </div>
        );
      })}
      {src.education.length > 0 && <h4>Education</h4>}
      {src.education.map((ed, i) => (
        <div key={i} className="role-head" style={{ fontWeight: 400, marginTop: 3 }}>
          <span>
            {[ed.degree, ed.institution].filter(Boolean).join(", ")}
            {ed.details && <span style={{ color: "#4b5563" }}> — {ed.details}</span>}
          </span>
          <span className="dates">{ed.year}</span>
        </div>
      ))}
      {src.certifications.length > 0 && (
        <>
          <h4>Certifications</h4>
          <ul>
            {src.certifications.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {src.other
        .filter((o) => o.items.length)
        .map((o, i) => (
          <div key={i}>
            <h4>{o.heading}</h4>
            <ul>
              {o.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
