# LeftClawServices.sol — Full Security Audit Report

**Date**: 2026-03-03
**Auditor**: clawdhead (clawdadglm)
**Contract**: `0x24620a968985F97ED9422b7EDFf5970F07906cB7` on Base
**Source**: [github.com/clawdbotatg/leftclaw-services](https://github.com/clawdbotatg/leftclaw-services)

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| **CRITICAL** | 0 | — |
| **HIGH** | 1 | 🔴 Must Fix |
| **MEDIUM** | 2 | 🟡 Should Fix |
| **LOW** | 2 | 🟢 Nice to Have |
| **INFO** | 3 | ℹ️ Consider |

**Recommendation**: Fix HIGH-1 before accepting any significant job deposits. MEDIUM issues should be addressed before production scale.

---

## HIGH-1: withdrawStuckTokens Can Drain Active Job Funds

**Severity**: HIGH  
**Category**: Access Control / Fund Safety  
**Location**: `withdrawStuckTokens()` line ~290

**Description**:  
The `withdrawStuckTokens` function allows the owner to withdraw the **entire balance** of any token, including CLAWD. The contract holds CLAWD for:
- Open jobs (waiting for executor)
- In-progress jobs
- Completed jobs (in dispute window)
- Unclaimed payments

If the owner calls `withdrawStuckTokens(CLAWD, ...)`, all user funds are drained and executors cannot claim their payments.

**Proof of Concept**:
```
1. Client posts job with 1000 CLAWD → contract receives 1000 CLAWD
2. Executor accepts and completes the job
3. Owner (malicious or compromised Safe signer) calls withdrawStuckTokens(CLAWD, owner)
4. All CLAWD transferred to owner
5. Executor calls claimPayment() → REVERT (insufficient balance)
```

**Recommendation**:
```solidity
function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
    require(to != address(0), "Zero address");
    require(token != address(clawdToken), "Cannot withdraw CLAWD - use withdrawProtocolFees");
    uint256 balance = IERC20(token).balanceOf(address(this));
    require(balance > 0, "No tokens to withdraw");
    IERC20(token).safeTransfer(to, balance);
}
```

---

## MEDIUM-1: Fee Calculation Inconsistency on Fee Change

**Severity**: MEDIUM  
**Category**: Accounting  
**Location**: `completeJob()`, `claimPayment()`, `resolveDispute()`

**Description**:  
The protocol fee is calculated at two different times with potentially different `protocolFeeBps` values:
1. `completeJob()`: fee calculated and added to `accumulatedFees`
2. `claimPayment()`: fee recalculated for payout
3. `resolveDispute()`: fee recalculated

If owner changes `protocolFeeBps` between completion and claim, accounting breaks.

**Proof of Concept**:
```
1. Job completes with 5% fee: accumulatedFees += 50 CLAWD
2. Owner changes fee to 10%
3. Executor claims: recalc fee = 100 CLAWD, payout = 900 CLAWD
4. Owner withdraws fees: gets 50 CLAWD (what accumulatedFees says)
5. 50 CLAWD stuck in contract (accounting mismatch)
```

**Recommendation**: Store fee at completion time:
```solidity
struct Job {
    // ... existing fields
    uint256 protocolFee; // Fee recorded at completion
}
```

---

## MEDIUM-2: No Approve Flow in Frontend

**Severity**: MEDIUM  
**Category**: Frontend UX / Breaking Flow  
**Location**: `packages/nextjs/app/post/page.tsx`

**Description**:  
Post job page doesn't check CLAWD allowance or show approve button. Shows error alert directing users to Debug page instead.

Per ethskills.com/frontend-ux: "Four-State Flow — Connect → Network → Approve → Action"

**Recommendation**: Add proper approve flow with `useScaffoldReadContract` to check allowance and `useScaffoldWriteContract` to approve.

---

## LOW-1: No Pause Mechanism

**Severity**: LOW  
**Category**: Emergency Controls  
**Location**: Contract-wide

**Description**: No emergency pause. If a critical bug is discovered, no way to halt operations.

**Recommendation**: Add OpenZeppelin Pausable.

---

## LOW-2: No Network Switch Prompt

**Severity**: LOW  
**Category**: Frontend UX  
**Location**: `packages/nextjs/app/post/page.tsx`

**Description**: No network switch prompt if user is on wrong chain.

**Recommendation**: Add `useSwitchChain` check for Base mainnet.

---

## INFO-1: View Functions Unbounded Loops

**Severity**: INFO  
**Location**: `getOpenJobs()`, `getJobsByStatus()`, `getJobsByClient()`

O(n) loops. Acceptable for off-chain RPC calls. For scale, use event-based indexing.

---

## INFO-2: Description CID Not Validated

**Severity**: INFO  
**Location**: `postJob()`, `postJobCustom()`

Only checks `bytes(descriptionCID).length > 0`. Doesn't validate it's a valid IPFS CID. Acceptable — invalid CIDs just won't resolve.

---

## INFO-3: Hardcoded Uniswap Pool Fees

**Severity**: INFO  
**Location**: `postJobWithUsdc()` line ~140

Swap path hardcodes pool fees (500 for USDC/WETH, 10000 for WETH/CLAWD). If pools don't exist or have different fees, swaps fail.

---

## Tests Reviewed

The test suite (`LeftClawServices.t.sol`) covers:
- ✅ Post job with CLAWD
- ✅ Accept job (executor only)
- ✅ Complete and claim after dispute window
- ✅ Cannot claim during dispute window
- ✅ Dispute and refund
- ✅ Dispute and release to executor
- ✅ Cancel open job
- ✅ Custom job with min 1 CLAWD
- ✅ Fuzz test for custom amounts
- ✅ Fee withdrawal
- ⚠️ Missing: fee change scenario, withdrawStuckTokens CLAWD test

**Missing Tests**:
1. Fee calculation when `protocolFeeBps` changes mid-job
2. `withdrawStuckTokens` should fail for CLAWD (or not Drain job funds)
3. USDC swap path with invalid pool fees

---

## Files Generated

- `/audits/findings-manual.md` — Contract issues
- `/audits/findings-frontend.md` — Frontend issues
- `/audits/findings-dos.md` — DoS analysis

---

## Action Items

**Before accepting deposits:**
1. 🔴 Fix HIGH-1: Block CLAWD from `withdrawStuckTokens`

**Before production scale:**
2. 🟡 Fix MEDIUM-1: Store fee at completion time
3. 🟡 Fix MEDIUM-2: Add proper approve flow in frontend
4. 🟢 Add Pausable emergency switch
5. 🟢 Add network switch prompt

---

*Audit complete. Ready for review and fixes.*