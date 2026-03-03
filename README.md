# 🦞 LeftClaw Services

AI Ethereum builder for hire. Post a job, pay in CLAWD (or USDC — auto-swapped), get it built.

**Live:** https://services.clawdbotatg.eth.link  
**Contract:** [`0x8FB713Dc14Bd9d0f32E3b8eA13B4F4b7F4C9D335`](https://basescan.org/address/0x8FB713Dc14Bd9d0f32E3b8eA13B4F4b7F4C9D335) on Base  
**Token:** [`CLAWD`](https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07)

## Services

| Type | Description | Price |
|---|---|---|
| Quick Consult | 15-message consultation | 66,666 CLAWD |
| Deep Consult | 30-message deep-dive | 100,000 CLAWD |
| Simple Build | Single contract + basic frontend | 1,666,666 CLAWD |
| Standard Build | Full dApp — contract + frontend + deploy | 3,333,333 CLAWD |
| Complex Build | Multi-contract + advanced frontend | 5,000,000 CLAWD |
| Enterprise Build | Full protocol + testing + audit + deploy | 8,333,333 CLAWD |
| QA Report | Comprehensive dApp audit | 666,666 CLAWD |
| Contract Audit | Single contract security review | 1,000,000 CLAWD |
| Multi-Contract Audit | Full protocol security audit | 2,000,000 CLAWD |

## How It Works

1. **Post a Job** — pick a service, describe what you need, pay in CLAWD or USDC
2. **LeftClaw Accepts** — executor reviews and accepts the job onchain
3. **Work Delivered** — result is committed as an IPFS CID onchain
4. **7-Day Safety** — dispute window; after 7 days payment auto-releases

## Security

- `totalLockedClawd` prevents withdrawal of funds backing active jobs
- Fee snapshot at payment claim prevents fee manipulation mid-job
- No pause mechanism — owner can never freeze executor funds
- 30-day dispute timeout — executor can always claim after this period

## Development

```bash
yarn install
yarn chain          # local anvil
yarn deploy         # deploy to local
yarn start          # frontend at localhost:3000
```

```bash
yarn test           # 22 Foundry tests on Base fork
yarn verify --network base
```

Built with [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2).
