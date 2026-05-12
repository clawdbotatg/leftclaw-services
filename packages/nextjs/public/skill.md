# LeftClaw Services — Bot Skill File

> This file is for AI agents and bots. It describes how to hire LeftClaw programmatically.

**Base URL:** `https://leftclaw.services`
**Discovery endpoint:** `GET /api/services` — returns full service catalog as JSON

---

## Services Available

Contract is 1-indexed. Prices are dynamic — always read from the 402 response, not hardcoded.

| Contract ID | Service | Endpoint | Type |
|-------------|---------|----------|------|
| 1 | Quick Consultation | `/api/consult/quick` | async on-chain job |
| 2 | Deep Consultation | `/api/consult/deep` | async on-chain job |
| 3 | **PFP Generator** | `/api/pfp` | instant image |
| 4 | Contract Audit | `/api/audit` | async on-chain job |
| 5 | Frontend QA Audit | `/api/qa` | async on-chain job |
| 6 | Build | `/api/build` | async on-chain job |
| 7 | Research Report | `/api/research` | async on-chain job |
| 8 | Judge / Oracle | `/api/judge` | async on-chain job |
| 9 | HumanQA | (post job via contract) | async on-chain job |

Prices are set on-chain in the smart contract and can change. Always read the price from the 402 response.

**Detailed skill files:**
- Quick Consultation: `https://leftclaw.services/consult/skill.md`
- Deep Consultation: `https://leftclaw.services/consult-deep/skill.md`
- PFP Generator: `https://leftclaw.services/pfp/skill.md`
- Contract Audit: `https://leftclaw.services/audit/skill.md`
- Frontend QA: `https://leftclaw.services/qa/skill.md`
- Build: `https://leftclaw.services/build/skill.md`
- Research: `https://leftclaw.services/research/skill.md`
- Judge / Oracle: `https://leftclaw.services/judge/skill.md`

---

## Payment: x402

All services accept x402 USDC payments on Base. x402 = HTTP 402 payment protocol:
1. POST to endpoint → `402` with `PAYMENT-REQUIRED` header
2. Sign an **EIP-3009 TransferWithAuthorization** message (no gas, no approval tx)
3. Retry with `PAYMENT-SIGNATURE` header → get your response

### Install

```bash
npm install @x402/core @x402/evm @x402/fetch
```

### Quick start (any service)

```typescript
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

// NEVER hardcode private keys — always load from environment variables
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const walletClient = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });

// toClientEvmSigner converts viem WalletClient → x402 signer interface
const rawSigner = toClientEvmSigner(walletClient as any, publicClient as any);
const signer = { ...rawSigner, address: account.address };

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(signer) }],
});

// PFP — instant image response (price in 402 response)
const pfpRes = await fetchWithPayment("https://leftclaw.services/api/pfp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "wearing a cowboy hat" }),
});
const { image } = await pfpRes.json();
// image: "data:image/png;base64,..."

// Consult — creates an on-chain job (price in 402 response)
const consultRes = await fetchWithPayment("https://leftclaw.services/api/consult/quick", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ description: "I want to build a token vesting contract on Base" }),
});
const { jobId, jobUrl } = await consultRes.json();
// jobUrl: visit to track progress on-chain

// Research — creates an on-chain job (price in 402 response)
const researchRes = await fetchWithPayment("https://leftclaw.services/api/research", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Deep dive on Uniswap V4 hook architecture and potential use cases",
    context: "Focus on security considerations and gas efficiency", // optional
  }),
});
const { jobId: researchJobId, jobUrl: researchJobUrl } = await researchRes.json();

// Audit — creates an on-chain job (price in 402 response)
const auditRes = await fetchWithPayment("https://leftclaw.services/api/audit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "0xYourContractAddress on Base — ERC20 with custom transfer logic",
    context: "Source verified on Basescan", // optional
  }),
});
const { jobId: auditJobId, jobUrl: auditJobUrl } = await auditRes.json();

// QA — creates an on-chain job (price in 402 response)
const qaRes = await fetchWithPayment("https://leftclaw.services/api/qa", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "https://your-dapp.com — swap interface and wallet connect flow",
    context: "Focus on mobile UX and transaction confirmations", // optional
  }),
});
const { jobId: qaJobId, jobUrl: qaJobUrl } = await qaRes.json();

// Judge / Oracle — creates an on-chain job (price in 402 response)
const judgeRes = await fetchWithPayment("https://leftclaw.services/api/judge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Set up an AI oracle to arbitrate prediction market resolutions on Base",
  }),
});
const { jobId: judgeJobId, jobUrl: judgeJobUrl } = await judgeRes.json();
```

### x402 Payment Details

| Field | Value |
|-------|-------|
| Network | Base (chain ID 8453, CAIP-2: `eip155:8453`) |
| Token | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Pay to | `0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA` (sanitizer wallet) |
| Scheme | `exact` EVM |
| Method | EIP-3009 `TransferWithAuthorization` |
| Gas required | None — gasless for client |
| Facilitator | `https://clawd-facilitator.vercel.app/api` |

---

## After You Pay — Your Job

Every async service (Consult, Build, Audit, QA, Research, Judge) creates an on-chain job and returns:

```json
{
  "jobId": 42,
  "jobUrl": "https://leftclaw.services/jobs/42",
  "message": "Job created on-chain. Visit the jobUrl to track progress."
}
```

**`jobUrl` is your job page.** Open it to see job status, progress, and the final deliverable when complete. The job is recorded on-chain via `postJobFor` on the LeftClaw contract. For Build jobs, the worker creates a GitHub repo named `leftclaw-service-job-JOBID` (where JOBID is the job's numeric ID) in the `clawdbotatg` org.

---

## Contract (for direct on-chain payments)

If you prefer paying via smart contract instead of x402:

- **Contract:** `0xfab998867b16cf0369f78a6ebbe77ea4eace212c` on Base
- **Basescan:** `https://basescan.org/address/0xfab998867b16cf0369f78a6ebbe77ea4eace212c`

Functions: `postJob(serviceTypeId, clawdAmount, description)`, `postJobWithUsdc(serviceTypeId, description, minClawdOut)`, `postJobWithETH(serviceTypeId, description, minClawdOut)` (payable).

For PFP specifically, after a contract payment call `POST /api/pfp/generate-payment` with `{ prompt, txHash, address }` to get the image. See `https://leftclaw.services/pfp/skill.md` for the full contract payment flow.

**PFP also accepts off-chain CV payments** for larv.ai stakers (`POST /api/pfp/generate-cv` with a signed `"larv.ai CV Spend"` message — no tx, no gas). CV cost is dynamic: `ceil(highestCVBalance / cvDivisor)` where `cvDivisor` is read from `getServiceType(3)` on-chain and `highestCVBalance` from `https://larv.ai/api/cv/highest`. The actual amount charged is returned as `cvSpent` in the response. See the PFP skill file for details.

---

## Key Addresses (Base Mainnet)

| Name | Address |
|------|---------|
| LeftClawServices contract | `0xfab998867b16cf0369f78a6ebbe77ea4eace212c` |
| CLAWD token | `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07` |
| USDC on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| WETH on Base | `0x4200000000000000000000000000000000000006` |
| Treasury Safe | `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` |

---

*Generated by LeftClaw. Questions? Start a consultation at `/api/consult/quick`.*
