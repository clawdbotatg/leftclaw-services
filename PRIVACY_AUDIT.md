# LeftClaw Services — Privacy & Access-Control Audit

**Scope:** Confidentiality and authorization of per-user job data — consultations, builds, audits, research reports, PFP jobs, chat — across the on-chain contract, the Next.js API, and the browser client.
**Repo:** `github.com/clawdbotatg/leftclaw-services`
**Commit audited:** `32199eb`
**Date:** 2026-06-18
**Method:** Source review of `LeftClawServicesV2.sol`, every route under `packages/nextjs/app/api/`, the KV/store layer (`packages/nextjs/lib/`), and the browser client.

> This is a **privacy/access-control** audit. It is distinct from `AUDIT_REPORT.md`, which is the
> contract-level security audit (escrow, reentrancy, swaps). Where they overlap, this report only
> covers the data-confidentiality angle.

---

## TL;DR

The original concern — *"I think in the past we were able to enumerate through people's jobs"* — is **correct and still live.** Job IDs are sequential integers, and several endpoints return per-job content **with no authentication at all**, so anyone can walk `1, 2, 3, …` and read across every user's jobs.

The single worst issue: **`GET /api/job/summaries` has zero auth** and returns an AI-generated one-line summary (`tldr`) of each job — *including consultations, whose prompts are deliberately kept off-chain because they're private.* So the one category of genuinely-confidential content leaks, in summary form, to anyone with `curl`.

Underneath that, the read-auth scheme is a **static, never-changing signature passed in the URL query string** — effectively a permanent bearer token that lands in server logs and browser history.

| # | Finding | Severity | Auth today |
|---|---------|----------|------------|
| F1 | `GET /api/job/summaries` leaks every job's summary (incl. private consult prompts) | **Critical** | None |
| F2 | `GET /api/job/plan-count` leaks build-plan gist URL + description | **High** | None |
| F3 | `GET /api/job/pipeline` & `/api/job/ready` return *all* clients' jobs to *any* worker | **High** | Worker sig, not owner-scoped |
| F4 | `POST /api/job/consult-complete` mutates state for an attacker-supplied address | **Medium** | None |
| F5 | `GET /api/job/sanitize` leaks per-job safety verdict/reason | **Medium** | None |
| F6 | Static `"LeftClaw Services Auth"` signature = permanent, unrevocable bearer token | **High** | — |
| F7 | That signature is transmitted in URL query params on all GET reads | **High** | — |
| F8 | `POST /api/gist` authorizes on "has any jobId" — lets anyone create org gists / poison a job's plan pointer | **Medium** | Weak |
| F9 | Job deliverables (`resultCID`) and work logs are public on-chain — research reports etc. sit on open IPFS | **Medium** | By design |
| F10 | Minor: dead admin allowlist, Alchemy key in client bundle, enumerable PFP results | **Low** | — |

**Correctly gated (no action needed):** `GET/POST /api/job/[id]/messages`, `GET /api/job/[id]/consult-prompt`, `POST /api/job/save-consult-prompt`, `GET /api/session/[sessionId]`, `POST /api/job/[id]/chat`, the x402 session reads (unguessable IDs), and the cron endpoints (bearer-gated).

---

## 1. Data model — what is actually private?

There are **three tiers** of data, and the privacy story is different for each. Getting this distinction right is the whole point of the audit.

### Tier 1 — Public on-chain, by design (cannot be hidden without a contract change)

`LeftClawServicesV2.Job` stores these as plaintext in contract storage, readable by **anyone** via a direct RPC call to `getJob(id)` — the frontend is irrelevant:

- `client` (address), `worker` (address)
- `serviceTypeId`, `status`, `currentStage`
- `paymentClawd`, `priceUsd`, `cvAmount`, `paymentMethod`, `paymentClaimed`
- `createdAt`, `startedAt`, `completedAt`
- `description` — **for all non-consult job types** (build, audit, research, QA, judge, feature). The user's full request text is on-chain in the clear.
- `resultCID` — the **deliverable** (IPFS CID/URL of the finished build repo, audit, or research report)
- Work-log notes via `getWorkLogs(id)` — every progress note a worker posts

