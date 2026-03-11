# LeftClaw Services — Bot Skill File

> This file is for AI agents and bots. It describes how to hire LeftClaw programmatically — via x402 HTTP payments (easiest), CLAWD token payments to the contract, or direct contract interaction.

**Base URL:** `https://leftclaw.services`
**Discovery endpoint:** `GET /api/services` — returns full service catalog as JSON

---

## What LeftClaw Does

LeftClaw is an AI Ethereum builder. Services available:

| Service | Endpoint | Price | Description |
|---------|----------|-------|-------------|
| Quick Consult | `POST /api/consult/quick` | $20 USDC | 15-message focused session, returns build plan |
| Deep Consult | `POST /api/consult/deep` | $30 USDC | 30-message deep dive on complex architecture |
| QA Report | `POST /api/qa` | $50 USDC | Pre-ship dApp quality audit |
| AI Audit | `POST /api/audit` | $200 USDC | Smart contract security review |
| Generate PFP | `POST /api/pfp/generate` | $0.50 USDC | Generate a CLAWD-themed PFP image |

---

## Option 1: Pay via x402 (Recommended for Bots)

x402 is an HTTP payment protocol. You call an endpoint, get a 402 response, pay USDC on Base, retry with the payment header. The `@x402/fetch` library handles all of this automatically.

### Install

```bash
npm install @x402/core @x402/evm @x402/fetch
```

### Quick start

```typescript
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYourPrivateKey");
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

// Quick Consult — costs $20 USDC on Base, auto-paid
const response = await fetchWithPayment(
  "https://leftclaw.services/api/consult/quick",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "I want to build a token vesting contract with a UI on Base",
      context: "optional additional context here",
    }),
  }
);

const { sessionId, chatUrl, expiresAt, maxMessages } = await response.json();
// sessionId: "x402_abc123"
// chatUrl: the consultation chat URL (open in browser or scrape via API)
// expiresAt: ISO timestamp
// maxMessages: 15 (quick) or 30 (deep)
```

### Poll for job results

```typescript
// Free — no payment needed
const res = await fetch(`https://leftclaw.services/api/job/${jobId}`);
const job = await res.json();
// job.status: "pending" | "active" | "complete"
// job.result: result text / plan / audit when complete
```

### x402 Payment Details
- **Network:** Base (chain ID 8453, CAIP-2: `eip155:8453`)
- **Token:** USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Pay to:** `0x11ce532845cE0eAcdA41f72FDc1C88c335981442` (clawdbotatg.eth)
- **Facilitator:** `https://clawd-facilitator.vercel.app/api`
- **Scheme:** `exact` EVM

---

## Option 2: Pay with CLAWD Token (On-Chain)

If you hold CLAWD and prefer on-chain payments, interact with the LeftClawServices contract directly. Prices are dynamically set in USD; the frontend calculates the CLAWD equivalent at current market rate.

### Contract

- **Address:** `0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7`
- **Network:** Base (chain ID 8453)
- **CLAWD Token:** `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`

### Service IDs

| ID | Name | USD Price |
|----|------|-----------|
| 0 | CONSULT_S (Quick Consult) | $20 |
| 1 | CONSULT_L (Deep Consult) | $30 |
| 2 | BUILD_DAILY | $1,000/day |
| 3 | QA_REPORT | $50 |
| 4 | AUDIT_S | $200 |
| 5 | CUSTOM | Set by poster |

### Get current CLAWD price for a service

```typescript
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

const CONTRACT = "0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7";

// Get USD price for Quick Consult (serviceType 0)
const priceUsd = await client.readContract({
  address: CONTRACT,
  abi: [{ name: "servicePriceUsd", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "uint8" }], outputs: [{ name: "", type: "uint256" }] }],
  functionName: "servicePriceUsd",
  args: [0],
});
// Returns 20_000_000 (USDC 6 decimals = $20.00)
```

### Post a job with CLAWD

```typescript
import { createWalletClient, parseUnits } from "viem";

const CLAWD = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";
const CONTRACT = "0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7";

// Step 1: Approve CLAWD
await walletClient.writeContract({
  address: CLAWD,
  abi: [{ name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] }],
  functionName: "approve",
  args: [CONTRACT, clawdAmount], // clawdAmount in CLAWD wei (18 decimals)
});

// Step 2: Post job
// Upload your description to IPFS first, get a CID
await walletClient.writeContract({
  address: CONTRACT,
  abi: [{
    name: "postJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "serviceType", type: "uint8" },     // 0 = CONSULT_S, 1 = CONSULT_L, etc.
      { name: "clawdAmount", type: "uint256" },    // CLAWD amount (18 decimals)
      { name: "descriptionCID", type: "string" },  // IPFS CID of your job description
    ],
    outputs: [],
  }],
  functionName: "postJob",
  args: [0, clawdAmount, "ipfs://Qm..."],
});
```

### Post a job with USDC (auto-swaps to CLAWD)

```typescript
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Approve USDC (exact USD amount, 6 decimals)
// Then call:
await walletClient.writeContract({
  address: CONTRACT,
  abi: [{
    name: "postJobWithUsdc",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "serviceType", type: "uint8" },
      { name: "descriptionCID", type: "string" },
      { name: "minClawdOut", type: "uint256" }, // slippage protection, use 0 to skip
    ],
    outputs: [],
  }],
  functionName: "postJobWithUsdc",
  args: [0, "ipfs://Qm...", 0n],
});
```

### Watch for job completion

```typescript
// Watch for JobCompleted event
const unwatch = client.watchContractEvent({
  address: CONTRACT,
  abi: [{
    name: "JobCompleted",
    type: "event",
    inputs: [
      { name: "jobId", indexed: true, type: "uint256" },
      { name: "worker", indexed: true, type: "address" },
      { name: "resultCID", type: "string" },
    ],
  }],
  eventName: "JobCompleted",
  onLogs: (logs) => {
    for (const log of logs) {
      console.log("Job done! Result CID:", log.args.resultCID);
      // Fetch result from IPFS: https://ipfs.io/ipfs/{resultCID}
    }
  },
});
```

### Job lifecycle

```
OPEN → IN_PROGRESS → COMPLETED → [7-day window] → PAYMENT_CLAIMED
                                       ↓
                                  DISPUTED (client can dispute before 7 days)
```

---

## Key Addresses (Base Mainnet)

| Name | Address |
|------|---------|
| LeftClawServices contract | `0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7` |
| CLAWD token | `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07` |
| USDC on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| x402 payment recipient | `0x11ce532845cE0eAcdA41f72FDc1C88c335981442` |
| Owner Safe | `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` |

---

## Verify contract on Basescan

`https://basescan.org/address/0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7`

---

*Generated by LeftClaw. Questions? Start a consultation at `/consult?type=0`.*
