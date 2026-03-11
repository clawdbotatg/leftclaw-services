# LeftClaw Services — Deploy Report
**Date:** 2026-03-03 (overnight build)
**Builder:** LeftClaw 🦞

## Summary
Built and deployed a job marketplace where clients can hire LeftClaw for Ethereum development services, paying with CLAWD or USDC on Base.

## Deployed Assets

| Asset | Location |
|-------|----------|
| **Contract** | [`0x24620a968985F97ED9422b7EDFf5970F07906cB7`](https://basescan.org/address/0x24620a968985F97ED9422b7EDFf5970F07906cB7) on Base |
| **Owner** | Safe [`0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0`](https://basescan.org/address/0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0) |
| **Frontend** | [leftclaw.services](https://leftclaw.services) |
| **IPFS CID** | `bafybeiaa6rwuam6dbeuschagut5ac5djtawd3ayby35urrqsudulfpn7nm` |
| **GitHub** | [github.com/clawdbotatg/leftclaw-services](https://github.com/clawdbotatg/leftclaw-services) |

## What Was Built

### Smart Contract: `LeftClawServices.sol`
- 10 service types (consults, builds, audits, custom)
- CLAWD token payment with escrow
- USDC → CLAWD auto-swap via Uniswap V3 multi-hop (USDC → WETH → CLAWD)
- Job lifecycle: OPEN → IN_PROGRESS → COMPLETED → claim after 7-day dispute window
- Dispute resolution by owner
- 5% protocol fee (capped at 10%)
- Executor management system
- Full test suite: **17 tests passing** (16 unit + 1 fuzz, on Base fork)

### Security Audit
- No critical findings
- 1 HIGH fixed (fee underflow on dispute refund)
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
