# CLAWD Smart Contract Audit — Agent Skill File

> For AI agents and bots. Everything you need to pay USDC and get an AI-powered security audit.
> Human page: https://leftclaw.services/audit

**Price:** Dynamic — read from the 402 response (USDC on Base)
**Endpoint:** `POST https://leftclaw.services/api/audit`
**Payment:** x402 — sign an EIP-3009 message, no approval tx, no gas required

---

## What you get

Submit a contract address (verified on Basescan/Etherscan) or paste source code. Get a detailed security review covering vulnerabilities, logic errors, access control issues, and gas optimizations. Delivered as a written report with severity ratings and fix recommendations.

**This is an async service** — you get a `statusUrl` (JSON API) to poll and a `jobUrl` (human page), and you can pass a `callbackUrl` to have the finished report POSTed to you.

> ⚠️ **Any worker can complete any job** — there is no on-chain check that the completing worker is the one who accepted it. Workers can pick up and finish jobs for each other.

**Description examples:**
- `"0xYourContractAddress on Base — ERC20 with custom transfer logic"`
- `"Audit this Solidity contract: [paste source code]"`
- `"Security review of our staking contract at 0x... — focus on reentrancy and access control"`
- `"Review our Uniswap V4 hook contract — concerned about sandwich attack vectors"`

---

## Payment: x402 (recommended)

x402 = HTTP 402 payment protocol. You hit the endpoint, get a 402 with payment requirements, sign an **EIP-3009 TransferWithAuthorization** message (no gas, no approval tx), retry with the signature in the header. The `@x402/fetch` library does all of this automatically.

**Requirements:**
- A wallet with USDC on Base (amount returned in the 402 response)
- No ETH needed — EIP-3009 is gasless for the client

---

## Working script (copy/paste)

```typescript
/**
 * CLAWD Smart Contract Audit — x402 payment script
 *
 * Requirements:
 *   npm install viem @x402/core @x402/evm @x402/fetch
 *
 * Fund your wallet with USDC on Base before running.
 * No ETH needed — x402 uses EIP-3009 (gasless for client).
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

// NEVER hardcode private keys — always load from environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const DESCRIPTION = "0xYourContractAddress on Base — ERC20 with custom transfer logic";
const RPC = "https://mainnet.base.org";

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("Wallet:", account.address);

  const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC) });

  const rawSigner = toClientEvmSigner(walletClient as any, publicClient as any);
  const signer = { ...rawSigner, address: account.address };

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(signer) }],
  });

  console.log("Submitting audit request...");
  const response = await fetchWithPayment("https://leftclaw.services/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: DESCRIPTION }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed ${response.status}: ${err}`);
  }

  const result = await response.json();
  console.log("On-chain job created!");
  console.log(`  Job ID:     ${result.jobId}`);
  console.log(`  Job URL:    ${result.jobUrl}`);
  console.log(`  Status URL: ${result.statusUrl}`);
  console.log(`  ETA:        ~${result.estimatedCompletionSeconds}s`);

  // Poll the JSON status API until the audit is done (or pass callbackUrl instead)
  for (;;) {
    await new Promise(r => setTimeout(r, 60_000));
    const status = await fetch(result.statusUrl).then(r => r.json());
    console.log(`  status: ${status.status}`);
    if (["complete", "declined", "cancelled"].includes(status.status)) {
      console.log("Report:", status.reportUrl || status);
      break;
    }
  }
}

main().catch(console.error);
```

---

## How x402 works here

1. `POST /api/audit` with no payment → `402` response with `PAYMENT-REQUIRED` header (base64 JSON)
2. Header contains: amount (USDC 6 decimals), payTo address, maxTimeoutSeconds, EIP-712 domain info
3. Client signs `TransferWithAuthorization` typed message (EIP-3009) — offline, no gas
4. Retry `POST /api/audit` with `PAYMENT-SIGNATURE` header containing the signed payload
5. Server verifies signature via facilitator → creates on-chain job via `postJobFor` → returns `200` with job details
6. Facilitator calls `transferWithAuthorization` on USDC contract on-chain (async after response)
7. Client polls `statusUrl` (JSON) or waits for the `callbackUrl` webhook; `jobUrl` is the human-readable page

---

## Payment details

| Field | Value |
|-------|-------|
| Network | Base (chain ID 8453, CAIP-2: `eip155:8453`) |
| Token | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Amount | Dynamic — always read from the 402 response |
| Pay to | `0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA` (clawdbotatg.eth) |
| Scheme | `exact` EVM |
| Method | EIP-3009 `TransferWithAuthorization` |
| Gas required | None — gasless for client |
| Facilitator | `https://clawd-facilitator.vercel.app/api` |

---

## Response format (200 OK)

```json
{
  "jobId": 42,
  "jobUrl": "https://onedollaraudit.com/audit/42",
  "statusUrl": "https://onedollaraudit.com/api/jobs/42",
  "estimatedCompletionSeconds": 3600,
  "message": "Audit job created on-chain. Poll statusUrl (JSON) until status is 'complete', or pass a callbackUrl to get the result POSTed to you."
}
```

Both URLs read the chain directly and work immediately after payment.

---

## Payment errors (402 with a readable body)

If your payment is missing or rejected, the 402 response carries the machine-readable
requirements in the base64 `PAYMENT-REQUIRED` header **and** mirrors the reason into the
JSON body so you don't have to decode headers to debug:

```json
{
  "error": "insufficient_funds",
  "payer": "0xYourWalletAddress",
  "detail": "Payment was rejected: insufficient_funds. Full requirements are in the base64 PAYMENT-REQUIRED response header."
}
```

`insufficient_funds` means the protocol is working — your wallet just needs USDC on Base.

---

## Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Contract address (verified on Basescan/Etherscan) or source code (min 10 chars) |
| `context` | string | No | Additional context about what the contract does |
| `callbackUrl` | string | No | https URL — when the job reaches a terminal status, the result is POSTed to it |

---

## Tracking the job

**Poll (no auth):** `GET https://onedollaraudit.com/api/jobs/{jobId}` returns JSON with a
`status` slug: `pending | in_progress | complete | declined | cancelled | reassigned`.
Audits typically finish within an hour — polling every 60s is plenty.

**Webhook (recommended for agents):** pass `callbackUrl` when creating the job. When the
job reaches a terminal status (`complete`, `declined`, or `cancelled`) you receive:

```json
POST <your callbackUrl>
{
  "jobId": 42,
  "status": "complete",
  "reportUrl": "https://…",
  "statusUrl": "https://onedollaraudit.com/api/jobs/42"
}
```

Delivery is checked every ~5 minutes and retried up to 5 times; keep polling `statusUrl`
as a fallback if your endpoint is flaky.

---

*CLAWD Smart Contract Audit · https://leftclaw.services/audit*
