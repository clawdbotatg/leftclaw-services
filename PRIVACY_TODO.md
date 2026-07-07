# Privacy remediation — TODO

Actionable follow-ups from [`PRIVACY_AUDIT.md`](PRIVACY_AUDIT.md). The **P0 active
leaks are all fixed and live** (verified with real requests against prod). What
remains is the auth-scheme redesign (P1) and design-level confidentiality (P2),
plus minor hygiene items.

## ✅ Done (P0 — shipped & verified on prod, 2026-07-07)

| # | What | Commit |
|---|------|--------|
| F1 | `/api/job/summaries` gated to owner/worker signature | `c154bf0` |
| F2 | `/api/job/plan-count` requires owner sig (`caller == job.client`); `cv-*` pass through | `c154bf0` |
| F5 | `/api/job/sanitize` GET+POST no longer echo content-derived `reason`/`tldr` | `c154bf0` |
| F3 | `/api/job/pipeline` scoped to `job.worker == caller` (owner sees all); `/ready` stays broad | `a265567` |
| F4 | `/api/job/consult-complete` GET+POST derive address from verified signature | `a85ae18` |
| F8 | `/api/gist` requires owner sig for on-chain jobs (`caller == job.client`); `cv-*` pass through | `a85ae18` |

All six use the existing **static** auth-sig pattern (`verifyAuthSignature` +
on-chain ownership), matching the already-safe `/consult-prompt` route. The F6/F7
migration below intentionally sweeps them all to the windowed scheme at once.

---

## ☐ P1 — F6/F7: replace the static-sig-in-URL bearer token (HIGH)

**Problem.** Read-auth is a signature over a *fixed* string (`"LeftClaw Services
Auth"`), cached in `localStorage` for 7 days and sent as `?address=…&sig=…` in the
URL query. That's a permanent, unrevocable bearer token that leaks via server/CDN
access logs, browser history, and `Referer` headers (F7). No nonce/timestamp means
a captured value works forever and can't be revoked without changing the signed
string for everyone (F6).

**Target.** The **windowed** signature already used by the write paths
(`lib/workerAuth.ts` `verifyWindowedSig`, `/api/job/[id]/chat`): a 5-minute
time-windowed message, verified against the current + previous window, sent in a
**header** (or POST body), not the URL. Bind to the resource where practical.

**Work items:**
- [ ] Add a read-auth message helper, e.g. `readAuthMessage(window) = "LeftClaw Read - <window>"` (and a resource-bound variant `… - Job #<id> - <window>` where a jobId is in scope), alongside the existing `workerAuthMessage`.
- [ ] Server: switch every gated read to verify the windowed sig from a header (e.g. `x-leftclaw-address` / `x-leftclaw-sig`) instead of `verifyAuthSignature` over query params. Routes to migrate: `summaries`, `plan-count`, `sanitize` (owner path), `consult-complete`, `gist` (job path), `[id]/messages`, `[id]/consult-prompt`, `save-consult-prompt`. Keep accepting the old static sig for one deploy window to avoid breaking in-flight cached signatures, then remove it.
- [ ] Client: replace the cached static sig with an on-demand windowed sign. Update `utils/authSignatureCache.ts` (shorten TTL to minutes / re-sign on expiry) and every caller that currently builds `?address=&sig=` (`X402ChatClient.tsx`, `JobDetailClient.tsx`, `JobChatPanel.tsx`, `X402JobClient.tsx`, `ChatClient.tsx`, `admin/page.tsx`, `page.tsx`) to send the header instead.
- [ ] Move `address`/`sig` out of URLs everywhere (stop them landing in logs/history).
- [ ] Verify: old cached static sigs stop working after the compat window; windowed sigs from the current + previous window are accepted; nothing auth-gated appears in a request URL.

> ⚠️ Coordinated migration — touches the client and every gated read together.
> Write the plan first (message format, header names, compat/rollout window) and
> get sign-off before editing, since it changes the app-wide auth model.

---

## ☐ P2 — F9: on-chain deliverables & work logs are public (MEDIUM, design)

`resultCID` (the finished deliverable's IPFS link) and work-log notes are stored as
plaintext in contract storage — anyone enumerating jobs can fetch the deliverable
and read every progress note. For services sold with a privacy expectation
(research reports, audits) this is a design gap, not a code bug.

- [ ] Decide: encrypt deliverables at rest (client-held key, store only an encrypted-blob CID) **or** move deliverable links to the ownership-gated KV layer instead of an on-chain field.
- [ ] For new job-scoped KV, prefer unguessable ids (the Tier-3 `x402_<nanoid>` model) over sequential jobId + per-route checks.

> Contract/flow change — not a quick patch. Needs a design decision first.

---

## ☐ F10 — minor hygiene (LOW)

- [ ] **Dead admin allowlist** — `app/admin/page.tsx` compares a lowercased address against a checksummed `ADMIN_ADDRESSES`, so `isAdmin` is always false. Lowercase both sides so the allowlist works as intended.
- [ ] **Alchemy key in client bundle** — `NEXT_PUBLIC_ALCHEMY_API_KEY` ships to the browser. Consider a server-proxied RPC or a domain-restricted key (cost/abuse, not privacy).
- [ ] **Enumerable PFP results** — `GET /api/pfp/result/[jobId]` serves the generated PNG by sequential jobId with no auth. Low sensitivity; note it's enumerable.
- [ ] **Public skill docs** — `app/admin/skill/**` serve the worker bot's playbook + API surface unauthenticated. Intended, flagged as a conscious choice.

---

## Also fixed along the way (not audit findings)

- [ ] ~~Public-RPC fallbacks~~ — removed the hardcoded `https://mainnet.base.org` fallback in `pipeline`/`ready` and gave `lib/authSignature.ts` the Alchemy fallback (was defaulting to viem's public RPC). Done in `a265567` / `c154bf0`.
