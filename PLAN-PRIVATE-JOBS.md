# Plan — Private (VIP) Jobs

**Status:** proposed (no code yet)
**Date:** 2026-07-16
**Companion docs:** [`PRIVACY_AUDIT.md`](PRIVACY_AUDIT.md) (why jobs are public today),
[`PRIVACY_TODO.md`](PRIVACY_TODO.md) (P1/P2 remediation this plan builds on).

## Goal

A premium tier where a job's **content is not publicly readable**: the request
text, the deliverable, and content-derived progress notes are visible only to
the client (and the assigned worker) — not to anyone walking the chain or the
API.

## Why jobs are public today (recap)

The P0 API leaks are fixed (see `PRIVACY_TODO.md`). What remains is structural:
the `Job` struct in `LeftClawServicesV2.sol` stores `description`, `resultCID`,
and work-log notes as plaintext contract storage. Anyone with an RPC can loop
`getJob(1..nextJobId)` or call `getJobsByClient(wallet)` — no frontend
involved. For build/audit/research jobs, the request and the finished
deliverable's IPFS link are public records **by design** (audit finding F9).

## The precedent: consults already are private jobs

The consult flow (`lib/postJobFor.ts`, service types 1 & 2) already implements
~80% of the pattern:

- **On-chain description is a placeholder** (`ON_CHAIN_PLACEHOLDER`); the real
  prompt is saved to Redis (`saveConsultPrompt`) behind owner-gated reads.
- **x402-paid jobs hide the buyer entirely**: the sanitizer wallet posts the
  job as itself, so the client's address never appears on-chain; ownership is
  tracked by the unguessable `x402_<nanoid>` session (the Tier-3 model).

A private job = that pattern, generalized to any service type, plus a private
deliverable path.

## Design

### Phase 0 — prerequisite: P1 auth redesign (F6/F7)

Read auth today is a signature over a fixed string, passed in URL query params —
a permanent, unrevocable bearer token that lands in access logs. A private tier
gated by that is private in name only. **Ship the windowed-sig-in-header
migration first** (fully specced in `PRIVACY_TODO.md` P1). ~1 day.

### Phase 1 — `private: true` jobs (no contract change)

1. **Flag.** Job creation (x402 routes and/or wallet-pay UI) accepts a
   `private` flag. Generalize `PRIVATE_PROMPT_SERVICE_TYPES` in
   `lib/postJobFor.ts` into "per-service-type default OR per-job flag."
2. **Description.** When private: post `ON_CHAIN_PLACEHOLDER` on-chain, save
   the real description via the existing consult-prompt machinery (owner +
   assigned-worker gated). The worker fetches the real prompt through its
   gated endpoint (windowed worker sig), never from chain.
3. **Deliverable.** `completeJob` requires a non-empty `resultCID`, so the
   worker submits a sentinel (e.g. `"private"`) on-chain and writes the real
   deliverable pointer to owner-gated KV (`jobResult:<contract>:<jobId>` or,
   better, keyed by an unguessable per-job handle — see 5). A gated
   `GET /api/job/[id]/result` returns it to `caller == job.client` (or
   assigned worker). Pretty HTML reports (`/result/<id>.html`) must NOT be
   generated for private jobs — or must live behind the same gate.
4. **Sanitizer.** Already runs on the real off-chain prompt for consults —
   same for private jobs. The `tldr` stays in KV (post-F1/F5 behavior);
   nothing content-derived is echoed publicly.
5. **KV keying.** New private-job KV records get an **unguessable handle**
   (`nanoid`, Tier-3 model) minted at creation and stored in the job's gated
   metadata, instead of relying on sequential jobId + per-route checks. A
   future route bug then can't re-open enumeration.

### Phase 2 — worker discretion (fleet-side, prompt changes)

`addWorkLog` notes are public on-chain. For private jobs the worker
(clawd-containers auditor/builder prompts) must:

- post only generic stage notes on-chain ("stage 2/5 complete"), and
- keep anything content-derived in the gated job chat / KV.

The worker learns a job is private from the gated job metadata it already
fetches. No contract change.

### Phase 3 (optional) — encrypted-at-rest deliverables

Phase 1's trust model is "trust the server" (same as consult prompts today).
If buyers want stronger guarantees: upload the deliverable **encrypted** to
IPFS, put the ciphertext CID on-chain (satisfies `completeJob`), and deliver
the key via the gated layer. Key delivery to a bare wallet address is the
awkward part (no encryption pubkey without a signing ritual) — that's why this
is a separate phase, only if demand shows up.

## What still leaks (accepted)

- The job's **existence**: a row with `serviceTypeId`, price, and timestamps.
  An observer sees "a private audit for $X happened Tuesday" — not what, for
  whom (if paid via x402), or the result.
- Hiding existence too would need a V3 contract or a fully off-chain job book
  for VIP. Not worth it for now; revisit only if a customer asks.

## Client anonymity note

- **x402-paid private jobs:** buyer address never on-chain (sanitizer posts).
  This is the natural "VIP" flow.
- **Wallet-paid private jobs:** the client address is necessarily on-chain.
  Content is still private; identity linkage is not. Document this in the UI.

## Productization

- Premium price via the x402 routes (`?private=1` param or dedicated
  `/api/audit/private`-style endpoints). Content pipeline is identical apart
  from the flag.
- The manual pretty-report step (`prettify.sh` in clawd-containers) needs a
  private-aware branch: skip publishing, or render behind the gate.

## Effort

| Phase | Work | Size |
|-------|------|------|
| 0 | P1 windowed-auth migration (prereq) | ~1 day |
| 1 | Private flag + off-chain description/result + gated result route + nanoid KV handles | ~1–2 days |
| 2 | Worker prompt updates (clawd-containers) | hours |
| 3 | Encrypted deliverables | later, if demanded |

Total for the credible version (0–2): **~3 days**, no contract redeploy.
