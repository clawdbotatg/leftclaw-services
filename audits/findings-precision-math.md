# Precision & Math Audit — LeftClawServices.sol

**Auditor**: evm-audit-precision-math  
**Date**: 2026-03-03  
**Contract**: `LeftClawServices.sol` (Solidity ^0.8.20)  
**Scope**: All arithmetic, fee calculations, token amount handling, precision/rounding concerns.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0     |
| High     | 1     |
| Medium   | 3     |
| Low      | 2     |
| Info     | 3     |
| **Total**| **9** |

---

## [high-1] Fee recalculation on dispute refund can underflow `accumulatedFees` if `protocolFeeBps` changed

**Severity**: High  
**Category**: evm-audit-precision-math  
**Location**: `resolveDispute()` (line ~191), `completeJob()` (line ~157)

**Description**: When a job is completed in `completeJob()`, the protocol fee is calculated and added to `accumulatedFees`:

```solidity
uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
accumulatedFees += fee;
```

When a dispute is resolved in favor of the client (`refundClient = true`), the fee is recalculated and subtracted:

```solidity
uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
accumulatedFees -= fee;
```

If the owner changes `protocolFeeBps` between `completeJob()` and `resolveDispute()`, the recalculated fee will differ from the originally accumulated fee. If the new fee is larger than what was originally accumulated, `accumulatedFees -= fee` will **revert** due to underflow (Solidity 0.8+), permanently bricking dispute resolution for that job. If the new fee is smaller, the protocol keeps "phantom fees" that aren't backed by actual tokens.

**Proof of Concept**:
1. Job posted with `paymentClawd = 1_000_000e18`, `protocolFeeBps = 500` (5%).
2. Executor completes job → `fee = 50_000e18`, `accumulatedFees += 50_000e18`.
3. Owner calls `setProtocolFee(1000)` (10%).
4. Client disputes. Owner calls `resolveDispute(jobId, true)`.
5. `fee = 100_000e18`. `accumulatedFees -= 100_000e18` → **underflow revert**.
6. Dispute can never be resolved for this job. Client funds locked forever.

**Recommendation**: Store the fee at completion time in the Job struct, so the same value is used for both accumulation and reversal.

```solidity
// In Job struct, add:
uint256 feeAtCompletion;

// In completeJob():
uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
job.feeAtCompletion = fee;
accumulatedFees += fee;

// In resolveDispute() refund path:
accumulatedFees -= job.feeAtCompletion;

// In claimPayment():
uint256 payout = job.paymentClawd - job.feeAtCompletion;
```

---

## [medium-1] Fee double-calculation allows payout mismatch if `protocolFeeBps` changes between complete and claim

**Severity**: Medium  
**Category**: evm-audit-precision-math  
**Location**: `completeJob()` (line ~157), `claimPayment()` (line ~165)

**Description**: `completeJob()` calculates and accumulates the fee. `claimPayment()` independently recalculates the fee to determine the executor payout. If `protocolFeeBps` changes between these two calls, the fee accumulated in `completeJob()` and the fee deducted in `claimPayment()` will differ. This causes either:

- **Fee increase**: Executor receives less than expected; protocol over-collects (more fees accumulated than deducted from payout).
- **Fee decrease**: Executor receives more than expected; protocol under-collects. The contract may not have enough CLAWD to cover all obligations.

This is closely related to high-1 but affects the normal (non-dispute) payment path.

**Proof of Concept**:
1. Job with `paymentClawd = 1_000_000e18`, `protocolFeeBps = 500`.
2. `completeJob()`: fee = 50,000e18 accumulated.
3. Owner changes fee to `200` (2%).
4. After dispute window, executor calls `claimPayment()`: fee = 20,000e18, payout = 980,000e18.
5. Only 50,000e18 was reserved as fees but 980,000e18 paid out = 1,030,000e18 total outflow vs 1,000,000e18 escrowed. Protocol is 30,000e18 short.

**Recommendation**: Same as high-1 — store `feeAtCompletion` in the Job struct and use it consistently in `claimPayment()` and `resolveDispute()`.

---

## [medium-2] `withdrawStuckTokens()` can drain escrowed CLAWD, breaking all active job payouts

**Severity**: Medium  
**Category**: evm-audit-precision-math  
**Location**: `withdrawStuckTokens()` (line ~221)

**Description**: This function transfers the **entire balance** of any token from the contract. If called with the CLAWD token address, it will withdraw all CLAWD — including amounts escrowed for active jobs and accumulated protocol fees. This is not strictly a precision/math bug but directly impacts token amount accounting: after calling this, `accumulatedFees` and job `paymentClawd` values no longer correspond to real balances. All subsequent `claimPayment()`, `cancelJob()`, and `resolveDispute()` calls will revert due to insufficient balance.

**Proof of Concept**:
1. Multiple active jobs with escrowed CLAWD totaling 10,000,000e18.
2. Owner calls `withdrawStuckTokens(clawdToken, ownerAddress)`.
3. All 10,000,000e18 CLAWD drained.
4. Any `claimPayment()` or `cancelJob()` reverts — funds lost.

