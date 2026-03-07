# SwapAndBurn — Access Control Audit Findings

**Contract**: `SwapAndBurn.sol`
**Date**: 2026-03-06
**Auditor**: leftclaw (automated)
**Checklist**: evm-audit-access-control

---

## [AC-1] Zero Slippage Protection Enables Sandwich Attacks by Any Caller
**Severity**: High
**Category**: evm-audit-access-control
**Location**: `execute()` — lines with `amountOutMinimum: 0`

**Description**: The `execute()` function is fully permissionless and uses `amountOutMinimum: 0` for all swaps. Because anyone can call `execute()` at any time, an attacker can sandwich the transaction: (1) front-run to move the price, (2) trigger `execute()`, (3) back-run to capture the profit. In a contract with access control, a trusted caller could supply a minimum output or use a private mempool. The permissionless design removes this mitigation entirely.

**Proof of Concept**: Attacker monitors the contract's ETH/USDC balance. When it accumulates a meaningful amount, attacker bundles: (1) a large buy of CLAWD to inflate price, (2) a call to `execute()` which buys CLAWD at the inflated price with 0 slippage protection, (3) a sell of CLAWD. The CLAWD sent to the dead address is worth less than it should be.

**Recommendation**: Add a `minAmountOut` parameter to `execute()`, or implement a TWAP oracle check, or use a commit-reveal scheme. Alternatively, accept this as a design tradeoff and document it — the "loss" is borne by the burn mechanism (less CLAWD burned), not by any user's funds.

---

## [AC-2] No Access Control on execute() is Intentional but Prevents Future Parameter Changes
**Severity**: Info
**Category**: evm-audit-access-control
**Location**: `SwapAndBurn.sol` (entire contract)

**Description**: The contract has no owner, no admin, no roles, no upgradeability, and no initializer. All checklist items related to centralization risks (admin rug, instant parameter changes, upgradeability, pause abuse, corrupted owner) are **not applicable** — the contract is immutable and permissionless by design. This eliminates all centralization risk but also means pool fee tiers, token addresses, and the router address can never be updated. If Uniswap V3 migrates or pool fee tiers change, the contract becomes non-functional and must be redeployed.

**Proof of Concept**: N/A — informational observation.

**Recommendation**: Acknowledge as accepted design tradeoff. Document that redeployment is required if underlying Uniswap infrastructure changes.

---

## [AC-3] No Privilege Escalation Surface
**Severity**: Info
**Category**: evm-audit-access-control
**Location**: `SwapAndBurn.sol` (entire contract)

**Description**: Checklist items for privilege escalation (missing access controls on sensitive functions, two-step ownership, operating on other users, whitelist bypass) were evaluated. The contract has no ownership, no minting, no user-specific state, no whitelists, and no parameters to modify. The only state-changing function (`execute()`) converts the contract's own balances to CLAWD and burns them. There is no way to escalate privileges because no privileges exist. There are no user funds at risk — the contract only holds funds explicitly sent to it for burning.

**Proof of Concept**: N/A.

**Recommendation**: None.

---

## [AC-4] No Role Management, Initialization, or Multi-Agent Concerns
**Severity**: Info
**Category**: evm-audit-access-control
**Location**: `SwapAndBurn.sol` (entire contract)

**Description**: Checklist items for role management (constructor roles, role count caps, renounce ownership), initialization (unprotected initializers, deploy scripts), and multi-agent access (same-person multi-role) are all **not applicable**. The contract has no roles, no initializer, is not upgradeable, and has no multi-agent interactions. The constructor is implicit (no state set). The only "role" is "anyone who calls execute()," and this cannot cause harm beyond the sandwich attack described in AC-1.

**Proof of Concept**: N/A.

**Recommendation**: None.

---

## [AC-5] Griefing via Dust Amounts Triggering Unprofitable Swaps
**Severity**: Low
**Category**: evm-audit-access-control
**Location**: `execute()`

**Description**: Because `execute()` is permissionless, anyone can call it when the contract holds only dust amounts of ETH/USDC. The swap would execute but gas costs would far exceed the value burned. While this doesn't harm anyone's funds (the caller pays gas), it could be used to grief by front-running legitimate callers: an attacker sees a large USDC transfer to the contract, then immediately calls `execute()` on the dust that existed before the transfer lands, wasting a swap opportunity on a tiny amount. However, the large deposit would still be swapped on the next `execute()` call.

**Proof of Concept**: Contract has 1 wei ETH. Attacker calls `execute()`. Gas is wasted on a meaningless swap. No funds are lost except the attacker's gas.

**Recommendation**: Consider adding a minimum balance threshold (e.g., `require(ethBal > MIN_ETH || usdcBal > MIN_USDC || clawdBal > 0)`). However, this is low severity since the griefer bears the cost.

---

## Summary

| ID | Title | Severity |
|----|-------|----------|
| AC-1 | Zero slippage + permissionless = sandwich risk | High |
| AC-2 | Immutable design prevents future updates | Info |
| AC-3 | No privilege escalation surface | Info |
| AC-4 | No roles, init, or multi-agent concerns | Info |
| AC-5 | Dust griefing via permissionless execute | Low |

The permissionless design successfully eliminates all centralization and privilege escalation risks. The primary concern is **AC-1**: the combination of zero slippage protection and permissionless execution makes the contract vulnerable to sandwich attacks, which is the main risk normally mitigated by access control (a trusted caller would use slippage protection or private mempools).
