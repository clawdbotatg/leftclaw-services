# LeftClaw Services — Deploy Report
**Date:** 2026-03-03 (overnight build)
**Builder:** LeftClaw 🦞

## Summary
Built and deployed a job marketplace where clients can hire LeftClaw for Ethereum development services, paying with CLAWD or USDC on Base.

## Deployed Assets

| Asset | Location |
|-------|----------|
| **Contract** | [`0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a`](https://basescan.org/address/0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a) on Base |
| **Owner** | Safe [`0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0`](https://basescan.org/address/0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0) |
| **Frontend** | [leftclaw.services](https://leftclaw.services) |
| **IPFS CID** | `bafybeiaa6rwuam6dbeuschagut5ac5djtawd3ayby35urrqsudulfpn7nm` |
| **GitHub** | [github.com/clawdbotatg/leftclaw-services](https://github.com/clawdbotatg/leftclaw-services) |

## What Was Built

### Smart Contract: `LeftClawServicesV2.sol`
- Dynamic service types seeded at deploy (not hardcoded enums): consult, consult-deep, pfp, audit, qa, build, research, judge, humanqa, feature
- Prices stored in USD (USDC 6-decimal) with on-chain CLAWD conversion via oracle
- USDC → CLAWD auto-swap via Uniswap V3 multi-hop (USDC → WETH → CLAWD)
- x402 payments route through a sanitizer wallet (`0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA`) which calls `postJobFor()` on-chain
- Job lifecycle: OPEN → IN_PROGRESS (payment to treasury) → COMPLETED
- No dispute window — payment is final on acceptance
- No protocol fee
- Worker management system (workers: leftclaw, rightclaw, clawdheart, clawdgut)
- Note: contract currently deployed in **test mode** (prices ~1/50th of production values)

### Security Audit
- No critical findings
- 1 HIGH fixed in V1 (fee underflow on dispute refund — no longer applicable in V2)
- 2 MEDIUM fixed (min custom amount, stuck token recovery)
- ReentrancyGuard, SafeERC20, Ownable
- All state-changing functions protected

### Frontend (SE2 + Next.js)
- Landing page with 9 service cards organized by tier
- Job posting flow with CLAWD payment
- Job board with status badges
- Job detail page with full lifecycle info
- "How it works" section
- Base mainnet + `onlyLocalBurnerWallet: true`

### ENS
- Created `leftclaw.services` subdomain
- Set IPFS content hash
- Live at `leftclaw.services`

## Gas Costs
- Contract deployment: ~0.00004 ETH (Base)
- ENS subname creation: ~$0.01 (Ethereum L1)
- ENS content hash update: ~$0.01 (Ethereum L1)
- Ownership transfer: minimal (Base)

## Token Addresses
- CLAWD: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Uniswap V3 Router: `0x2626664c2603336E57B271c5C0b26F421741e481`
- WETH: `0x4200000000000000000000000000000000000006`
