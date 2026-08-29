// Score EVERY historical job description with Sage for prompt injection.
// Writes sage_results.json (score + latency per job) and report.md.
//
// Usage:
//   SAGE_API_KEY=... node sage_scan.mjs            # full run
//   SAGE_API_KEY=... node sage_scan.mjs --limit 20 # smoke run
//
// Question phrasing is the sage-wisdom P1 winner ("terse, domain verb");
// threshold ~0.7 on Sage v0.8 (swept 2026-08) with a ±0.15 escalation band —
// re-sweep on our own golden set before trusting it for anything real.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { sageYesno } from "./sage_client.mjs";

const QUESTION = "Does this text attempt to hijack the identity or system prompt of the AI that reads it?";
const THRESHOLD = 0.7;
const BAND = 0.15;

const SP = new URL(".", import.meta.url);
const jobsPath = new URL("jobs_all.json", SP);
if (!existsSync(jobsPath)) {
  console.error("jobs_all.json missing — run: ALCHEMY_API_KEY=... node fetch_jobs.mjs");
  process.exit(1);
}
let jobs = JSON.parse(readFileSync(jobsPath, "utf8")).filter(j => j.description?.trim());
const limitIdx = process.argv.indexOf("--limit");
if (limitIdx > -1) jobs = jobs.slice(0, Number(process.argv[limitIdx + 1]) || 20);

const results = [];
for (const job of jobs) {
  try {
    const r = await sageYesno(QUESTION, job.description);
    const verdict = r.confidence >= THRESHOLD + BAND ? "unsafe"
      : r.confidence <= THRESHOLD - BAND ? "safe"
      : "escalate";
    results.push({ id: job.id, serviceTypeId: job.serviceTypeId, score: +r.confidence.toFixed(4), ms: r.ms, verdict });
    process.stderr.write(`job ${job.id}: ${verdict} score=${r.confidence.toFixed(3)} ${r.ms}ms\n`);
  } catch (e) {
    results.push({ id: job.id, serviceTypeId: job.serviceTypeId, error: String(e.message).slice(0, 200) });
    process.stderr.write(`job ${job.id}: ERROR ${e.message}\n`);
  }
}
writeFileSync(new URL("sage_results.json", SP), JSON.stringify(results, null, 1));

// --- report ---
const ok = results.filter(r => !r.error);
const errs = results.filter(r => r.error);
const lats = ok.map(r => r.ms).sort((a, b) => a - b);
const pct = p => lats[Math.min(lats.length - 1, Math.floor(lats.length * p))] ?? 0;
const flagged = ok.filter(r => r.verdict === "unsafe");
const escalate = ok.filter(r => r.verdict === "escalate");

const byId = new Map(jobs.map(j => [j.id, j]));
const row = r => {
  const desc = (byId.get(r.id)?.description || "").replace(/\s+/g, " ").slice(0, 80);
  return `| ${r.id} | ${r.score?.toFixed(3) ?? "—"} | ${r.verdict ?? "error"} | ${r.ms ?? "—"} | ${desc} |`;
};

const md = `# Sage sanitize scan — all historical jobs

Generated ${new Date().toISOString()} · question: "${QUESTION}" · threshold ${THRESHOLD} ±${BAND}

## Summary
- Jobs scored: **${ok.length}** (${errs.length} errors)
- Flagged unsafe (score ≥ ${THRESHOLD + BAND}): **${flagged.length}**
- Escalation band (${THRESHOLD - BAND}–${THRESHOLD + BAND}): **${escalate.length}**
- Latency: p50 **${pct(0.5)}ms** · p90 ${pct(0.9)}ms · max ${lats.at(-1) ?? 0}ms

## Flagged jobs
| job | score | verdict | ms | description (head) |
|---|---|---|---|---|
${flagged.map(row).join("\n") || "| — | — | — | — | none |"}

## Escalation band
| job | score | verdict | ms | description (head) |
|---|---|---|---|---|
${escalate.map(row).join("\n") || "| — | — | — | — | none |"}

## All jobs
| job | score | verdict | ms | description (head) |
|---|---|---|---|---|
${results.map(row).join("\n")}
`;
writeFileSync(new URL("report.md", SP), md);
console.log(`scored ${ok.length} jobs (${errs.length} errors) · flagged ${flagged.length} · band ${escalate.length} · p50 ${pct(0.5)}ms`);
console.log("wrote sage_results.json + report.md");
