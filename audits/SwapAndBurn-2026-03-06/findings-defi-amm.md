# SwapAndBurn — AMM/DEX Security Audit Findings

**Contract**: `SwapAndBurn.sol`
**Chain**: Base (8453)
**Date**: 2026-03-06
**Checklist**: evm-audit-defi-amm

---

## [AMM-1] Zero Slippage Protection Enables Sandwich Attacks

**Severity**: Critical
**Category**: evm-audit-defi-amm
**Location**: `execute()` — lines with `amountOutMinimum: 0`

**Description**: Both swap calls set `amountOutMinimum: 0` and `sqrtPriceLimitX96: 0`, providing zero slippage protection. Any call to `execute()` can be sandwiched by MEV bots who:
1. Front-run: buy CLAWD to inflate the price
2. Victim: `execute()` swaps at the inflated price, receiving far fewer CLAWD
3. Back-run: sell CLAWD at profit

Since this is a burn contract, the "loss" is fewer tokens burned — the MEV bot extracts value that should have been burned. On a 1% fee tier pool (FEE_WETH_CLAWD = 10000), liquidity is likely thin, making price impact and sandwich profit even larger.

**Proof of Concept**:
1. Send 10 ETH to SwapAndBurn contract
2. Attacker sees `execute()` in mempool
3. Attacker front-runs: buys CLAWD with 50 ETH, moving price up 30%
4. `execute()` swaps 10 ETH at inflated price, gets ~30% fewer CLAWD
5. Attacker back-runs: sells CLAWD, profits the difference

**Recommendation**: Accept a `minAmountOut` parameter or use a TWAP oracle to compute a floor:

```solidity
function execute(uint256 minClawdOut) external {
    // ... swaps ...
    require(totalClawd >= minClawdOut, "slippage");
    if (totalClawd > 0) emit Burned(totalClawd);
}
```

Callers should compute `minClawdOut` off-chain using current prices minus acceptable slippage (e.g., 2-5%).

---

## [AMM-2] No Swap Deadline — Transactions Can Be Held and Executed Later

**Severity**: High
**Category**: evm-audit-defi-amm
**Location**: `execute()`

**Description**: The SwapRouter02 on Base (`0x2626...e481`) removed the `deadline` field from swap params (unlike SwapRouter which had it). However, the contract has no mechanism to enforce time-bounded execution. A validator or MEV bot can hold an `execute()` transaction in the mempool and submit it at a time when the price is most unfavorable, maximizing extraction.

Combined with AMM-1 (zero slippage), the transaction can be executed at any future time at any price.

**Proof of Concept**:
1. User calls `execute()` when CLAWD price is 0.001 ETH
2. Transaction sits in mempool for hours/days
3. Validator includes it when CLAWD price is 0.01 ETH (10x higher)
4. Contract buys CLAWD at 10x the intended price, burning 10x fewer tokens

**Recommendation**: Add a deadline parameter:

```solidity
function execute(uint256 minClawdOut, uint256 deadline) external {
    require(block.timestamp <= deadline, "expired");
    // ... rest of function
}
```

---

## [AMM-3] Hardcoded Fee Tiers May Route Through Suboptimal or Non-Existent Pools

**Severity**: Medium
**Category**: evm-audit-defi-amm
**Location**: `FEE_USDC_WETH = 500`, `FEE_WETH_CLAWD = 10000`

**Description**: Fee tiers are hardcoded as constants. If liquidity migrates to a different fee tier (e.g., USDC/WETH 100 bps pool becomes deeper than the 5 bps pool, or a WETH/CLAWD 3000 pool is created with better liquidity), the contract will forever route through the original tiers, potentially getting worse execution or failing entirely if the pool is drained.

Since the contract is ownerless and immutable, there is no way to update the fee tiers.

**Proof of Concept**: If the WETH/CLAWD 10000 pool loses all liquidity and a 3000 pool becomes canonical, all `execute()` calls will either revert or get terrible prices from residual dust liquidity.

