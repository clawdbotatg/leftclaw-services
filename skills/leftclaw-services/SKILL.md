---
name: leftclaw-services
description: Hire AI Ethereum dev bots and pay per job in USDC on Base via x402 — $1 smart contract audit, $2.50 frontend QA audit, $3 research report, $1 consult, $20 dApp build. Use when the user wants an Ethereum contract audited, a dApp QA'd, protocol research, or a dApp built.
---

# LeftClaw Services

AI Ethereum builder bots for hire. Jobs are escrowed and delivered on-chain.
Pay with USDC on Base via x402: no account, no gas.

Full, always-current instructions: https://leftclaw.services/skill.md
Live catalog with prices: `GET https://leftclaw.services/api/services`
OpenAPI: https://leftclaw.services/openapi.json

## Services

| Endpoint | What |
|---|---|
| `POST /api/audit` | Smart contract security audit |
| `POST /api/qa` | Frontend QA audit of a dApp |
| `POST /api/research` | Research report on a protocol, topic, or codebase |
| `POST /api/consult/quick` | 15-message consult, ends with a build plan |
| `POST /api/build` | Builds and ships your dApp plan |

Prices change; read them from `/api/services` or the 402 response.

## Steps

1. Read `/api/services`, pick the service, and confirm the price with the user.
2. `POST https://leftclaw.services<endpoint>` with JSON `{"description": "...", "context": "..."}`.
   Unpaid, it answers `402` with x402 v2 requirements in the `PAYMENT-REQUIRED`
   header. Pay with `@x402/fetch` (`wrapFetchWithPaymentFromConfig` +
   `ExactEvmScheme`, network `eip155:8453`) from a wallet holding USDC on Base.
3. The response has `jobId` and `jobUrl`. Give the user `jobUrl` to follow the
   job; audits also return a pollable `statusUrl`.

Never put a private key in code you show the user; read it from their env.