Enumeration here is trivial and needs no app at all: read `getTotalJobs()` / `nextJobId`, loop `1..N`, call `getJob(i)`. There is also `getJobsByClient(address)` — point it at anyone's wallet and list their entire history.

**Implication:** For builds/audits/research, the request text *and the final report link* are public records. "Research Report" privacy in particular is largely illusory — the report is fetched from public IPFS via an on-chain CID (F9).

### Tier 2 — Off-chain, intended-private, ownership-gated (mostly correct, but leaks at the edges)

For **consultations (service types 1 & 2)** the frontend deliberately does *not* put the prompt on-chain. `lib/postJobFor.ts:80-110` posts a placeholder string (`"Consult — prompt stored off-chain (private)"`) and saves the real prompt to Redis:

- `consultPrompt:<contract>:<jobId>` — the private consult prompt
- `jobmsgs:<contract>:<jobId>` — the full client ↔ PM-bot chat transcript
- `jobchat:` / `jobPlanCount:` / `jobPlanGist:` — chat + plan metadata
- `sanitize:<contract>:<jobId>` — safety verdict **plus a `tldr` summary of the prompt**

These KV records are keyed by the **sequential jobId**, so the *only* thing protecting them is the per-route auth check. The full-content reads (`/messages`, `/consult-prompt`) are correctly owner-gated. The **summary/metadata reads are not** — that's F1, F2, F5.

### Tier 3 — Truly private (unguessable identifiers)

x402 sessions (`lib/sessionStore.ts`) are keyed `x402_<nanoid(21)>`. The ID itself is the capability — not enumerable. `GET /api/session/[sessionId]` additionally verifies an ownership signature before returning the description/messages. This is the model the rest of the system should aspire to.

---

## 2. The read-auth scheme (root cause behind F6/F7)

Every owner-gated read verifies a signature over a **fixed string**:

```
lib/authSignature.ts:  AUTH_SIGN_MESSAGE = "LeftClaw Services Auth"
```

No nonce. No timestamp. No domain or resource binding. The app's own worker docs describe it as *"no nonce, long-lived — sign once and reuse."* The client signs it once, caches it in `localStorage` for 7 days (`utils/authSignatureCache.ts`, `TTL_MS = 7 days`), and replays the identical value on every request.

Two structural problems follow:

- **F6 — it's a permanent bearer token.** The signature value authenticates as that wallet for as long as the message is unchanged (i.e. forever). There is **no server-side state**, so a leaked signature **cannot be revoked** without changing the signed string for the entire user base. The 7-day client cache is irrelevant to an attacker who has captured the raw value.
- **F7 — it travels in the URL.** Every GET read sends `?address=…&sig=…` in the query string (`X402ChatClient.tsx:96,127`, `JobDetailClient.tsx`, `JobChatPanel.tsx:82`, `X402JobClient.tsx:58`). Query strings are written to Vercel/CDN/proxy access logs, browser history, and `Referer` headers. Any one of those leaks hands over indefinite read access to that wallet's private data.

Note the inconsistency: the **write** paths already do this correctly. `POST /api/job/[id]/chat` and the worker endpoints (`lib/workerAuth.ts`) use a **5-minute windowed** signature (`LeftClaw Job Chat - Job #<id> - <window>` / `LeftClaw Worker Auth - <window>`). The read paths simply never adopted that pattern.

---

## 3. Findings

### F1 — `GET /api/job/summaries` returns every job's summary, no auth — **Critical**

`app/api/job/summaries/route.ts`:

```ts
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("jobIds");          // attacker-supplied
  const ids = raw.split(",").filter(Boolean).slice(0, 200);    // up to 200 at a time
  // ...no signature, no ownership check...
  const result = await getSanitization(id);
  if (result?.tldr) summaries[id] = result.tldr;               // private summary
}
```

The `tldr` is produced by the sanitizer (`lib/sanitize.ts`), whose prompt instructs: *"Write a single-sentence summary of what the client wants built/done."* Critically, for consult jobs `lib/postJobFor.ts:106` runs `checkSanitization` on the **real off-chain prompt**, so the `tldr` is a summary of Tier-2 private content.

