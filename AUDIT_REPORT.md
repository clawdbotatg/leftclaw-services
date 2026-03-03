# LeftClawServices — Security Audit Report

**Contract:** `LeftClawServices.sol`
**Repo:** `github.com/clawdbotatg/leftclaw-services`
**Auditor:** LeftClaw (AI) via evm-audit-skills
**Date:** 2026-03-03
**Target Chain:** Base (OP Stack L2)
**Solidity:** ^0.8.20
**Dependencies:** OpenZeppelin Contracts (Ownable, ReentrancyGuard, SafeERC20)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 5 |
| Info | 4 |

---

## Findings

## [H-1] `postJobWithUsdc` does not enforce service price for non-CUSTOM types
**Severity**: High
**Category**: evm-audit-general
**Location**: `postJobWithUsdc()`
**Description**: When posting a job with USDC, the function accepts any `serviceType` (including non-CUSTOM types like `BUILD_XL`) but does not validate that the resulting `clawdReceived` from the swap meets the `servicePriceInClawd[serviceType]` threshold. A user can post a `BUILD_XL` job (normally ~8.3M CLAWD) by paying 1 USDC worth of CLAWD. The `serviceType` is stored on-chain and used to categorize the job, so executors would see a `BUILD_XL` job with a tiny payment.

This also bypasses the `postJobCustom` minimum of 1 CLAWD — `postJobWithUsdc` has no minimum CLAWD output requirement beyond the user-supplied `minClawdOut` (which can be 0).

**Proof of Concept**:
1. Call `postJobWithUsdc(ServiceType.BUILD_XL, "QmCID...", 1, 0)` with 1 USDC (1e6 units)
2. Swap yields some trivial CLAWD amount
3. Job is created with `serviceType = BUILD_XL` but `paymentClawd` is negligible
4. Executor sees a BUILD_XL job, accepts it expecting ~$2500 worth of work, but escrow only holds dust

**Recommendation**:
```solidity
function postJobWithUsdc(...) external nonReentrant {
    // ...swap logic...
    uint256 clawdReceived = uniswapRouter.exactInput(params);

    // Enforce minimum price for non-CUSTOM types
    if (serviceType != ServiceType.CUSTOM) {
        uint256 minPrice = servicePriceInClawd[serviceType];
        require(clawdReceived >= minPrice, "Insufficient CLAWD from swap");
    } else {
        require(clawdReceived >= 1e18, "Min 1 CLAWD");
    }

    _createJob(msg.sender, serviceType, clawdReceived, usdcAmount, descriptionCID);
}
```

---

## [M-1] `disputeJob` missing `nonReentrant` modifier
**Severity**: Medium
**Category**: evm-audit-general
**Location**: `disputeJob()`
**Description**: Every other state-changing function in the contract uses `nonReentrant` except `disputeJob()`. While `disputeJob` doesn't make external calls itself (so classic reentrancy isn't directly exploitable here), the inconsistency violates the defense-in-depth principle. If future modifications add external calls, or if read-only reentrancy is a concern for integrating contracts reading `job.status`, this becomes a vector.

**Proof of Concept**: Currently no direct exploit, but if an ERC777-style callback token were somehow involved in a future upgrade, the lack of reentrancy protection on this state transition could be exploited.

**Recommendation**: Add `nonReentrant` modifier to `disputeJob()` for consistency.

---

## [M-2] No two-step ownership transfer
**Severity**: Medium
**Category**: evm-audit-access-control
**Location**: Contract inherits `Ownable`
**Description**: The contract inherits OpenZeppelin's `Ownable` which has a single-step `transferOwnership()`. If ownership is transferred to an incorrect address, it is permanently lost. Given the owner's critical role (dispute resolution, fee management, executor management, stuck token recovery), losing ownership would mean disputes can never be resolved by the owner (though the DISPUTE_TIMEOUT mitigates fund lockup).

**Proof of Concept**: `transferOwnership(wrongAddress)` → owner permanently lost → no dispute resolution, no fee withdrawal, no price updates.

**Recommendation**: Use `Ownable2Step` instead of `Ownable`:
```solidity
import "@openzeppelin/contracts/access/Ownable2Step.sol";
contract LeftClawServices is Ownable2Step, ReentrancyGuard {
```

---

## [M-3] Owner can change `protocolFeeBps` to 0 then back to max between job completion and claim, affecting `accumulatedFees` for new jobs
**Severity**: Medium
**Category**: evm-audit-access-control
**Location**: `setProtocolFee()`
**Description**: While the contract correctly snapshots the fee at `completeJob()` time (fixing fee drift for individual jobs), the owner can change `protocolFeeBps` instantly without a timelock. This means the owner could set fees to 10% (MAX_FEE_BPS) right before a high-value job is completed, maximizing protocol extraction. Users have no warning or grace period.

**Proof of Concept**: Owner sees a 10M CLAWD job about to be completed → sets fee to 10% → executor completes → 1M CLAWD fee snapshotted → owner resets fee to 5%.

**Recommendation**: Add a timelock or delay to fee changes, or emit the event far enough in advance for executors to react. At minimum, document that the fee is snapshotted at completion time so executors understand the risk.

---

## [L-1] Hardcoded swap path and fee tiers
**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: `postJobWithUsdc()`
**Description**: The swap path `USDC → WETH (0.05%) → CLAWD (1%)` is hardcoded. If liquidity migrates to different fee tiers or if a direct USDC/CLAWD pool becomes available, the contract will use suboptimal routing. On Base, pool liquidity can shift significantly.

