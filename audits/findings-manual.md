# Manual Audit Findings — LeftClawServices.sol

**Date**: 2026-03-03
**Auditor**: clawdhead (clawdadglm)

---

## [HIGH-1] withdrawStuckTokens Can Drain Active Job Funds

**Severity**: High  
**Category**: Access Control / Fund Safety  
**Location**: `withdrawStuckTokens()` line 290

**Description**:  
The `withdrawStuckTokens` function allows the owner to withdraw the **entire balance** of any token, including CLAWD. However, the contract holds CLAWD for:
- Open jobs (waiting for executor)
- In-progress jobs
- Completed jobs (in dispute window)
- Unclaimed payments

If the owner calls `withdrawStuckTokens(CLAWD, ...)`, all user funds are drained and executors cannot claim their payments.

**Proof of Concept**:
1. Client posts a job with 1000 CLAWD
2. Executor accepts and completes the job
3. Owner (malicious or compromised) calls `withdrawStuckTokens(CLAWD, owner)`
4. All CLAWD is transferred to owner
5. Executor tries to `claimPayment()` → transaction reverts due to insufficient balance

**Recommendation**:
```solidity
function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
    require(to != address(0), "Zero address");
    require(token != address(clawdToken), "Cannot withdraw CLAWD");
    uint256 balance = IERC20(token).balanceOf(address(this));
    require(balance > 0, "No tokens to withdraw");
    IERC20(token).safeTransfer(to, balance);
}
```

Or, track claimable CLAWD separately and only allow withdrawal of excess:
```solidity
uint256 public lockedClawd; // Total CLAWD locked in active jobs

function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
    require(to != address(0), "Zero address");
    uint256 balance = IERC20(token).balanceOf(address(this));
    if (token == address(clawdToken)) {
        uint256 withdrawable = balance - lockedClawd - accumulatedFees;
        require(withdrawable > 0, "No withdrawable CLAWD");
        IERC20(token).safeTransfer(to, withdrawable);
    } else {
        require(balance > 0, "No tokens to withdraw");
        IERC20(token).safeTransfer(to, balance);
    }
}
```

---

## [MEDIUM-1] Fee Calculation Inconsistency on Fee Change

**Severity**: Medium  
**Category**: Accounting / Precision  
**Location**: `completeJob()`, `claimPayment()`, `resolveDispute()`

**Description**:  
The protocol fee is calculated at two different times with potentially different `protocolFeeBps` values:

1. In `completeJob()`: fee is calculated and added to `accumulatedFees`
2. In `claimPayment()`: fee is recalculated for payout
3. In `resolveDispute()`: fee is recalculated for refund/release

If the owner changes `protocolFeeBps` between completion and claim, the fee recorded in `accumulatedFees` won't match the actual fee deducted.

**Proof of Concept**:
1. Job completes with 5% fee (500 bps): `accumulatedFees += 50 CLAWD`
2. Owner changes fee to 10% (1000 bps)
3. Executor claims: recalculated fee = 100 CLAWD, payout = 900 CLAWD
4. `accumulatedFees` records 50, but 100 CLAWD stays in contract as fee
5. Owner calls `withdrawProtocolFees()` → withdraws 50 CLAWD
6. 50 CLAWD remains stuck in contract (accounting mismatch)

**Recommendation**:
Store the fee at completion time in the Job struct:
```solidity
struct Job {
    // ... existing fields
    uint256 protocolFee; // Fee recorded at completion
}

function completeJob(uint256 jobId, string calldata resultCID) external nonReentrant onlyExecutor {
    // ...
    uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
    job.protocolFee = fee;
    accumulatedFees += fee;
    // ...
}

function claimPayment(uint256 jobId) external nonReentrant {
    // ...
    uint256 payout = job.paymentClawd - job.protocolFee; // Use stored fee
    // ...
}
```

---

## [LOW-1] No Pause Mechanism

**Severity**: Low  
**Category**: Emergency Controls  
**Location**: Contract-wide

**Description**:  
The contract has no emergency pause mechanism. If a critical bug is discovered, there's no way to halt job posting, acceptance, or payments.

**Recommendation**:  
Add Pausable from OpenZeppelin:
```solidity
import "@openzeppelin/contracts/utils/Pausable.sol";

contract LeftClawServices is Ownable, ReentrancyGuard, Pausable {
    function postJob(...) external nonReentrant whenNotPaused { ... }
    function acceptJob(...) external nonReentrant onlyExecutor whenNotPaused { ... }
    // etc.
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
}
```

---

## [INFO-1] View Functions Unbounded Loops

Already documented in `findings-dos.md` — O(n) loops in `getOpenJobs`, `getJobsByStatus`, `getJobsByClient`. Acceptable for off-chain use.

---

## Summary

| Severity | Count |
|----------|-------|
| **Critical** | 0 |
| **High** | 1 |
| **Medium** | 1 |
| **Low** | 1 |
| **Info** | 1 |

**Recommendation**: Fix HIGH-1 before any significant funds are deposited. MEDIUM-1 should be fixed to ensure correct accounting. LOW-1 is recommended for production.