**Recommendation**: Exclude CLAWD (and USDC during swaps) from `withdrawStuckTokens()`, or track escrowed totals and only allow withdrawing the excess:

```solidity
function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
    require(to != address(0), "Zero address");
    require(token != address(clawdToken), "Cannot withdraw escrowed CLAWD");
    uint256 balance = IERC20(token).balanceOf(address(this));
    require(balance > 0, "No tokens to withdraw");
    IERC20(token).safeTransfer(to, balance);
}
```

---

## [medium-3] Rounding direction in fee calculation favors the executor (rounds fee down)

**Severity**: Medium  
**Category**: evm-audit-precision-math  
**Location**: `completeJob()`, `claimPayment()`, `resolveDispute()`

**Description**: The fee calculation uses standard Solidity truncation (rounds toward zero):

```solidity
uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
```

This rounds the fee **down**, meaning the protocol always receives ≤ the exact fee, and the executor receives ≥ their exact share. Per the precision math checklist, fee collection should round **up** to favor the protocol. While the magnitude is small (at most 1 wei per fee calculation), this systematically leaks value from the protocol over many jobs.

**Proof of Concept**: For any `paymentClawd` where `(paymentClawd * protocolFeeBps) % 10_000 != 0`, the protocol loses 1 wei on the fee. Over thousands of jobs this compounds.

**Recommendation**: Use rounding-up division for fee calculations:

```solidity
uint256 fee = (job.paymentClawd * protocolFeeBps + 9_999) / 10_000;
// Or using OpenZeppelin Math.ceilDiv:
uint256 fee = Math.ceilDiv(job.paymentClawd * protocolFeeBps, 10_000);
```

---

## [low-1] No minimum payment validation for USDC-funded jobs after swap

**Severity**: Low  
**Category**: evm-audit-precision-math  
**Location**: `postJobWithUsdc()` (line ~128)

**Description**: When paying with USDC, the received CLAWD amount from the Uniswap swap becomes the job's `paymentClawd`. The `minClawdOut` parameter protects against slippage, but there's no minimum CLAWD amount enforced for the job itself. If the caller sets `minClawdOut = 0` or very low, they could create a job with nearly zero CLAWD payment. The `postJobCustom()` function enforces `clawdAmount >= 1e18`, but `postJobWithUsdc()` has no equivalent check on `clawdReceived`.

Also, for standard `ServiceType` (non-CUSTOM) jobs posted via USDC, there is no validation that the swapped CLAWD amount meets the `servicePriceInClawd` for that service type. A user could post a `BUILD_XL` job by paying a tiny amount of USDC.

**Proof of Concept**:
1. Call `postJobWithUsdc(ServiceType.BUILD_XL, cid, 1, 0)` — 1 wei of USDC, min 0 CLAWD out.
2. Swap yields ~0 CLAWD (or whatever dust the pool returns).
3. Job is created as `BUILD_XL` with negligible payment.

**Recommendation**: After the swap, enforce that `clawdReceived` meets the service price for non-CUSTOM types:

```solidity
if (serviceType != ServiceType.CUSTOM) {
    require(clawdReceived >= servicePriceInClawd[serviceType], "Insufficient CLAWD after swap");
} else {
    require(clawdReceived >= 1e18, "Min 1 CLAWD");
}
```

---

## [low-2] Unbounded loop in view functions could cause gas limit issues

**Severity**: Low  
**Category**: evm-audit-precision-math  
**Location**: `_getJobsByStatus()`, `getJobsByClient()`

**Description**: These functions iterate over all job IDs from 1 to `nextJobId`. As jobs accumulate, these loops grow unboundedly. While they are `view` functions (no state changes), they can still hit gas limits when called from other contracts or via `eth_call` with gas caps. This isn't a precision math issue per se, but the loop counter `i` uses `uint256` which is fine — no overflow risk.

**Proof of Concept**: After 100,000+ jobs, calling `getOpenJobs()` from another contract may exceed block gas limit.

**Recommendation**: Add pagination (offset + limit parameters) or maintain separate lists/sets per status. For offchain queries, use events and indexing instead.

---

## [info-1] Fee calculation does not suffer from division-before-multiplication

**Severity**: Info  
**Category**: evm-audit-precision-math  
**Location**: `completeJob()`, `claimPayment()`, `resolveDispute()`

**Description**: The fee formula `(job.paymentClawd * protocolFeeBps) / 10_000` correctly multiplies before dividing. No division-before-multiplication issue exists here.

---

## [info-2] No unchecked blocks, downcasts, or assembly — overflow/underflow vectors minimal

**Severity**: Info  
**Category**: evm-audit-precision-math  
**Location**: Entire contract

**Description**: The contract uses Solidity ^0.8.20 with no `unchecked` blocks, no inline assembly, no downcasts from `uint256` to smaller types, and no signed integer arithmetic. All arithmetic operations benefit from built-in overflow/underflow protection. The only underflow risk is the `accumulatedFees -= fee` in `resolveDispute()` (covered in high-1).

---

## [info-3] Both tokens use consistent decimal handling