**Recommendation**: This is an accepted design tradeoff for a permissionless immutable contract. Document the dependency on specific pool fee tiers. Alternatively, deploy a new SwapAndBurn contract if routing needs change, and redirect funds there. For a more flexible design:

```solidity
function execute(bytes calldata ethPath, bytes calldata usdcPath, uint256 minClawdOut) external {
    // validate paths start/end with correct tokens
    // use caller-provided paths for routing
}
```

---

## [AMM-4] ERC20 Tokens Other Than USDC Sent to Contract Are Permanently Stuck

**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: `SwapAndBurn` contract (general)

**Description**: The contract only swaps ETH and USDC. Any other ERC20 token (including WETH or CLAWD) sent directly to the contract is permanently unrecoverable — there is no rescue function and no owner.

If someone accidentally sends CLAWD to this contract, the tokens that were meant to be in circulation (or burned via the proper path) are effectively lost.

**Proof of Concept**: Call `CLAWD.transfer(swapAndBurnAddress, 1000e18)` — tokens are stuck forever.

**Recommendation**: Add a rescue function for non-USDC tokens, or add CLAWD direct-burn logic:

```solidity
// Burn any CLAWD held directly (no swap needed)
uint256 clawdBal = CLAWD.balanceOf(address(this));
if (clawdBal > 0) {
    CLAWD.safeTransfer(DEAD, clawdBal);
    totalClawd += clawdBal;
}
```

---

## [AMM-5] Repeated `forceApprove` to Router Is Safe but Gas-Inefficient

**Severity**: Info
**Category**: evm-audit-defi-amm
**Location**: `execute()` — `WETH.forceApprove(...)`, `USDC.forceApprove(...)`

**Description**: Each `execute()` call sets a fresh approval for the exact amount needed. This is safe — no stale approval risk exists since `forceApprove` overwrites any previous value and the router consumes the full amount. However, each approval costs ~25k gas for a cold SSTORE. Since the router always consumes the full `amountIn`, the approval resets to 0 after the swap, so the next call always writes from 0 → amount (cold write).

An alternative pattern is to approve `type(uint256).max` once during construction, saving ~25k gas per token per `execute()` call. The risk is minimal since the router only pulls what `amountIn` specifies.

**Proof of Concept**: N/A — informational.

**Recommendation**: Consider one-time max approval in constructor for gas savings:

```solidity
constructor() {
    WETH.forceApprove(address(ROUTER), type(uint256).max);
    USDC.forceApprove(address(ROUTER), type(uint256).max);
}
```

---

## [AMM-6] Fee-on-Transfer Tokens — USDC Is Not FOT, But No Explicit Guard

**Severity**: Info
**Category**: evm-audit-defi-amm
**Location**: `execute()`

**Description**: The contract uses `USDC.balanceOf(address(this))` as `amountIn` and passes it directly to the router. If USDC were ever upgraded to include a transfer fee (extremely unlikely for Circle's USDC), the router would attempt to pull more tokens than available and revert. Since this contract only handles USDC and ETH (both non-FOT), this is informational only.

**Proof of Concept**: N/A — USDC is not a fee-on-transfer token.

**Recommendation**: No action needed. The hardcoded token addresses ensure only known non-FOT tokens are swapped.

---

## Summary

| ID | Title | Severity |
|----|-------|----------|
| AMM-1 | Zero Slippage Protection | Critical |
| AMM-2 | No Swap Deadline | High |
| AMM-3 | Hardcoded Fee Tiers | Medium |
| AMM-4 | Stuck Non-USDC Tokens | Low |
| AMM-5 | Repeated forceApprove Gas Cost | Info |
| AMM-6 | No FOT Guard (non-issue for USDC) | Info |

**Critical/High findings (AMM-1, AMM-2)** are standard risks for a permissionless burn contract with no slippage protection. The severity depends on expected contract balances — if balances are typically small and `execute()` is called frequently, MEV extraction is limited. If large amounts accumulate, sandwich attacks become highly profitable.