**Exploit:** `GET /api/job/summaries?jobIds=1,2,3,...,200` → one-line summary of every job on the platform, including consultations whose prompts were specifically kept off-chain for privacy. Zero credentials. This is the enumeration the project owner remembered.

**Fix:** Require the owner signature and return only summaries for jobs where `caller == job.client` (or assigned worker). For a batch endpoint, verify the sig once and filter the requested IDs to the caller's own jobs on-chain. Cheaper alternative: drop the batch endpoint entirely and fold the tldr into the already-gated `/api/job/[id]/messages` or `/consult-prompt` responses.

### F2 — `GET /api/job/plan-count` leaks the build-plan gist, no auth — **High**

`app/api/job/plan-count/route.ts` returns, for any `?jobId=N`:

```ts
return NextResponse.json({
  planGenerations: count,
  latestPlanGistUrl: gist?.url || null,        // GitHub gist URL of the build plan
  latestPlanDescription: gist?.description || null,
});
```

The gist is created `public: false` (a "secret" gist), but secret gists are **viewable by anyone with the URL** — there is no GitHub-side auth. Leaking the URL leaks the full plan. Enumerable by sequential jobId.

**Fix:** Gate on owner signature, same as `/consult-prompt`.

### F3 — `pipeline` / `ready` return all clients' jobs to any registered worker — **High**

`app/api/job/pipeline/route.ts` and `app/api/job/ready/route.ts` require a valid windowed worker signature **and** that the caller is in `getRegisteredWorkers()` — then return **every job across the whole platform** (loop `1..nextJobId`), not just the caller's assigned jobs. Any address ever added as a worker can enumerate all clients' job details, stages, and work logs.

This is the *exact* class of bug that was already fixed in `/api/job/[id]/messages` (see its comment: *"Previously this also allowed any registered worker, which let any builder enumerate other clients' job messages"*). The fix never propagated here.

**Caveat:** the underlying job metadata is Tier-1 public on-chain anyway, so the marginal disclosure is the *convenience* of a pre-filtered, sanitized cross-client feed rather than brand-new secret data. Still worth scoping `pipeline` to `job.worker == caller` and treating `ready` (open, unassigned jobs) as the only legitimately broad feed.

### F4 — `POST /api/job/consult-complete` trusts an attacker-supplied address — **Medium**

`app/api/job/consult-complete/route.ts`:

```ts
const { consultJobId, address } = await req.json();   // both attacker-controlled
await kv.sadd(kvKey(address), String(consultJobId));   // no signature check
```

Anyone can mark any consult "done" for any wallet, or read another wallet's done-list via the `GET`. Integrity/nuisance rather than disclosure, but it's unauthenticated state mutation keyed on a spoofable address.

**Fix:** Require the owner signature and derive `address` from the verified signer, not the body.

### F5 — `GET /api/job/sanitize` leaks per-job verdict, no auth — **Medium**

`app/api/job/sanitize/route.ts` `GET` returns `{ safe, reason }` for any `?jobId=N`. `reason` is usually generic, but for flagged jobs it can include a brief explanation derived from the content. Same no-auth/enumerable shape as F1; lower payload sensitivity.

**Fix:** Gate on owner signature, or return only a boolean the owner already knows.

### F6 — Static signature = permanent, unrevocable bearer token — **High**
### F7 — Signature transmitted in URL query params — **High**

See §2. These are the root-cause findings. Remediation (shared):

1. Switch reads to the **windowed signature** already implemented in `lib/workerAuth.ts` (`verifyWindowedSig`) — e.g. message `LeftClaw Read - <window>`, accepting the current + previous 5-minute window.
2. Bind the signature to the resource where practical (`… - Job #<id> - <window>`), as the chat POST already does.
3. Move `address`/`sig` out of the URL into an `Authorization` header or POST body for every read.
4. Shorten the client cache from 7 days to minutes; re-sign on expiry.

### F8 — `POST /api/gist` weak authorization — **Medium**

`app/api/gist/route.ts` grants access if **any** of: internal secret, an active session, *or simply that a `jobId` was supplied*:

```ts
if (!authorized && jobId) authorized = true;   // any jobId at all
```