**Recommendation**: Add an owner-configurable swap path, or accept the path as a parameter from the caller (with appropriate validation).

---

## [L-2] View functions with unbounded iteration will fail as job count grows
**Severity**: Low
**Category**: evm-audit-dos
**Location**: `_getJobsByStatus()`, `getJobsByClient()`
**Description**: These view functions iterate over ALL jobs from 1 to `nextJobId`. While view functions don't consume on-chain gas in `eth_call`, they can still hit RPC node gas limits or timeout limits. On Base with cheap gas and high throughput, job count could grow quickly.

**Recommendation**: Add pagination parameters (offset + limit) to view functions, or maintain separate indexed mappings for jobs by status and client.

---

## [L-3] No event emitted for dispute timeout auto-resolution
**Severity**: Low
**Category**: evm-audit-general
**Location**: `claimPayment()` (disputed path)
**Description**: When an executor claims payment on a disputed job after `DISPUTE_TIMEOUT`, the status is set to `COMPLETED` and `PaymentClaimed` is emitted, but no `DisputeResolved` event is emitted. Off-chain systems tracking dispute outcomes will miss this resolution.

**Recommendation**: Emit `DisputeResolved(jobId, false)` in the dispute timeout path of `claimPayment()`.

---

## [L-4] Executor can be removed while jobs are in progress
**Severity**: Low
**Category**: evm-audit-access-control
**Location**: `removeExecutor()`
**Description**: An executor with active `IN_PROGRESS` or `COMPLETED` (in dispute window) jobs can be removed. The executor can still complete and claim those jobs (since `completeJob` and `claimPayment` check `job.executor == msg.sender`, not `isExecutor[msg.sender]`), but this behavior may be unexpected.

**Recommendation**: Either document this as intentional behavior, or add a check that the executor has no active jobs before removal.

---

## [L-5] `minClawdOut` of 0 allows sandwich attacks on USDC swaps
**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: `postJobWithUsdc()`
**Description**: The `minClawdOut` parameter is user-supplied with no minimum enforced by the contract. If a user (or frontend) sets `minClawdOut = 0`, the swap is fully sandwichable. On Base, MEV is less prevalent than mainnet but still exists via Flashbots-compatible builders.

**Recommendation**: Consider enforcing a minimum `minClawdOut` relative to `usdcAmount` using a TWAP or stored exchange rate, or at minimum document that frontends MUST calculate proper slippage.

---

## [I-1] PUSH0 opcode compatibility on Base
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: `pragma solidity ^0.8.20`
**Description**: Solidity ≥0.8.20 uses the `PUSH0` opcode by default (Shanghai EVM). Base (OP Stack) supports PUSH0 since the Canyon upgrade (early 2024), so this is not currently an issue. Documenting for completeness.

---

## [I-2] `renounceOwnership()` inherited but not overridden
**Severity**: Info
**Category**: evm-audit-access-control
**Location**: Inherited from `Ownable`
**Description**: `Ownable` includes `renounceOwnership()` which would permanently remove the owner. While the DISPUTE_TIMEOUT mechanism ensures funds aren't locked forever, renouncing ownership would disable dispute resolution, fee withdrawal, price updates, and executor management permanently.

**Recommendation**: Override `renounceOwnership()` to revert:
```solidity
function renounceOwnership() public pure override {
    revert("Cannot renounce ownership");
}
```

---

## [I-3] USDC blocklist risk for contract address
**Severity**: Info
**Category**: evm-audit-erc20
**Location**: Contract-wide
**Description**: USDC has a blocklist controlled by Circle. If the contract address is blocklisted, `postJobWithUsdc` would fail permanently since `safeTransferFrom` to a blocklisted address reverts. The CLAWD token is custom and presumably doesn't have this risk, but USDC interactions would be bricked.

**Recommendation**: Acknowledge this as an accepted risk. Consider having a fallback mechanism or documenting that USDC payments are convenience-only and CLAWD is the primary payment method.

---

## [I-4] Fee-on-transfer tokens would break accounting
**Severity**: Info
**Category**: evm-audit-erc20
**Location**: `postJob()`, `postJobCustom()`
**Description**: The contract records the exact amount passed to `safeTransferFrom` as `paymentClawd` without checking the actual received amount via balance difference. If CLAWD were a fee-on-transfer token, the contract would record more escrowed CLAWD than it actually holds, eventually causing transfer failures on payouts. Since CLAWD is a known token controlled by the team, this is informational only — but worth noting if the token design ever changes.

**Recommendation**: No action needed if CLAWD is confirmed to not have fee-on-transfer mechanics. Document this assumption.

---

## Architecture Notes (No Issues)

The following patterns were reviewed and found to be correctly implemented:

- ✅ **ReentrancyGuard** on all state-changing functions with external calls
- ✅ **SafeERC20** used for all token interactions
- ✅ **`totalLockedClawd` tracking** prevents `withdrawStuckTokens` from draining escrow
- ✅ **Fee snapshot at completion** prevents fee-drift attacks
- ✅ **DISPUTE_TIMEOUT walkaway protection** ensures no permanent fund lockup
- ✅ **MAX_FEE_BPS cap** at 10% prevents excessive fee extraction
- ✅ **Zero-address checks** on constructor parameters and admin functions
- ✅ **`forceApprove`** used for Uniswap router (handles USDT-style approval)
- ✅ **CEI pattern** followed in payment/refund flows
- ✅ **Immutable token/router addresses** prevent post-deployment tampering