**Severity**: Info  
**Category**: evm-audit-precision-math  
**Location**: Entire contract

**Description**: The contract exclusively escrows and pays out CLAWD tokens (18 decimals). USDC (6 decimals) is only handled transiently during the swap in `postJobWithUsdc()` and is never mixed with CLAWD in arithmetic. The `paymentUsdcApprox` field is purely informational and not used in any calculations. No decimal mismatch vulnerabilities exist.

---

## Checklist Walkthrough

Below is a systematic review of each checklist item:

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 1 | Division before multiplication | ✅ PASS | Fee calc: `(amount * bps) / 10_000` — correct order |
| 2 | Hidden div-before-mul in library calls | ✅ PASS | No `wmul`/`wdiv` or chained math library calls |
| 3 | Extra divisions by scaling factor | ✅ PASS | Single division by 10_000, no double-scaling |
| 4 | Division resulting in zero for small values | ✅ PASS | Minimum payment is 1e18 CLAWD; `1e18 * 500 / 10_000 = 5e16` — never zero |
| 5 | Protocol-favoring rounding rule | ⚠️ MEDIUM-3 | Fee rounds down, should round up |
| 6 | Inconsistent rounding across functions | ⚠️ HIGH-1, MEDIUM-1 | Fee recalculated independently in complete/claim/dispute |
| 7 | Inverse fee calculation error | ✅ PASS | Fee is simple percentage, no inverse calc needed |
| 8 | Overflow in unchecked blocks | ✅ PASS | No unchecked blocks |
| 9 | Downcast overflow | ✅ PASS | No downcasts |
| 10 | Negative-to-unsigned cast | ✅ PASS | No signed integers |
| 11 | Signed-unsigned arithmetic | ✅ PASS | No signed integers |
| 12 | Overflow in time-based calculations | ✅ PASS | `job.completedAt + DISPUTE_WINDOW` — safe with uint256 |
| 13 | Oracle decimal mismatch | ✅ N/A | No oracles used |
| 14 | Token decimal mismatch in price calculations | ✅ PASS | USDC only used in swap, not mixed with CLAWD arithmetic |
| 15 | Decimal scaling for vault with non-18 assets | ✅ N/A | Not a vault |
| 16 | Zero/one remaining after division | ✅ PASS | Fee remainder ≤ 1 wei, negligible |
| 17 | Compounding when claiming simple interest | ✅ N/A | No interest/reward accrual |
| 18 | Reward per token precision loss | ✅ N/A | No staking rewards |
| 19 | Missing state update before reward claim | ✅ N/A | No reward mechanism |
| 20 | Fee shares minted after reward distribution | ✅ N/A | No shares/minting |
| 21 | Division by zero in assembly | ✅ PASS | No assembly |
| 22 | `type(uint256).max` as sentinel value | ✅ PASS | Not used |
| 23 | Extreme weight ratios cause overflow | ✅ N/A | No weighted pool math |
| 24 | Solidity time literals are uint24 | ✅ PASS | `7 days` used as `uint256 constant`, no overflow risk |
| 25 | Rounding direction must favor protocol | ⚠️ MEDIUM-3 | See finding |
| 26 | Off-by-one in comparison operators | ✅ PASS | `block.timestamp > completedAt + DISPUTE_WINDOW` and `<= completedAt + DISPUTE_WINDOW` — consistent boundary (exactly at boundary = still in window) |
| 27 | Assigning negative to uint reverts | ✅ PASS | No such patterns; underflow in `accumulatedFees` covered in HIGH-1 |
| 28 | Unchecked blocks need explicit validation | ✅ PASS | No unchecked blocks |
| 29 | Precision loss compounds across operations | ✅ PASS | Only single-step fee calculation, no chained divisions |
| 30 | Division before mul hidden by function calls | ✅ PASS | No chained library math |
| 31 | Rounding down to zero allows state changes | ✅ PASS | Min 1e18 CLAWD prevents zero-fee jobs (except USDC path — see LOW-1) |
| 32 | ~50% value understatement from mixing precisions | ✅ PASS | No mixed-precision addition |
| 33 | Excessive precision scaling — double-scaling | ✅ PASS | No scaling operations |
| 34 | Mismatched precision — decimals vs hardcoded 1e18 | ✅ PASS | No cross-module precision flows |
| 35 | Downcast overflow invalidates pre-downcast checks | ✅ PASS | No downcasts |
| 36 | Rounding direction leaks value from protocol | ⚠️ MEDIUM-3 | Fee rounds down |

---

## Conclusion

The contract is relatively simple in its math — a straightforward fee-on-payment escrow. The most significant finding is **HIGH-1**: the fee is recalculated independently at completion, claim, and dispute resolution using the *current* `protocolFeeBps`, which means any fee rate change between these events causes accounting mismatches that can permanently lock funds via underflow revert. The recommended fix is to store the calculated fee in the Job struct at completion time and reuse that stored value everywhere.

The remaining findings are medium/low severity — rounding direction (protocol loses dust per job), the `withdrawStuckTokens` foot-gun, and missing minimum payment validation on the USDC swap path.