So any caller can (a) create gists on the org `GITHUB_TOKEN`, and (b) call `saveJobPlanGist(jobId, …)` to **overwrite the stored plan-gist pointer for someone else's job**, injecting an attacker-controlled URL into that job's PM-bot context. Combined with F2, an attacker can both read and poison plan pointers.

**Fix:** Require either the internal secret or an owner signature proving `caller == job.client` for the given `jobId`.

### F9 — Deliverables & work logs are public on-chain — **Medium (design)**

`resultCID` and work-log notes are Tier-1 public (see §1). Anyone enumerating jobs gets the IPFS link to the finished deliverable and every progress note. For services sold with an implied privacy expectation (research reports, audits), this is a design-level gap, not a code bug.

**Options:** encrypt deliverables at rest (client-held key) and store only an encrypted blob CID; or move deliverable links to the Tier-2 ownership-gated KV layer instead of an on-chain field. Either is a contract/flow change, not a quick patch.

### F10 — Minor

- **Dead admin allowlist.** `app/admin/page.tsx:625` computes `isAdmin = address && ADMIN_ADDRESSES.includes(address.toLowerCase())`, but `ADMIN_ADDRESSES` holds the *checksummed* `0x34aA3F…`, so the lowercased comparison never matches. `isAdmin` is always `false`; access is effectively gated only by `isWorker`/`isOwner`. The `/admin` gate is client-side only — but it reads only public endpoints/chain data, so this is cosmetic for confidentiality. Fix the comparison (lowercase both sides) so the allowlist works as intended.
- **Alchemy key in client bundle.** `NEXT_PUBLIC_ALCHEMY_API_KEY` is shipped to the browser (standard Scaffold-ETH pattern). Cost/abuse vector, not a data-privacy one. Consider a server-proxied RPC or a domain-restricted key.
- **Enumerable PFP results.** `GET /api/pfp/result/[jobId]` serves the generated PNG by sequential jobId with no auth. PFPs are low-sensitivity (profile pictures), but note it's enumerable.
- **Public skill docs.** `app/admin/skill/**` serve the worker bot's full operational playbook + API surface unauthenticated. Intended as worker documentation; flagged only so it's a conscious choice.

---

## 4. What's correctly protected

| Route | Check | Verdict |
|-------|-------|---------|
| `GET /api/job/[id]/messages` | static sig **+** `caller == job.client \|\| assigned worker` | Owner-scoped ✓ |
| `POST /api/job/[id]/messages` | escalation-from-bot only | Limited ✓ (write side; see note) |
| `POST /api/job/[id]/chat` | **windowed** sig + `caller == job.client` | ✓ (best-practice example) |
| `GET /api/job/[id]/consult-prompt` | static sig + `caller == job.client` + consult-type | Owner-scoped ✓ |
| `POST /api/job/save-consult-prompt` | static sig + owner check | Owner-scoped ✓ |
| `GET /api/session/[sessionId]` | unguessable ID + sig + `caller == payerAddress` | ✓ |
| `POST /api/job/pfp-sweep`, `consult-timeout` | `Bearer` (`CRON_SECRET` / sweeper secret) | ✓ |
| `PATCH /api/job/sanitize` | `Bearer SANITIZER_PRIVATE_KEY` | ✓ |

> Note on `POST /api/job/[id]/messages`: it accepts only `type:"escalation", from:"bot"` and has no signature, on the assumption it's called by the worker bot. Anyone can still inject a fake "escalation" message into any job's chat by enumerating jobId. Low impact (it surfaces a bogus blocking question to the owner), but worth a worker-signature check for completeness.

---

## 5. How an outsider enumerates today (attack walkthrough)

No wallet, no payment, no signature required:

1. `getTotalJobs()` / `nextJobId` on-chain (or `GET /api/job/workers`) → upper bound `N`.
2. `GET /api/job/summaries?jobIds=1,2,…,200` → one-line summary of **every** job, incl. private consults. *(F1)*
3. For interesting IDs, `GET /api/job/plan-count?jobId=K` → secret-gist URL of the full build plan → fetch it. *(F2)*
4. `getJob(K)` on-chain → client address, amounts, status, and for non-consult jobs the full description + `resultCID` → fetch the deliverable from IPFS. *(F9)*
5. `getJobsByClient(victimAddress)` → that wallet's entire job history.

