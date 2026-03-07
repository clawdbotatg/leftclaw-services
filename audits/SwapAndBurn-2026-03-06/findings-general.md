# SwapAndBurn — General Security Audit Findings

**Contract**: `SwapAndBurn.sol`
**Date**: 2026-03-06
**Auditor**: leftclaw (automated)
**Checklist**: evm-audit-general
**Chain**: Base mainnet (8453)

---

## [G-1] Zero Slippage Protection Enables Sandwich Attacks
**Severity**: High
**Category**: evm-audit-general
**Location**: `execute()` lines ~55, ~75 (`amountOutMinimum: 0`)

**Description**: Both swap calls set `amountOutMinimum: 0`, meaning the contract accepts any output amount including near-zero. Since `execute()` is permissionless and callable by anyone, a MEV searcher can sandwich the transaction: front-run by moving the pool price against the swap, then back-run to profit. The contract could lose nearly 100% of swap value.

**Proof of Concept**:
1. Contract holds 10 ETH (~$25k).
2. Attacker sees `execute()` in mempool.
3. Attacker front-runs by buying CLAWD, moving price up.
4. `execute()` swaps at inflated price, getting far fewer CLAWD.
5. Attacker back-runs by selling CLAWD at profit.

**Recommendation**: Add an oracle-based or caller-supplied minimum output:
```solidity
function execute(uint256 minClawdOut) external {
    // ... swaps ...
    require(totalClawd >= minClawdOut, "slippage");
}
```
Alternatively, use a TWAP oracle to compute a reasonable minimum.

---

## [G-2] `forceApprove` Used But Contract Imports `SafeERC20` — Compilation Concern
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()` — `WETH.forceApprove(...)`, `USDC.forceApprove(...)`

**Description**: `forceApprove` is called on `WETH` and `USDC` which are typed as `IERC20`. The `using SafeERC20 for IERC20` declaration enables this. `forceApprove` first tries setting to 0 then to the desired amount — this is correct for USDT-like tokens. For USDC and WETH which have standard approve, `safeApprove` or `safeIncreaseAllowance` would also work, but `forceApprove` is fine and safe.

**Proof of Concept**: N/A — no issue.

**Recommendation**: No action needed. This is informational.

---

## [G-3] No Issue — External Calls & Low-Level Interactions
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: Walking through all external call checklist items:
- **Call to non-existent address**: All addresses are hardcoded constants (WETH, USDC, ROUTER, CLAWD) — verified deployed contracts on Base. No risk.
- **Returndata bombing**: No raw `.call()` to untrusted addresses. All calls go through typed interfaces.
- **Fixed gas in `.call{gas: X}`**: No fixed gas calls.
- **`msg.value` in multicall/loop**: No multicall or loop pattern. `msg.value` is not used directly — ETH is received via `receive()` and swapped from balance.
- **try/catch**: Not used.
- **`abi.encodePacked` hash collisions**: `abi.encodePacked` is used for Uniswap V3 path encoding with fixed-size types (`address`, `uint24`), so no collision risk.
- **Delegate calls**: None.
- **ETH transfer via `transfer()`/`send()`**: Not used.
- **Unchecked `.call()` return**: No raw `.call()`.

**Proof of Concept**: N/A.
**Recommendation**: No action needed.

---

## [G-4] Force-Feeding ETH Doesn't Break Contract Logic (Benign)
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()` — `address(this).balance`

**Description**: The contract uses `address(this).balance` to determine how much ETH to swap. Force-fed ETH (via selfdestruct, CREATE2 pre-send, or coinbase) would simply be included in the next `execute()` call and swapped to CLAWD then burned. This is actually **beneficial** — extra ETH gets burned as CLAWD. There's no invariant that depends on a specific balance.

**Proof of Concept**: Force-feed 1 ETH via selfdestruct → next `execute()` swaps it to CLAWD and burns. No harm.

**Recommendation**: No action needed. The design is resilient to force-feeding.

---

## [G-5] Direct Token Transfers Are Handled Correctly
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()` — `USDC.balanceOf(address(this))`

**Description**: The contract uses `USDC.balanceOf(address(this))` and `address(this).balance` (for ETH) rather than internal accounting. Direct transfers of USDC or ETH are simply included in the next burn. No internal accounting to desync. If someone sends CLAWD directly, it sits in the contract forever (minor dust loss for sender, not a contract vulnerability). Other random ERC20 tokens sent would also be stuck — but this is expected for a purpose-built contract.

**Proof of Concept**: N/A.
**Recommendation**: Consider adding a `rescueToken(address token)` function for accidentally sent non-USDC/non-WETH tokens. However, since the contract is ownerless, this would need a permissionless design and could be complex. Low priority.

---

## [G-6] No Issue — Pause Mechanism
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No pause mechanism exists. The contract is fully permissionless with no admin. All pause-related checklist items are not applicable.

**Proof of Concept**: N/A.
**Recommendation**: No action needed.

---

## [G-7] No Issue — Reentrancy
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()`

**Description**: Walking through reentrancy items:
- **Read-only reentrancy**: Contract has no view functions that expose intermediate state.
- **Cross-contract reentrancy**: Contract doesn't share state with other contracts.
- **ERC721/ERC1155 callbacks**: Not applicable.
- **ERC777 hooks**: USDC and WETH are not ERC777. CLAWD is sent directly to DEAD address, not to a user-controlled address. Even if CLAWD were ERC777 (it's not — it's a standard ERC20), the recipient is `0xdead`, not an attacker.
- **nonReentrant modifier ordering**: No reentrancy guard used, but also not needed — the contract has no state to corrupt. It reads balances, swaps, and burns in one transaction. Re-entering `execute()` mid-execution would just see 0 balances.

