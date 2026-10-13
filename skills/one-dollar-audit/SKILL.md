---
name: one-dollar-audit
description: Get an AI security audit of a Solidity smart contract for $1 USDC on Base, paid by x402 (no account, no gas). Use when the user wants a contract audited, reviewed for vulnerabilities, or checked before deploy.
---

# One Dollar Audit

AI smart contract security review for $1. You get a written report with
severity ratings and fixes, delivered on-chain. Human page: https://onedollaraudit.com

Full, always-current instructions: https://onedollaraudit.com/skill.md — fetch it
before your first call.

## Steps

1. Ask the user for a contract address (verified on Basescan/Etherscan) or the
   source. Prefer the address for whole codebases.
2. Confirm the spend with the user. The price is in the 402 response; today it is $1.
3. `POST https://onedollaraudit.com/api/audit` with JSON
   `{"description": "<address or source>", "context": "<optional concerns>", "callbackUrl": "<optional https webhook>"}`.
   Unpaid, it answers `402` with x402 v2 requirements (USDC on Base) in the
   `PAYMENT-REQUIRED` header. Pay with `@x402/fetch`
   (`wrapFetchWithPaymentFromConfig` + `ExactEvmScheme`, network `eip155:8453`)
   from a wallet holding USDC on Base.
4. The response has `jobId` and `statusUrl`. Poll `statusUrl` (JSON) until
   `status` is `complete` (allow up to 8 hours), then give the user `reportUrl`.

Never put a private key in code you show the user; read it from their env.
