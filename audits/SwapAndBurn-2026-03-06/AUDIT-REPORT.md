# SwapAndBurn.sol — Consolidated Security Audit Report

**Contract**: `SwapAndBurn.sol`
**Chain**: Base Mainnet (8453)
**Date**: 2026-03-06
**Auditors**: leftclaw (7 automated checklist agents)
**Checklists**: access-control, chain-specific, defi-amm, dos, erc20, general, precision-math

---

## Executive Summary

SwapAndBurn is a permissionless, ownerless contract that receives USDC/ETH, swaps them to CLAWD via Uniswap V3, and burns all CLAWD to the dead address (`0x...dEaD`). The contract is immutable with no admin, upgrade, or pause functionality.

The contract is well-written and minimal. The primary risk is **zero slippage protection** (`amountOutMinimum: 0`) which enables sandwich attacks on every execution. This was flagged independently by all 7 audit agents. Secondary concerns involve a lack of swap isolation (one failing path reverts the entire transaction) and hardcoded infrastructure dependencies.

---

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 1 |
| Medium | 3 |
| Low | 3 |
| Info | 2 |
| **Total** | **10** |

---

## Findings

### 1. [Critical] Zero Slippage Protection Enables Sandwich Attacks

**Flagged by**: ALL 7 agents (AC-1, CHAIN-1, AMM-1, DOS-1, ERC20-1, G-1, PM-1, CHAIN-9)

**Location**: `execute()` — `amountOutMinimum: 0` on both swaps

**Description**: Both swap calls accept any output amount. MEV bots can sandwich every `execute()` call: front-run to inflate CLAWD price, let the swap execute at the manipulated price, then back-run to profit. The entire swap value can be extracted. Base now supports MEV via Flashbots block builders, making this a practical attack vector.

**Impact**: Up to 100% of swap value can be extracted per execution. The burn mechanism receives near-zero CLAWD while the attacker profits the difference.

**Recommendation**: Add a caller-supplied minimum output parameter:
```solidity
function execute(uint256 minClawdOut) external {
    // ... swaps ...
    require(totalClawd >= minClawdOut, "slippage");
}
```
Callers compute `minClawdOut` off-chain using current pool prices minus acceptable slippage (2-5%).

---

### 2. [High] No Swap Deadline Protection

**Flagged by**: AMM-2

**Location**: `execute()`

**Description**: SwapRouter02 on Base removed the `deadline` field. The contract has no mechanism to enforce time-bounded execution. A transaction can be held in the mempool and executed at a later time when the price is most unfavorable, maximizing MEV extraction. Combined with zero slippage, this compounds the sandwich risk.

**Recommendation**: Add a deadline parameter:
```solidity
function execute(uint256 minClawdOut, uint256 deadline) external {
    require(block.timestamp <= deadline, "expired");
    // ...
}
```

---

### 3. [Medium] Single Swap Failure Blocks Entire execute()

**Flagged by**: DOS-2, DOS-3, ERC20-3

**Location**: `execute()`

**Description**: If any swap path fails (e.g., WETH/CLAWD pool has zero liquidity, USDC is paused by Circle, or force-sent ETH triggers a swap into an empty pool), the entire `execute()` reverts. This means a failure in one path blocks ALL paths — including direct CLAWD burns. An attacker who controls WETH/CLAWD pool liquidity could drain it and force-send 1 wei ETH to permanently brick `execute()` until liquidity returns.

**Recommendation**: Wrap each swap leg in try/catch, or split into separate functions:
```solidity
function executeETH(uint256 minOut) external { /* ETH path only */ }
function executeUSDC(uint256 minOut) external { /* USDC path only */ }
function executeCLAWD() external { /* Direct CLAWD burn */ }
```

---

### 4. [Medium] Hardcoded Fee Tiers May Become Suboptimal

**Flagged by**: AMM-3

**Location**: `FEE_USDC_WETH = 500`, `FEE_WETH_CLAWD = 10000`

