# SwapAndBurn DoS Audit Findings

**Contract**: `SwapAndBurn.sol`
**Chain**: Base (8453)
**Date**: 2026-03-06
**Checklist**: evm-audit-dos

---

## [DOS-1] Zero amountOutMinimum enables sandwich attacks that waste funds (not DoS per se)
**Severity**: Info
**Category**: evm-audit-dos
**Location**: `execute()` lines 56, 75
**Description**: Both swaps use `amountOutMinimum: 0`, meaning a sandwich attacker can extract most swap value. While this doesn't cause a DoS (execute() still succeeds), it means an attacker can grief the burn by extracting almost all value from every swap. Since the contract is permissionless and anyone calls execute(), a MEV bot can sandwich every execution.
**Proof of Concept**: Attacker monitors mempool, front-runs execute() by moving the Uniswap pool price, execute() swaps at terrible rate, attacker back-runs to profit. CLAWD burned approaches zero.
**Recommendation**: Add a slippage parameter to execute(), or use a TWAP oracle to set a minimum output. Alternatively, accept this as by-design since burned CLAWD amount is "best effort."

---

## [DOS-2] Uniswap pool liquidity removal can cause execute() revert
**Severity**: Medium
**Category**: evm-audit-dos
**Location**: `execute()` — ROUTER.exactInputSingle / ROUTER.exactInput calls
**Description**: If the WETH/CLAWD pool (fee 10000) or USDC/WETH pool (fee 500) has zero liquidity, the Uniswap router will revert. An attacker who controls all liquidity in the WETH/CLAWD 1% pool could withdraw it, causing execute() to revert whenever ETH or USDC is present. This blocks burning until liquidity returns. However, because each swap is guarded by `if (balance > 0)`, the function only reverts if there IS a balance to swap but the pool is empty. The attacker cannot permanently remove liquidity from the USDC/WETH 0.05% pool (massive TVL), but the WETH/CLAWD 1% pool is likely thin.
**Proof of Concept**: 1) Attacker removes all liquidity from WETH/CLAWD 10000 pool. 2) Someone sends ETH to SwapAndBurn. 3) Anyone calls execute() → reverts on the WETH→CLAWD swap. 4) USDC and direct CLAWD burns also blocked since entire tx reverts. Note: CLAWD-only burns still blocked because the ETH swap reverts first (ETH check runs before USDC and CLAWD).
**Recommendation**: Wrap each swap in a try/catch so that failure of one swap doesn't block the others. Or allow callers to specify which assets to sweep.

---

## [DOS-3] Force-sent ETH cannot be permanently stuck but causes unnecessary swap attempts
**Severity**: Low
**Category**: evm-audit-dos
**Location**: `execute()`, `receive()`
**Description**: ETH can be force-sent via `selfdestruct` (deprecated but still functional on Base) or coinbase rewards, bypassing `receive()`. This ETH is included in `address(this).balance` and will be swapped. This is not a DoS — it's actually the intended behavior since the contract accepts ETH. However, combined with DOS-2 (empty pool), force-sent ETH that can't be swapped blocks the entire execute() function.
**Proof of Concept**: 1) Attacker drains WETH/CLAWD pool liquidity. 2) Attacker force-sends 1 wei ETH via selfdestruct. 3) execute() always tries to swap ETH → always reverts. 4) Even USDC and CLAWD direct burns are blocked.
**Recommendation**: Same as DOS-2 — use try/catch per swap leg, or allow selective execution.

---

## [DOS-4] Token blocklist cannot cause DoS (USDC blocklist)
**Severity**: Info
**Category**: evm-audit-dos
**Location**: `execute()` — USDC operations
**Description**: If the SwapAndBurn contract address itself were blocklisted by USDC (Circle), then `USDC.balanceOf(address(this))` would still return a value (USDC doesn't revert on balanceOf for blocklisted addresses), but `USDC.forceApprove()` would revert. However, the USDC path is guarded by `if (usdcBal > 0)` — if the contract is blocklisted, any USDC sent to it would be frozen, and the balance check would still pass, causing a revert on approve. This would block execute() if USDC is present. In practice, Circle blocklisting this contract is extremely unlikely.
**Proof of Concept**: Theoretical — requires Circle to blocklist the contract address.
**Recommendation**: No action needed. Extremely unlikely scenario. If paranoid, wrap USDC operations in try/catch.

---

## [DOS-5] No revert-based DoS from ETH receiver patterns
**Severity**: Info
**Category**: evm-audit-dos
**Location**: `execute()`
**Description**: The contract sends CLAWD to the DEAD address (0x...dEaD), not ETH. The DEAD address is an EOA, so ERC20 transfers to it always succeed (assuming the token doesn't block it). There are no ETH sends to external addresses — ETH is wrapped to WETH first. No revert-based DoS from receiver patterns applies.
**Proof of Concept**: N/A
**Recommendation**: None needed.

---

## [DOS-6] No unbounded loops, gas griefing, pause mechanisms, oracle dependencies, or block stuffing vulnerabilities
**Severity**: Info
**Category**: evm-audit-dos
**Location**: Entire contract
**Description**: Checklist items reviewed with no findings:
- **Returndata bombing**: No `.call()` to user-controlled addresses. All external calls are to hardcoded contracts (WETH, ROUTER, USDC, CLAWD).
- **Insufficient gas forwarding**: No manual gas limits on calls.
- **Try/catch always fails**: No try/catch used.
- **Unbounded loops**: No loops exist.
- **External calls inside loops**: No loops.
- **L2 array filling**: No arrays.
- **Block stuffing**: No time-sensitive deadlines.
- **Timelock griefing**: No timelocks.
- **Economic griefing (liquidation)**: Not applicable.
- **Account abstraction DoS**: Not applicable.
- **Pause mechanisms**: No pause functionality.
- **Oracle DoS**: No oracle dependencies.
- **balanceOf() reverting**: CLAWD.balanceOf() could theoretically revert if CLAWD token is paused, but this would be a CLAWD token issue, not SwapAndBurn's fault.
**Proof of Concept**: N/A
**Recommendation**: None needed.

---

## Summary

| ID | Title | Severity |
|----|-------|----------|
| DOS-1 | Zero slippage enables value extraction | Info |
| DOS-2 | Pool liquidity removal blocks execute() | Medium |
| DOS-3 | Force-sent ETH + empty pool = permanent revert | Low |
| DOS-4 | USDC blocklist theoretical DoS | Info |
| DOS-5 | No ETH receiver DoS patterns | Info |
| DOS-6 | Remaining checklist items — no findings | Info |

**Key recommendation**: The main actionable finding is **DOS-2/DOS-3** — wrap each swap leg in try/catch (or allow callers to choose which assets to sweep) so that one failing swap doesn't block the entire function. Currently, if the WETH/CLAWD pool is empty and *any* ETH exists in the contract (even 1 wei from selfdestruct), the entire execute() is bricked until someone re-adds pool liquidity.
