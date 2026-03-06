# TASK: x402 Off-Chain Sessions + KV Persistence

## Goal
When an agent pays via x402, create an off-chain chat session and return a chat URL. The existing `/chat/[jobId]` page should work for BOTH on-chain jobs (CLAWD payment) AND x402 sessions (USDC payment).

## Working Directory
`/Users/austingriffith/projects/leftclaw-services/packages/nextjs/`

## What Exists
- `/app/consult/page.tsx` — pays CLAWD on-chain, redirects to `/chat/[jobId]`
- `/app/chat/[jobId]/ChatClient.tsx` — chat UI, reads job from on-chain contract, checks `job.client === wallet address`
- `/app/api/chat/route.ts` — streams chat responses via Anthropic API (Claude opus)
- `/app/api/consult/quick/route.ts` (and deep, qa, audit) — x402 endpoints, currently return jobId from in-memory store
- `/lib/jobStore.ts` — in-memory job store (Map), needs to become persistent KV
- `/lib/x402.ts` — x402 server config, facilitator at `https://clawd-facilitator.vercel.app`

## Architecture

### 1. Add Upstash Redis KV
- Install `@upstash/redis` (NOT `@vercel/kv` which is deprecated)
- Create `/lib/kv.ts` with Redis client from `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars
- The Upstash KV store needs to be provisioned on Vercel first — for now, just write the code assuming those env vars exist. If they don't exist at runtime, fall back to in-memory Map (so dev still works).

### 2. Refactor jobStore.ts → sessionStore.ts
Replace the in-memory jobStore with a KV-backed session store:
```typescript
interface X402Session {
  id: string;           // "x402_" + nanoid
  serviceType: string;  // CONSULT_QUICK, CONSULT_DEEP, QA_REPORT, AUDIT
  description: string;
  context?: string;
  status: "active" | "completed" | "expired";
  priceUsd: string;
  payerAddress?: string; // x402 payer's address if available
  messages: { role: "user" | "assistant"; content: string }[];
  createdAt: string;
  expiresAt: string;    // Quick: +1hr, Deep: +2hr, QA: +4hr, Audit: +8hr
}
```
- `createSession(params)` → creates in KV with TTL matching expiresAt
- `getSession(id)` → fetch from KV
- `updateSession(id, updates)` → update in KV
- `addMessage(id, message)` → append message to session
- Generate IDs with nanoid (install it): `x402_` prefix + 21 char nanoid

### 3. Update x402 API Routes
All 4 routes (`/api/consult/quick`, `/api/consult/deep`, `/api/qa`, `/api/audit`) should:
- Create a session via sessionStore
- Return `{ sessionId, chatUrl, status, expiresAt }`
- chatUrl format: `https://leftclaw-services-nextjs.vercel.app/chat/x402/{sessionId}`
- Keep the existing `withX402` wrapper and bazaar discovery metadata

### 4. Add x402 Chat Route: `/app/chat/x402/[sessionId]/page.tsx`
Create a NEW route for x402 sessions (separate from on-chain job chat):
- No wallet connection required (the payment was already made via x402)
- Load session from KV by sessionId
- If session not found or expired → show error page
- Otherwise show the same chat UI (can share/adapt ChatClient component)
- Messages persist to KV (not just sessionStorage)
- The `/api/chat` route needs a small update to also accept `sessionId` param and load/save messages from KV

### 5. Update `/api/chat/route.ts`
- Accept either `jobId` (existing on-chain flow) OR `sessionId` (x402 flow)
- For x402 sessions: load messages from KV, append new message, stream response, save assistant response back to KV
- Check session hasn't expired
- Message limit: Quick Consult = 15 messages, Deep = 30, QA = 20, Audit = 20

## Important Notes
- Use `yarn` not `npm` (project uses yarn 3)
- Build must pass: `cd packages/nextjs && yarn build`
- Don't modify the existing on-chain job chat flow — it should keep working as-is
- The x402 chat page should NOT require wallet connection
- Keep DaisyUI styling consistent with existing pages
- Install nanoid for ID generation: `yarn add nanoid`
- TypeScript strict — no `any` types

## Files to Create/Modify
- CREATE: `lib/kv.ts`
- CREATE: `lib/sessionStore.ts`
- CREATE: `app/chat/x402/[sessionId]/page.tsx` (can be thin wrapper)
- CREATE: `app/chat/x402/[sessionId]/X402ChatClient.tsx`
- MODIFY: `app/api/consult/quick/route.ts` (and deep, qa, audit)
- MODIFY: `app/api/chat/route.ts` (accept sessionId)
- DELETE or KEEP: `lib/jobStore.ts` (can keep for backward compat, or migrate fully)

## Validation
1. `yarn build` passes
2. x402 endpoints return `{ sessionId, chatUrl, ... }` 
3. `/chat/x402/[sessionId]` renders a chat UI without requiring wallet
4. Chat messages persist across page refreshes (KV-backed)
5. Existing `/chat/[jobId]` still works for on-chain jobs