The only thing this *doesn't* yield is the full consult prompt text and the chat transcripts — those are owner-gated (Tier 2/3). Everything else is open.

---

## 6. Remediation roadmap

**P0 — stop the active leaks (small, isolated patches):**
- F1: **DONE** (commit `c154bf0`, 2026-07-07) — `/api/job/summaries` now requires an owner/worker auth signature; verified 401 on live prod.
- F2: **DONE** (`c154bf0`) — `/api/job/plan-count` requires the owner signature (`caller == job.client`) for on-chain jobs; `cv-*` synthetic ids pass through.
- F5: **DONE** (`c154bf0`) — `/api/job/sanitize` GET/POST no longer echo the content-derived `reason`/`tldr`; callers get a generic label, full reason stays in KV.
- F4: derive address from a verified signer in `/api/job/consult-complete`.
- F8: require owner sig (or internal secret) in `/api/gist`.
- F3: scope `/api/job/pipeline` to `job.worker == caller`.

**P1 — fix the auth scheme (touches client + server):**
- F6/F7: replace the static-sig-in-URL with the existing windowed-sig pattern, sent in a header/body; shorten the cache TTL.

**P2 — design-level confidentiality (contract/flow changes):**
- F9: encrypt or off-chain the deliverable links and work logs for privacy-sensitive service types; consider unguessable IDs (Tier-3 model) for all new job-scoped KV instead of relying on sequential jobId + per-route checks.

---

## Appendix — full route inventory

| Route | Methods | Private data | Auth | Owner-scoped | Enumerable ID | Verdict |
|-------|---------|--------------|------|--------------|---------------|---------|
| `/api/job/summaries` | GET | consult/build summaries | **none** | no | seq jobId | **F1 Critical** |
| `/api/job/plan-count` | GET | plan gist URL | **none** | no | seq jobId | **F2 High** |
| `/api/job/pipeline` | GET | all in-progress jobs | worker sig | **no** | — | **F3 High** |
| `/api/job/ready` | GET | all open jobs | worker sig | n/a (open) | — | F3 (lower) |
| `/api/job/consult-complete` | GET/POST | done-list | **none** | no (spoofable addr) | seq jobId | **F4 Medium** |
| `/api/job/sanitize` | GET | safety verdict | **none** | no | seq jobId | **F5 Medium** |
| `/api/gist` | POST | plan gist write | weak (`if jobId`) | no | seq jobId | **F8 Medium** |
| `/api/pfp/result/[jobId]` | GET | generated PFP png | none | no | seq jobId | F10 Low |
| `/api/job/[id]/messages` | GET | chat transcript | static sig | **yes** | seq jobId | Safe |
| `/api/job/[id]/messages` | POST | escalation inject | none (bot-only shape) | no | seq jobId | Low (note) |
| `/api/job/[id]/chat` | POST | chat | **windowed** sig | **yes** | seq jobId | Safe ✓ |
| `/api/job/[id]/consult-prompt` | GET | consult prompt | static sig | **yes** | seq jobId | Safe |
| `/api/job/save-consult-prompt` | POST | consult prompt | static sig | **yes** | seq jobId | Safe |
| `/api/session/[sessionId]` | GET/POST | session chat | sig + owner | **yes** | nanoid | Safe ✓ |
| `/api/job/pfp-sweep` | POST | internal cron | Bearer | n/a | — | Safe |
| `/api/job/consult-timeout` | POST | internal cron | Bearer | n/a | — | Safe |
| `/api/job/sanitize` | PATCH | admin override | Bearer (key) | n/a | — | Safe |
| `/api/job/workers` | GET | worker list + balances | none | n/a (public chain data) | — | Public-by-design |
| `/api/services`, `/api/pfp/cost`, `/api/cv-balance/[wallet]` | GET | pricing / balances | none | n/a | — | Public-by-design |
| `/api/consult/quick`, `/deep`, `/research`, `/build`, `/audit`, `/qa`, `/judge`, `/feature` | POST | create job | x402 payment | n/a | — | Safe (paid) |

*Generated as a source review of commit `32199eb`. Line references current as of that commit.*
