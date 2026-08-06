// Port of clawd-containers scripts/report/render.mjs — turns a leftclaw audit
// report (markdown) into the pretty self-contained HTML page. Keep the two in
// sync; this copy powers the dynamic /result/<id>.html route so newly
// completed jobs get a pretty report with no manual prettify.sh step.
import { TEMPLATE } from "./template";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { marked } = require("./marked.umd.js") as typeof import("./marked.umd");

const SEVS = ["Critical", "High", "Medium", "Low", "Info"] as const;
type Sev = (typeof SEVS)[number];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderAuditReport(opts: { jobId: string; md: string; ipfsUrl: string }): {
  html: string;
  totalFindings: number;
} {
  let md = opts.md;

  // Printout cleanup: if the doc opens with plain prose (leaked agent
  // monologue) rather than a heading or blockquote preamble, start at the
  // first heading. The canonical IPFS copy is linked and unchanged.
  if (!/^\s*(#|>)/.test(md)) {
    const i = md.search(/^#{1,2}\s/m);
    if (i > 0) md = md.slice(i);
  }

  // Title: first h1. Masthead already says "Smart Contract Audit" — strip
  // redundant prefixes/emoji.
  const titleMatch = md.match(/^#\s+(.+)$/m);
  let title = titleMatch ? titleMatch[1].trim() : `Audit Report — Job #${opts.jobId}`;
  const AUDIT_WORDS =
    /Security\s+(?:Audit|Review)(?:\s+Report)?|Smart\s+Contract\s+Audit(?:\s+Report)?|Unified\s+(?:Two-Phase\s+)?Security\s+Audit/;
  title = title
    .replace(/^[\p{Extended_Pictographic}️\s]+/u, "")
    .replace(new RegExp(`^(?:${AUDIT_WORDS.source})\\s*[—–:-]\\s*`, "i"), "")
    .replace(new RegExp(`\\s*[—–:-]\\s*(?:${AUDIT_WORDS.source})$`, "i"), "");

  const counts: Record<Sev, number> = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
  const norm = (raw: string) =>
    (/^info/i.test(raw) ? "Info" : raw[0].toUpperCase() + raw.slice(1).toLowerCase()) as Sev;

  // Preferred signal: the report's own tally line, e.g.
  //   **Severity counts:** 1 Critical · 3 High · 11 Medium · 14 Low · 12 Informational
  // The host auditor writes "tally" rather than "counts", and the colon sits
  // inside or outside the bold depending on the writer. Authoritative when
  // present, and immune to the per-finding prose drift below. A trailing
  // non-severity bucket ("9 Leads") simply doesn't match.
  const tally = md.match(
    /\*\*Severity (?:counts|tally)\b:?\*\*:?\s*([^\n]+)|\*\*Severity (?:counts|tally)\b:?\s*([^*\n]+)\*\*/i,
  );
  if (tally) {
    for (const m of (tally[1] || tally[2] || "").matchAll(
      /(\d+)\s*(Critical|High|Medium|Low|Informational|Info)\b/gi,
    )) {
      counts[norm(m[2])] += Number(m[1]);
    }
  }

  // Per-finding lines. Formats vary: "**Severity**: X", "**Severity:** X",
  // "**Severity: X**", "**Severity.** X rather than Y" (period, value outside
  // the bold), and "Severity: **X**" (plain label, bolded value).
  const SEV_RE =
    /\*\*Severity[:.]?\*\*[:.]?\s*(Critical|High|Medium|Low|Informational|Info)\b|\*\*Severity:\s*(Critical|High|Medium|Low|Informational|Info)\*\*|(?:^|[^*])Severity:\s*\*\*(Critical|High|Medium|Low|Informational|Info)\*\*/gi;
  if (Object.values(counts).every(n => n === 0)) {
    for (const m of md.matchAll(SEV_RE)) counts[norm(m[1] || m[2] || m[3])]++;
  }

  // Structural fallback: findings whose heading tags severity in the id, e.g.
  // "### [C-1] …". More reliable than prose when a report writes
  // "**Severity rationale.** Rated High rather than Critical" — which names two
  // severities and belongs to neither counter above.
  if (Object.values(counts).every(n => n === 0)) {
    const BY_ID: Record<string, Sev> = { C: "Critical", H: "High", M: "Medium", L: "Low", I: "Info" };
    for (const m of md.matchAll(/^#{2,4}\s*\[([CHMLI])-\d+\]/gm)) counts[BY_ID[m[1]]]++;
  }

  // breaks:true — the reports use single newlines for metadata line blocks.
  marked.setOptions({ gfm: true, breaks: true });
  let body = marked.parse(md);

  // Sanitize: the auditor's output quotes strings from untrusted repos — strip
  // anything that could execute on our domain. (The dynamic route also sends a
  // no-script CSP as defense in depth.)
  body = body
    .replace(/<\s*(script|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|form)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*(?:(['"]).*?\1|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"');

  // Heading anchors (h2/h3) + TOC of h2s.
  const slugCounts: Record<string, number> = {};
  const slugify = (t: string) => {
    const s =
      t
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z#0-9]+;/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 64) || "section";
    slugCounts[s] = (slugCounts[s] || 0) + 1;
    return slugCounts[s] > 1 ? `${s}-${slugCounts[s]}` : s;
  };
  const tocItems: { id: string; text: string }[] = [];
  body = body.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const id = slugify(inner);
    if (lvl === "2") tocItems.push({ id, text: inner.replace(/<[^>]+>/g, "") });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  let toc = "";
  if (tocItems.length >= 3) {
    // Two explicit halves instead of CSS columns (which mis-render wrapped items in Chrome).
    const li = (t: { id: string; text: string }) => `      <li><a href="#${t.id}">${t.text}</a></li>`;
    const half = Math.ceil(tocItems.length / 2);
    const cols = [tocItems.slice(0, half), tocItems.slice(half)]
      .filter(c => c.length)
      .map((c, i) => `    <ol${i ? ` start="${half + 1}"` : ""}>\n${c.map(li).join("\n")}\n    </ol>`)
      .join("\n");
    toc = `<nav class="toc">\n    <div class="toc-title">Contents</div>\n    <div class="toc-cols">\n${cols}\n    </div>\n  </nav>`;
  }

  // Severity pills — inside table cells and after "**Severity**:" labels.
  const pill = (s: string) => {
    const k = /^info/i.test(s) ? "info" : s.toLowerCase();
    const label = k === "info" ? "Info" : k[0].toUpperCase() + k.slice(1);
    return `<span class="pill ${k}">${label}</span>`;
  };
  body = body.replace(
    /<td>(Critical|High|Medium|Low|Informational|Info)<\/td>/gi,
    (_, s) => `<td>${pill(s)}</td>`,
  );
  body = body.replace(
    /(<strong>Severity[:.]?<\/strong>[:.]?\s*)(Critical|High|Medium|Low|Informational|Info)\b/gi,
    (_, pre, s) => `${pre}${pill(s)}`,
  );
  body = body.replace(
    /<strong>Severity:\s*(Critical|High|Medium|Low|Informational|Info)<\/strong>/gi,
    (_, s) => `<strong>Severity:</strong> ${pill(s)}`,
  );

  // Severity strip: prefer per-finding "**Severity**:" lines; fall back to
  // counting severity cells in the findings-summary table.
  if (Object.values(counts).every(n => n === 0)) {
    for (const m of body.matchAll(/<td><span class="pill (critical|high|medium|low|info)">/g)) {
      const k = (m[1] === "info" ? "Info" : m[1][0].toUpperCase() + m[1].slice(1)) as Sev;
      counts[k]++;
    }
  }
  const totalFindings = Object.values(counts).reduce((a, b) => a + b, 0);
  let sevStrip = "";
  if (totalFindings > 0) {
    const cards = SEVS.filter(s => counts[s] > 0)
      .map(
        s =>
          `<div class="sev-card ${s.toLowerCase()}"><div class="n">${counts[s]}</div><div class="l">${s}</div></div>`,
      )
      .join("\n      ");
    sevStrip = `<div class="sev-strip">\n      ${cards}\n    </div>`;
  }

  // Wrap tables for horizontal scroll on small screens.
  body = body.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

  const now = new Date().toISOString().slice(0, 10);
  const html = TEMPLATE.replaceAll("{{TITLE}}", esc(title))
    .replaceAll("{{JOB_ID}}", esc(String(opts.jobId)))
    .replaceAll("{{JOB_URL}}", esc(`https://leftclaw.services/jobs/${opts.jobId}`))
    .replaceAll("{{IPFS_URL}}", esc(opts.ipfsUrl))
    .replaceAll("{{GENERATED_DATE}}", now)
    .replace("{{SEVERITY_STRIP}}", sevStrip)
    .replace("{{TOC}}", toc)
    .replace("{{REPORT_BODY}}", body);

  return { html, totalFindings };
}