**Proof of Concept**: N/A.
**Recommendation**: No action needed.

---

## [G-8] No Issue — Merkle Tree
**Severity**: Info
**Category**: evm-audit-general
**Location**: N/A

**Description**: No Merkle tree usage. Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-9] No Issue — Code Structure
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: Walking through code structure items:
- **Withdraw/deposit asymmetry**: No deposit/withdraw pattern.
- **Semantic overloading**: No ambiguous return values. `execute()` returns nothing.
- **Duplicated logic**: The two swap paths (ETH and USDC) are inherently different (single-hop vs multi-hop), so duplication is expected.
- **Documentation-code mismatch**: NatSpec says "Receives USDC or ETH, swaps to CLAWD via Uniswap V3, burns to dead address" — matches code exactly.
- **Deployment scripts**: Out of scope for this contract audit.

**Proof of Concept**: N/A.
**Recommendation**: No action needed.

---

## [G-10] No Issue — Array and Loop Hazards
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No loops or arrays in the contract. Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-11] No Issue — Block/Time Assumptions
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No `block.timestamp` or `block.number` usage. Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-12] No Issue — Comparison & Logic Operators
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()` — `if (ethBal > 0)`, `if (usdcBal > 0)`, `if (totalClawd > 0)`

**Description**: The `> 0` checks are correct — they skip the swap when balance is zero, avoiding wasted gas on zero-amount swaps. No off-by-one risk since swapping exactly 0 tokens would revert anyway.

**Proof of Concept**: N/A.
**Recommendation**: No action needed.

---

## [G-13] No Issue — Multi-Agent Systems
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No role-based system. Anyone can call `execute()`. No receiver parameters. The recipient is hardcoded as `DEAD`. No multi-agent concerns.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-14] PUSH0 Opcode — Base Compatibility Confirmed
**Severity**: Info
**Category**: evm-audit-general
**Location**: `pragma solidity ^0.8.20`

**Description**: Solidity ≥0.8.20 emits `PUSH0` by default. Base (being an OP Stack L2) supports `PUSH0` since the Dencun upgrade. This is safe for Base mainnet.

**Proof of Concept**: N/A.
**Recommendation**: No action needed for Base. If deploying to other chains, verify PUSH0 support.

---

## [G-15] No Issue — Unchecked Blocks, Downcasting, Type Safety
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No `unchecked` blocks. No downcasting. No signed-to-unsigned conversions. No small-type arithmetic. All arithmetic uses `uint256` implicitly. The `uint24` fee constants are used only as Uniswap parameters, not in arithmetic.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-16] No Issue — Storage/Memory Pitfalls
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No storage variables (all are `constant`/`immutable`). No structs, no mappings, no memory-to-storage concerns. No `delete` operations. No state variable shadowing (no inheritance beyond implicit).

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-17] No Issue — ERC20 Edge Cases
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()`

**Description**: Walking through ERC20 edge cases:
- **Fee-on-transfer**: USDC on Base has no fee-on-transfer. WETH has no fee-on-transfer. Even if a fee-on-transfer token were sent, the contract uses `balanceOf` to determine amounts, and the Uniswap router would simply swap whatever it receives.
- **Rebasing tokens**: USDC and WETH are not rebasing.
- **ERC4626 inflation**: Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-18] Stuck CLAWD Tokens If Sent Directly
**Severity**: Low
**Category**: evm-audit-general
**Location**: `execute()`

**Description**: If someone accidentally sends CLAWD tokens directly to this contract, they are permanently stuck. The contract only swaps USDC and ETH — it never transfers its CLAWD balance. Since there's no owner and no rescue function, these tokens are effectively burned (stuck forever) but not sent to DEAD.

**Proof of Concept**: Send 1000 CLAWD to SwapAndBurn address → tokens sit in contract forever.

**Recommendation**: Add a sweep for CLAWD balance at the end of `execute()`:
```solidity
uint256 clawdBal = CLAWD.balanceOf(address(this));
if (clawdBal > 0) {
    CLAWD.safeTransfer(DEAD, clawdBal);
    totalClawd += clawdBal;
}
```

---

## [G-19] No Issue — Reorg Risk
**Severity**: Info
**Category**: evm-audit-general
**Location**: Contract-wide

**Description**: No CREATE deployments or pre-computed addresses. Base has very fast finality. Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

## [G-20] Execute Can Be Called With Zero Balance (Gas Waste Only)
**Severity**: Info
**Category**: evm-audit-general
**Location**: `execute()`

**Description**: If called when both ETH and USDC balances are 0, the function does nothing (both `if` blocks skipped, no event emitted). This is harmless — the caller just wastes gas.

**Proof of Concept**: Call `execute()` with no funds in contract → no-op.

**Recommendation**: Could add `require(ethBal > 0 || usdcBal > 0, "nothing to swap")` for better UX, but not a security issue.

---

## [G-21] No Issue — Devdacian Auction/Loan Patterns
**Severity**: Info
**Category**: evm-audit-general
**Location**: N/A

**Description**: No auction, loan, or refinancing patterns. Not applicable.

**Proof of Concept**: N/A.
**Recommendation**: N/A.

---

# Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 1 |
| Info | 19 |

**Key Findings**:
1. **[G-1] HIGH — Zero slippage protection** enables sandwich attacks, potentially losing nearly all swap value. This is the most important finding.
2. **[G-18] LOW — Stuck CLAWD tokens** if sent directly to the contract.

The contract is otherwise well-designed for its purpose: simple, stateless, permissionless, with no admin keys or complex logic. The attack surface is minimal.
