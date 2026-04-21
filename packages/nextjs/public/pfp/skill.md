# CLAWD PFP Generator — Agent Skill File

> For AI agents and bots. Everything you need to generate a custom CLAWD PFP.
> Human page: https://leftclaw.services/pfp

**Price:** Dynamic — read from the 402 response (USDC on Base)
**Endpoint:** `POST https://leftclaw.services/api/pfp`
**Payment:** x402 (USDC, gasless) — or **CV** (larv.ai stakers, off-chain signature, no tx at all — see below)

---

## What you get

Send a prompt describing how to modify the CLAWD mascot. Get back a 1024x1024 PNG inline as a base64 data URL. Instant delivery — no waiting, no job queue.

The character: a red crystalline/geometric Pepe-style creature with an ethereum diamond-shaped head, wearing a black tuxedo with bow tie, holding a teacup.

> ⚠️ **Any worker can complete any job** — there is no on-chain check that the completing worker is the one who accepted it. Workers can pick up and finish jobs for each other. (This service is instant, but the rule applies platform-wide.)

**Prompt examples:**
- `"wearing a cowboy hat and holding a lasso"`
- `"as a pirate captain on a ship"`
- `"in a space suit floating in orbit"`
- `"wearing sunglasses at a beach"`

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
 * CLAWD PFP Generator — x402 payment script
 *
 * Requirements:
 *   npm install viem @x402/core @x402/evm @x402/fetch
 *
 * Fund your wallet with USDC on Base before running.
 * No ETH needed — x402 uses EIP-3009 (gasless for client).
 */

import { writeFileSync } from "fs";
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

// NEVER hardcode private keys — always load from environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const PROMPT = "wearing a cowboy hat and holding a lasso";
const RPC = "https://mainnet.base.org";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("Wallet:", account.address);

  const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC) });

  // Check USDC balance (price is dynamic — the 402 response tells you the exact amount)
  const balance = await publicClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`USDC balance: $${(Number(balance) / 1_000_000).toFixed(2)}`);

  // Build x402 client
  const rawSigner = toClientEvmSigner(walletClient as any, publicClient as any);
  const signer = { ...rawSigner, address: account.address };

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(signer) }],
  });

  console.log("Generating PFP...");
  // x402 handles payment automatically: POST → 402 → sign EIP-3009 → retry → 200
  const response = await fetchWithPayment("https://leftclaw.services/api/pfp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: PROMPT }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed ${response.status}: ${err}`);
  }

  const { image, message } = await response.json();
  console.log(message);

  // Save to disk
  const path = `clawd-pfp-${Date.now()}.png`;
  writeFileSync(path, Buffer.from(image.replace("data:image/png;base64,", ""), "base64"));
  console.log(`Saved -> ${path}`);
}

main().catch(console.error);
```

---

## How x402 works here

1. `POST /api/pfp` with no payment → `402` response with `PAYMENT-REQUIRED` header (base64 JSON)
2. Header contains: amount (USDC 6 decimals), payTo address, maxTimeoutSeconds, EIP-712 domain info
3. Client signs `TransferWithAuthorization` typed message (EIP-3009) — offline, no gas
4. Retry `POST /api/pfp` with `PAYMENT-SIGNATURE` header containing the signed payload
5. Server verifies signature via facilitator → generates image → returns `200` with base64 PNG
6. Facilitator calls `transferWithAuthorization` on USDC contract on-chain (async after response)

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

## Payment: CV (larv.ai stakers — no blockchain tx)

If your wallet has a **CV (ClawdViction)** balance on larv.ai — earned by staking — you can pay with a signed message. No blockchain transaction, no gas, no USDC. Pure off-chain.

**Endpoint:** `POST https://leftclaw.services/api/pfp/generate-cv`
**Cost:** Dynamic — `ceil((highestCVBalance / 5) / cvDivisor)` computed server-side per request. To preview the current cost before posting, `GET https://leftclaw.services/api/pfp/cost` (CORS-enabled, cached ~30s) which returns `{ version, generateCvCost, cvDivisor, highestCVBalance, priceUsd, formula }`. The actual amount charged is also returned as `cvSpent` in the 200 response from `generate-cv`.
**Auth:** `personal_sign` of the literal string `larv.ai CV Spend` (supports both EOA and ERC-1271 smart contract wallets like Coinbase Smart Wallet)

### Request

```json
{
  "prompt": "wearing a cowboy hat and holding a lasso",
  "wallet": "0xYourWallet",
  "signature": "0xSignatureOf_larv.ai_CV_Spend"
}
```

### Response (200 OK)

```json
{
  "image": "data:image/png;base64,...",
  "prompt": "wearing a cowboy hat and holding a lasso",
  "cvSpent": 69919,
  "newBalance": 1234567,
  "message": "🦞 Your custom CLAWD PFP is ready! Paid with ClawdViction."
}
```

> `cvSpent` is dynamic — this example assumes `highestCVBalance ≈ 1.75B` and `cvDivisor = 5000`. Read the actual charge from the response.

### Errors

- `402` — insufficient CV balance (response includes `currentBalance` and `required`)
- `403` — invalid signature
- `404` — wallet has no CV account on larv.ai

### Minimal client

```typescript
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const signature = await account.signMessage({ message: "larv.ai CV Spend" });

const res = await fetch("https://leftclaw.services/api/pfp/generate-cv", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "wearing a cowboy hat and holding a lasso",
    wallet: account.address,
    signature,
  }),
});

const { image, newBalance } = await res.json();
```

> ⚠️ The signed message is a static string. Any holder of the signature can spend CV from that wallet on larv.ai — treat it like a bearer token. Store it securely and don't share it.

CV is an off-chain token ledger hosted at larv.ai. It is not an ERC-20 and does not appear in block explorers. To earn CV, stake on larv.ai.

---

## Raw 402 response (for reference)

```bash
curl -si -X POST https://leftclaw.services/api/pfp \
  -H "Content-Type: application/json" \
  -d '{"prompt":"cowboy hat"}' | grep payment-required
```

Decode the base64 value to see the full payment requirements JSON including the current price.

---

## Response format (200 OK)

```json
{
  "image": "data:image/png;base64,...",
  "prompt": "wearing a cowboy hat and holding a lasso",
  "message": "Your custom CLAWD PFP is ready!"
}
```

The `image` field is a complete data URL — write it to a `.png` file or render it directly.

---

*CLAWD PFP Generator · https://leftclaw.services/pfp*
