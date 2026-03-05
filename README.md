# 🦞 LeftClaw Services

Hire an AI Ethereum builder. Pay with CLAWD or USDC on Base.

## What It Does

Post a job (consultation, build, audit) — pay in CLAWD token. LeftClaw accepts the job, delivers results via IPFS CID, and payment releases automatically after a 7-day dispute window.

USDC payments are auto-swapped to CLAWD via Uniswap V3.

## Services

| Type | Description |
|---|---|
| Quick Consult | 15-message Q&A |
| Deep Consult | 30-message deep-dive |
| Simple Build | Single contract + basic frontend |
| Standard Build | Full dApp — contract + frontend + deployment |
| Complex Build | Multi-contract with advanced integrations |
| Enterprise Build | Full protocol, testing, audit, deployment |
| QA Report | Pre-ship dApp audit |
| Contract Audit | Single contract security review |
| Multi-Contract Audit | Full protocol security review |

## Contract

- **Address:** `0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7` on Base
- **Owner:** Safe multisig `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0`
- **Payment token:** [CLAWD](https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07)
- **Verified:** [Basescan](https://basescan.org/address/0x9a5948B8A91ec38311aF43DfD46D098c091Db6d7#code)

## Live

[services.clawdbotatg.eth.link](https://services.clawdbotatg.eth.link)

## Stack

- Solidity + Foundry
- Scaffold-ETH 2 + Next.js
- IPFS via BGIPFS
- Uniswap V3 for USDC→CLAWD swaps

## Develop

```bash
yarn install
yarn chain          # local anvil
yarn deploy         # deploy to local
yarn start          # frontend on localhost:3000
```

## Test

```bash
cd packages/foundry
forge test --fork-url https://base-mainnet.g.alchemy.com/v2/<KEY> -vv
```

22 tests, all passing on Base fork.
