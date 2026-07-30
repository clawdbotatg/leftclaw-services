# SwapAndBurn — status & wiring

**Goal:** job payments (USDC via x402 or direct CLAWD) should end up **burned**, not in the treasury Safe.

## Current state (verified on-chain 2026-07-29)

| Thing | Value |
|-------|-------|
| SwapAndBurn (deployed) | [`0x0C1a3DB07304D2E4E551AB4A7b083382a33f25ad`](https://basescan.org/address/0x0C1a3DB07304D2E4E551AB4A7b083382a33f25ad) — ENS: `pay.clawdbotatg.eth` |
| Deployed | 2026-03-07 via CREATE2 factory, deployer `0xa822155c…` (unverified on Basescan) |
| Deployed version | matches `contracts/SwapAndBurn.sol` **minus** the ENS `setENSName()` additions (selector-set match; core burn logic identical). The ENS lines are inert on Base anyway — the reverse registrar is an L1 contract. |
| Proven working | 2026-03-07: 1,000 CLAWD test burn. 2026-07-27 `execute()`: ETH → WETH → 9,498.59 CLAWD sent to `0x…dEaD` (tx `0xc99d4e7b…`). Keeper `0xf2c44aF6…` calls `execute()` periodically; `0x16de0aD6…` drips ETH in. |
| LeftClawServicesV2 | `0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a` |
| Its `treasury()` | **still the Safe** `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` — CLAWD payouts on job completion go there as of 2026-07-29 |
| Its `owner()` | `clawdbotatg.eth` = `0x11ce532845cE0eAcdA41f72FDc1C88c335981442` (EIP-7702-delegated EOA — **not** the Safe; DEPLOY_REPORT.md is outdated on this) |

## The one remaining step

Send from **clawdbotatg.eth** (`0x11ce…1442`), the contract owner:

```
to:    0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a
value: 0
data:  0xf0f442600000000000000000000000000c1a3db07304d2e4e551ab4a7b083382a33f25ad
```

i.e. `setTreasury(0x0C1a3DB07304D2E4E551AB4A7b083382a33f25ad)`.

Or via [Basescan Write Contract](https://basescan.org/address/0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a#writeContract) connected as the owner: `setTreasury` → `0x0C1a3DB07304D2E4E551AB4A7b083382a33f25ad`.

After this, every completed job's CLAWD escrow flows to SwapAndBurn and the next
`execute()` call burns it (along with any USDC/ETH sent there). `execute()` is
permissionless; the existing keeper already calls it.

## Accepted risk

The 2026-03-06 audit (`audits/SwapAndBurn-2026-03-06/`) flagged **zero slippage
protection** (`amountOutMinimum: 0`) as Critical — every `execute()` is
sandwichable. Accepted 2026-07-29: extractable value is capped at the balance
held at execution time, which stays small if `execute()` runs frequently. Keep
the keeper cadence tight; revisit if per-job amounts grow.
