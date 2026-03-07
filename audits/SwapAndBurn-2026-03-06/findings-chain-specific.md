# SwapAndBurn — Chain-Specific Audit Findings
**Contract**: `SwapAndBurn.sol`
**Chain**: Base Mainnet (Chain ID 8453, OP Stack L2)
**Date**: 2026-03-06
**Auditor**: leftclaw (automated)

---

## Checklist Walk-through

### Arbitrum-specific items — N/A (Base only deployment)
### zkSync Era items — N/A
### Blast items — N/A
### BSC items — N/A
### Polygon items — N/A

### OP Stack / Base — Applicable ✅

---

## [CHAIN-1] Zero Slippage Protection Enables Sandwich Attacks
**Severity**: High
**Category**: evm-audit-chain-specific
**Location**: `execute()` — lines with `amountOutMinimum: 0`
**Description**: Both swap calls set `amountOutMinimum: 0`, meaning the contract accepts ANY output amount. While Base/OP Stack has a private mempool (sequencer-ordered), the sequencer operator CAN reorder transactions, and MEV extraction on Base is increasingly common via block builders. A sandwich attacker can: (1) front-run with a large buy to move the price, (2) the SwapAndBurn executes at the inflated price getting minimal CLAWD, (3) attacker sells back. With `amountOutMinimum: 0`, the entire swap value can be extracted.
**Proof of Concept**: 1. Attacker monitors for `execute()` calls. 2. Submits a bundle via Flashbots/Base block builder: buy CLAWD → victim execute() → sell CLAWD. 3. Victim gets near-zero CLAWD; attacker profits the difference.
**Recommendation**: Add an oracle or TWAP-based minimum output, or let the caller specify a minimum:
```solidity
function execute(uint256 minClawdOut) external {
    // ... swaps ...
    require(totalClawd >= minClawdOut, "slippage");
}
```

---

## [CHAIN-2] Block Timing Assumption — Info Only
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract-wide
**Description**: Per the OP Stack checklist item, `block.number` on Base returns L2 block numbers at 2-second intervals (6x faster than mainnet). However, SwapAndBurn does NOT use `block.number` or `block.timestamp` for any timing logic, so this is not exploitable. No issue found.
**Proof of Concept**: N/A
**Recommendation**: No action needed.

---

## [CHAIN-3] No `prevrandao` / `difficulty` Usage — Clean
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract-wide
**Description**: The contract does not use `block.prevrandao` or `block.difficulty` as randomness. No issue.
**Proof of Concept**: N/A
**Recommendation**: No action needed.

---

## [CHAIN-4] L1 Data Fee Not Accounted For in Gas Estimation
**Severity**: Low
**Category**: evm-audit-chain-specific
**Location**: `execute()`
**Description**: On OP Stack, transactions pay both L2 execution gas AND L1 data posting gas (often 90%+ of total cost). The contract itself doesn't do gas estimation, but callers using `gasleft()` or hardcoded gas limits for calling `execute()` may underestimate costs. Since the function is simple (no gas forwarding or internal gas checks), this is informational for integrators rather than a contract bug.
**Proof of Concept**: An integrator contract calling `execute()` with a hardcoded gas limit based on mainnet estimates could run out of gas on Base due to L1 data fees.
**Recommendation**: Inform integrators to account for L1 data fees. No contract change needed.

---

## [CHAIN-5] PUSH0 Opcode Compatibility
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: `pragma solidity ^0.8.20`
**Description**: Solidity ≥0.8.20 defaults to Shanghai EVM which uses the `PUSH0` opcode. Base (OP Stack) added PUSH0 support in the Canyon upgrade (already active). This is safe for Base deployment. However, if this contract were ever deployed to other chains without PUSH0 support, it would fail.
**Proof of Concept**: N/A — Base supports PUSH0.
**Recommendation**: No action needed for Base. If deploying to other chains, compile with `--evm-version paris`.

---

## [CHAIN-6] Hardcoded Addresses Are Correct for Base
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract constants
**Description**: Verified hardcoded addresses:
- **WETH**: `0x4200000000000000000000000000000000000006` ✅ — This is the canonical WETH on Base (OP Stack predeploy). Note: Ethereum mainnet WETH is `0xC02aaA39...` — completely different.
- **USDC**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` ✅ — This is native USDC on Base (Circle-issued), NOT bridged USDC.e.
- **Router**: `0x2626664c2603336E57B271c5C0b26F421741e481` ✅ — Uniswap V3 SwapRouter02 on Base.
- **CLAWD**: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07` — project-specific token, assumed correct.

All addresses are Base-specific and correct. The contract is NOT suitable for deployment on other chains without address changes.
**Proof of Concept**: N/A
**Recommendation**: No action needed. If multi-chain deployment is ever desired, parameterize addresses in constructor.

---

## [CHAIN-7] Sequencer Downtime — No Oracle Dependency
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract-wide
**Description**: The contract does not use Chainlink or any oracle. Sequencer downtime would simply prevent `execute()` from being called. When the sequencer resumes, the Uniswap pool price may be stale, but since there's no slippage protection (see CHAIN-1), this compounds the sandwich risk. However, sequencer downtime is not independently exploitable here.
**Proof of Concept**: N/A
**Recommendation**: Addressed by fixing CHAIN-1 (adding slippage protection).

---

## [CHAIN-8] No `transfer()` / `send()` Usage — Clean
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract-wide
**Description**: The contract does not use `.transfer()` or `.send()` which forward only 2300 gas and can fail on chains with different gas pricing. ETH is received via `receive()` and converted via WETH `deposit()`. Clean.
**Proof of Concept**: N/A
**Recommendation**: No action needed.

---

## [CHAIN-9] Frontrunning Risk on Base
**Severity**: Medium
**Category**: evm-audit-chain-specific
**Location**: `execute()`
**Description**: While OP Stack historically had a private sequencer mempool making traditional frontrunning difficult, Base now supports MEV via Flashbots block building. Combined with zero slippage protection (CHAIN-1), this is a real risk. The permissionless nature means anyone can call `execute()` at any time, and an attacker can time their sandwich around it.
**Proof of Concept**: Attacker uses Flashbots Base bundle to sandwich the `execute()` transaction.
**Recommendation**: Same as CHAIN-1 — add `minClawdOut` parameter. Additionally, consider a commit-reveal scheme or using a private RPC endpoint for execution.

---

## [CHAIN-10] `block.chainid` Not Used — No Fork Risk
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: Contract-wide
**Description**: The contract does not use `block.chainid` or any signature/permit functionality. No risk from chain ID caching after forks.
**Proof of Concept**: N/A
**Recommendation**: No action needed.

---

## Summary

| ID | Title | Severity |
|----|-------|----------|
| CHAIN-1 | Zero Slippage Protection Enables Sandwich Attacks | **High** |
| CHAIN-2 | Block Timing — No Usage | Info |
| CHAIN-3 | No prevrandao Usage | Info |
| CHAIN-4 | L1 Data Fee for Integrators | Low |
| CHAIN-5 | PUSH0 — Compatible | Info |
| CHAIN-6 | Hardcoded Addresses Verified Correct | Info |
| CHAIN-7 | Sequencer Downtime — No Oracle | Info |
| CHAIN-8 | No transfer()/send() | Info |
| CHAIN-9 | Frontrunning via MEV on Base | **Medium** |
| CHAIN-10 | No chain ID usage | Info |

**Critical/High: 1** (CHAIN-1 — zero slippage)
**Medium: 1** (CHAIN-9 — MEV/frontrunning)
**Low: 1** (CHAIN-4 — L1 data fees for integrators)
**Info: 7**