**Description**: Fee tiers are hardcoded constants. If liquidity migrates to different fee tiers, the contract routes through suboptimal or empty pools. The immutable design means redeployment is the only fix.

**Recommendation**: Accept as design tradeoff and document. If flexibility is desired, allow caller-supplied swap paths with token validation.

---

### 5. [Medium] USDC Blocklist Can Permanently DoS Contract

**Flagged by**: ERC20-2

**Location**: `execute()` — USDC operations

**Description**: If Circle adds the SwapAndBurn address to the USDC blocklist, any USDC held by the contract becomes permanently stuck and `forceApprove` reverts. Combined with Finding #3, this blocks the entire `execute()` function if USDC balance > 0.

**Recommendation**: Accepted risk for permissionless USDC interactions. Mitigated by Finding #3's recommendation (try/catch or separate functions).

---

### 6. [Low] Tokens Sent Directly to Contract Are Permanently Stuck

**Flagged by**: AMM-4, ERC20-4, G-18

**Location**: Contract-level (no rescue function)

**Description**: ERC20 tokens other than USDC sent to the contract (including CLAWD itself) are permanently unrecoverable. No sweep or rescue function exists.

**Recommendation**: Add CLAWD direct-burn logic to `execute()`:
```solidity
uint256 clawdBal = CLAWD.balanceOf(address(this));
if (clawdBal > 0) {
    CLAWD.safeTransfer(DEAD, clawdBal);
    totalClawd += clawdBal;
}
```

---

### 7. [Low] Dust Amount Swaps Waste Gas

**Flagged by**: AC-5, PM-2

**Location**: `execute()`

**Description**: `execute()` can be called when the contract holds only dust amounts (e.g., 1 wei ETH). The swap executes but may return 0 CLAWD due to pool math rounding, wasting gas. A griefer could also front-run legitimate callers by triggering swaps on dust amounts.

**Recommendation**: Add minimum balance thresholds:
```solidity
uint256 constant MIN_ETH = 0.001 ether;
uint256 constant MIN_USDC = 1e6; // 1 USDC
```

---

### 8. [Low] L1 Data Fee Not Documented for Integrators

**Flagged by**: CHAIN-4

**Location**: `execute()`

**Description**: On OP Stack, transactions pay L1 data posting gas (often 90%+ of total cost). Integrator contracts calling `execute()` with hardcoded gas limits based on mainnet estimates could run out of gas.

**Recommendation**: Document L1 data fee considerations for integrators.

---

### 9. [Info] Immutable Design Prevents Future Parameter Changes

**Flagged by**: AC-2

**Description**: The ownerless, immutable design eliminates all centralization risk but means pool fee tiers, token addresses, and the router address can never be updated. Redeployment required if infrastructure changes.

---

### 10. [Info] Repeated forceApprove Is Gas-Inefficient

**Flagged by**: AMM-5

**Description**: Each `execute()` sets fresh approvals (~25k gas per token). A one-time `type(uint256).max` approval in the constructor would save ~50k gas per call with minimal risk.

---

## Positive Findings

The following areas were audited and found clean:
- ✅ No reentrancy vectors (no mutable state, hardcoded recipient)
- ✅ No privilege escalation (no roles, no owner)
- ✅ SafeERC20 used correctly (`forceApprove`)
- ✅ No unsafe low-level calls
- ✅ No unchecked blocks or downcast risks
- ✅ No oracle dependencies
- ✅ PUSH0 compatible with Base
- ✅ Hardcoded addresses verified correct for Base mainnet
- ✅ No loops, arrays, or unbounded iteration
- ✅ Force-fed ETH handled gracefully (swapped and burned)
- ✅ No `transfer()`/`send()` usage (2300 gas limit safe)

---

## Methodology

Seven specialized audit agents independently reviewed the contract against comprehensive checklists covering access control, chain-specific risks (OP Stack/Base), DeFi/AMM patterns, denial-of-service vectors, ERC20 edge cases, general security, and precision/math issues. Findings were deduplicated and consolidated by severity.
