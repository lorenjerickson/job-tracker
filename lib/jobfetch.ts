import "server-only";
import * as cheerio from "cheerio";

export interface FetchedJob {
  text: string;
  company: string;
  title: string;
  location: string;
  source: "structured-data" | "page-text";
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Convert an HTML fragment to readable text, keeping paragraphs and bullet lists. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $("script, style, noscript, svg, iframe, form, button").remove();
  $("br").replaceWith("\n");
  // Rich-text editors wrap list item text in <p>; flatten so each bullet stays on one line.
  $("li > p").each((_, el) => {
    $(el).replaceWith(`${$(el).html() ?? ""} `);
  });
  $("li").each((_, el) => {
    $(el).prepend("\n• ").append("\n");
  });
  $("p, div, section, article, h1, h2, h3, h4, h5, h6, ul, ol, tr, header").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return $("#__root")
    .text()
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=• )/g, "\n")
    .trim();
}

type JsonLd = Record<string, unknown>;

function findJobPosting(node: unknown): JsonLd | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  const o = node as JsonLd;
  const t = o["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return o;
  if (o["@graph"]) return findJobPosting(o["@graph"]);
  return null;
}

function ldLocation(loc: unknown): string {
  const one = (l: unknown): string => {
    const a = (l as JsonLd)?.address as JsonLd | string | undefined;
    if (!a) return "";
    if (typeof a === "string") return a;
    return [a.addressLocality, a.addressRegion, a.addressCountry]
      .map((x) => (typeof x === "object" && x ? (x as JsonLd).name : x))
      .filter(Boolean)
      .join(", ");
  };
  if (Array.isArray(loc)) return loc.map(one).filter(Boolean).join(" / ");
  return one(loc);
}

export async function fetchJob(rawUrl: string): Promise<FetchedJob> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) links are supported.");

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The site responded with ${res.status}. Try pasting the job description instead.`);
  const html = (await res.text()).slice(0, 5_000_000);
  const $ = cheerio.load(html);

  // 1) Structured data: most ATSs (Greenhouse, Lever, Workday, Ashby, iCIMS...) embed schema.org JobPosting.
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const job = findJobPosting(JSON.parse($(el).text()));
      if (job && typeof job.description === "string") {
        // Some sites HTML-escape the description inside JSON-LD (&lt;p&gt;…); unescape before converting.
        const desc = /&lt;\/?[a-z]/i.test(job.description) ? cheerio.load(job.description).root().text() : job.description;
        const text = htmlToText(desc);
        if (text.length > 200) {
          const org = job.hiringOrganization as JsonLd | string | undefined;
          const title = String(job.title ?? "");
          return {
            text: title ? `${title}\n\n${text}` : text,
            title,
            company: typeof org === "string" ? org : String(org?.name ?? ""),
            location: ldLocation(job.jobLocation) || (job.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
            source: "structured-data",
          };
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // 2) Known containers, then generic main content.
  const selectors = [
    ".show-more-less-html__markup", // LinkedIn public job page
    "#jobDescriptionText", // Indeed
    ".posting-page", // Lever
    "#content .job__description, #content", // Greenhouse
    '[data-automation-id="jobPostingDescription"]', // Workday
    "main",
    "article",
    '[role="main"]',
    "body",
  ];
  $("script, style, noscript, nav, footer, header, aside").remove();
  let text = "";
  for (const sel of selectors) {
    const node = $(sel).first();
    if (node.length) {
      text = htmlToText(node.html() ?? "");
      if (text.length > 400) break;
    }
  }
  if (text.length < 300) {
    throw new Error(
      "Couldn't read a job description from that page (it may require JavaScript or a login). Paste the description text instead.",
    );
  }
  const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text();
  return {
    text: text.slice(0, 40_000),
    title: (ogTitle || "").trim().slice(0, 200),
    company: ($('meta[property="og:site_name"]').attr("content") || "").trim(),
    location: "",
    source: "page-text",
  };
}
