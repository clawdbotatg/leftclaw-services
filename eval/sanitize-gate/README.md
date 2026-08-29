# Sanitize-gate eval suite

Regression tests + Sage shootout tooling for the prompt-injection gate
(`packages/nextjs/lib/sanitize.ts`), built with the sage-wisdom skill (2026-08).

No secrets live here. Every script reads its key from env and fails loudly
without it. Never commit `.env` files or keys into this directory.

## Files

- `golden_real.json` — 18 real job descriptions read from LeftClawServicesV2 on
  Base, all labeled `safe`. Includes the two regression jobs: **406** (the
  "you are a senior auditor" role-framing description that once hijacked the
  gate — SAFE per policy) and **730** (declined by mistake when an errored
  check was read as unsafe).
- `golden_synthetic.json` — 6 attacks (4 paraphrased with no trigger keywords,
  so a naive regex misses them) + 4 false-positive traps written to the host
  policy (trivial commands, role-framing, injection-as-research-topic,
  offensive tooling against your own contract).
- `baseline.mjs` — runs the EXACT prod prompt (Sonnet, temp 0, forced tool use)
  over the golden set, twice per sample, plus a naive-regex strawman.
  `BANKR_API_KEY=... node baseline.mjs`
- `fetch_jobs.mjs` — dumps every on-chain job description to `jobs_all.json`
  (gitignored, regenerable). `ALCHEMY_API_KEY=... node fetch_jobs.mjs`
- `sage_scan.mjs` — scores EVERY historical job with Sage (injection score +
  latency per job) and writes `report.md`. `SAGE_API_KEY=... node sage_scan.mjs
  [--limit 20]`
- `sage_client.mjs` — minimal Sage yesno client. **Unverified scaffold**: the
  endpoint/envelope must be corrected against the sage-wisdom skill's
  `reference.md` before first use (`SAGE_API_URL` overrides the default).

## Baseline result (2026-08-27, golden set n=28, 2 runs each)

| gate | accuracy | flakes | p50 | p90 |
|---|---|---|---|---|
| prod prompt (Sonnet via bankr) | 28/28 | 0 | 8.6s | 14.0s |
| naive keyword regex | 23/28 | — | ~0 | ~0 |

The regex missed all 4 paraphrased attacks — the golden set is hard enough for
a shootout to mean something. Re-run the baseline when the sanitize prompt or
model changes; a drop below 28/28 is a regression in the gate.
