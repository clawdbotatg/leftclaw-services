# x402scan / AgentCash Discovery — Ship Report

**Date:** 2026-07-29 · **Live:** https://leftclaw.services/openapi.json

leftclaw.services is now discoverable by x402scan/AgentCash agents. Implemented per the
"discovery + registration hardening" path in https://agentcash.dev/merchants.md (existing
x402 v2 API — x402 only, no MPP/Tempo added).

## What shipped

### `packages/nextjs/app/openapi.json/route.ts` (new)

`GET /openapi.json` — OpenAPI 3.1 document generated dynamically so prices always track the
on-chain `LeftClawServicesV2` contract (via the 60s-cached `getContractPriceUsd`). Documents
all 9 x402-payable POST routes:

| Route | Service | Price at ship |
|---|---|---|
| `POST /api/consult/quick` | Quick Consultation | $1.00 |
| `POST /api/consult/deep` | Deep Consultation | $2.00 |
| `POST /api/qa` | QA Report | $2.50 |
| `POST /api/build` | Build | $20.00 |
| `POST /api/research` | Deep Research | $3.00 |
| `POST /api/judge` | AI Judge | $100.00 |
| `POST /api/feature` | Feature | $5.00 |
| `POST /api/audit` | Smart Contract Audit | $1.00 |
| `POST /api/pfp` | CLAWD PFP Generator | $0.01 |

Each payable operation carries:

- `x-payment-info` — `protocols: [{"x402": {}}]` and `price: {mode: "fixed", currency: "USD",
  amount: "<decimal USD>"}` (spec requires `amount`, decimal USD — distinct from the runtime
  402 challenge where `accepts[].amount` is token **atomic units**: $1.00 → `"1000000"` USDC).
- Full `requestBody` JSON schema matching the actual handler validation (`description`/`context`
  with real min-lengths; pfp's `prompt`; audit's optional `callbackUrl` webhook).
- Full response schemas — job routes return `{jobId, jobUrl, message}`; audit adds `statusUrl`
  (machine-readable polling on onedollaraudit.com) + `estimatedCompletionSeconds`; pfp returns
  the image inline as a data URL.
- A documented `402` response describing the PAYMENT-REQUIRED challenge, plus 400/500.

Also included: the free `GET /api/services` catalog (declared `security: []` → renders as
"unprotected"), `info.x-guidance` explaining the post → 402 → sign-with-`@x402/fetch` →
job-on-chain → poll flow, and `info.contact.email: clawd@buidlguidl.com`.

Price resolution is sequential with one retry (a 9-wide parallel burst 429s the public Base
RPC); on total failure the route returns 503 + `Retry-After` rather than a broken doc.

### `packages/nextjs/lib/x402.ts` (hardened)

- `getContractPriceUsd` now serves a **stale cached price** when the RPC read fails, instead
  of failing the request — benefits every payable route's 402 challenge, not just the doc.
- RPC fallback chain fixed to match the rest of the codebase (`BASE_RPC_URL` →
  Alchemy via `NEXT_PUBLIC_ALCHEMY_API_KEY` → `mainnet.base.org`). Previously this file fell
  back straight to the flaky public endpoint — the same bug fixed for ready/pipeline routes
  in `29c2579`.

## Commits

- `f7cfa9b` feat(discovery): publish /openapi.json for x402scan/AgentCash discovery
- `88ce50a` fix(x402): use Alchemy RPC fallback for price reads, consistent with other routes
- `f730ebf` merge to main → Vercel auto-deploy (live ~1 min later)

## Production verification (2026-07-29, all passed)

- `curl https://leftclaw.services/openapi.json` → the spec, with live contract prices,
  contact email, and x-guidance.
- Unauthenticated `POST /api/audit` with an **invalid** body → HTTP **402 before input
  validation**, with the x402 v2 challenge; decoded `PAYMENT-REQUIRED` header:
  `scheme: exact`, `network: eip155:8453`, `amount: "1000000"` (atomic USDC),
  `asset: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
  `payTo: 0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA`.
- `npx -y @agentcash/discovery@latest discover https://leftclaw.services`:

  ```
  Source:   openapi
  Spec:     https://leftclaw.services/openapi.json
  API:      LeftClaw Services
  Routes:   10

    GET     /api/services  unprotected
    POST    /api/consult/quick  paid  1.00 USD  [x402]
    POST    /api/consult/deep  paid  2.00 USD  [x402]
    POST    /api/qa  paid  2.50 USD  [x402]
    POST    /api/build  paid  20.00 USD  [x402]
    POST    /api/research  paid  3.00 USD  [x402]
    POST    /api/judge  paid  100.00 USD  [x402]
    POST    /api/feature  paid  5.00 USD  [x402]
    POST    /api/audit  paid  1.00 USD  [x402]
    POST    /api/pfp  paid  0.01 USD  [x402]

  Guidance: 265 tokens
  ```

  Zero warnings. `check` on individual routes (`/api/audit`, `/api/services`) also clean.

## Open items

- **Registration** — NOT done (deliberately, waiting for Austin):
  https://www.x402scan.com/resources/register with `https://leftclaw.services`.
- **`BASE_RPC_URL` on Vercel** — git history implies it's unset in prod (that's why the
  Alchemy-fallback pattern exists). The `88ce50a` fix makes this a non-issue, but worth
  confirming in the Vercel dashboard.
