# SwapAndBurn — Precision & Math Audit Findings

**Contract**: `SwapAndBurn.sol`
**Checklist**: `evm-audit-precision-math`
**Auditor**: leftclaw (subagent)
**Date**: 2026-03-06

---

## [PM-1] Zero slippage protection enables sandwich attacks for total value extraction

**Severity**: High
**Category**: evm-audit-precision-math
**Location**: `execute()` — lines with `amountOutMinimum: 0`

**Description**: Both the ETH→CLAWD and USDC→CLAWD swaps set `amountOutMinimum: 0`. A MEV bot can sandwich the `execute()` call: front-run to move the price, let the swap execute at the manipulated price (receiving near-zero CLAWD), then back-run to profit. The entire value of the contract's balance can be extracted. While this is technically a slippage issue, the precision math angle is that rounding/truncation to near-zero output is explicitly permitted.

**Proof of Concept**:
1. Contract holds 10 ETH (~$25,000).
2. Attacker front-runs `execute()` by buying massive CLAWD, spiking price.
3. `execute()` swaps 10 ETH for near-zero CLAWD (accepted because `amountOutMinimum: 0`).
4. Attacker back-runs, selling CLAWD back, profiting ~$25,000 minus gas/fees.

**Recommendation**: Use a TWAP oracle or pass a minimum output parameter:
```solidity
function execute(uint256 minClawdOut) external {
    // ... swaps ...
    require(totalClawd >= minClawdOut, "slippage");
}
```
Or compute an on-chain TWAP-based minimum.

---

## [PM-2] Division resulting in zero — small balances yield zero CLAWD with no revert

**Severity**: Low
**Category**: evm-audit-precision-math
**Location**: `execute()`

**Description**: Per checklist item "Division resulting in zero for small values": if the contract holds dust amounts of ETH or USDC, the Uniswap swap may return 0 CLAWD due to pool math rounding. The function does not revert on zero output per-swap — it simply adds 0 to `totalClawd`. Gas is wasted on the swap call, and the input tokens are consumed for nothing.

**Proof of Concept**:
1. Send 1 wei of ETH to the contract.
2. Call `execute()`.
3. The WETH→CLAWD swap executes, consuming gas and the 1 wei, but returns 0 CLAWD.

**Recommendation**: Add a minimum balance threshold before swapping:
```solidity
uint256 constant MIN_ETH = 0.001 ether;
uint256 constant MIN_USDC = 1e6; // 1 USDC
if (ethBal > MIN_ETH) { ... }
if (usdcBal > MIN_USDC) { ... }
```

---

## Checklist Items Reviewed — No Finding

The following checklist items were explicitly reviewed and found **not applicable** to this contract:

| Checklist Item | Verdict |
|---|---|
| **Division before multiplication** | No arithmetic in contract; all math delegated to Uniswap router |
| **Hidden div-before-mul in library calls** | No `wmul`/`wdiv` or chained math library calls |
| **Extra divisions by scaling factor** | No scaling math present |
| **Protocol-favoring rounding rule** | No vault/share math; not a deposit/withdraw system |
| **Inconsistent rounding across functions** | Single function, no vault logic |
| **Inverse fee calculation error** | No fee calculations |
| **Overflow in unchecked blocks** | No `unchecked` blocks |
| **Downcast overflow** | No downcasts — all values are `uint256` or `uint24` constants |
| **Negative-to-unsigned cast** | No signed integers used |
| **Signed-unsigned arithmetic** | No signed types |
| **Overflow in time-based calculations** | No time-based math |
| **Oracle decimal mismatch** | No oracle usage |
| **Token decimal mismatch** | No cross-token price calculations; Uniswap handles internally |
| **Decimal scaling for vault** | Not a vault |
| **Zero/one remaining after division** | No fee deductions |
| **Compounding vs simple interest** | No interest math |
| **Reward per token precision loss** | No reward distribution |
| **Missing state update before claim** | No state-dependent rewards |
| **Fee shares minted after rewards** | No shares or fees |
| **Division by zero in assembly** | No assembly |
| **type(uint256).max as sentinel** | Not used |
| **Extreme weight ratios** | No weighted math |
| **Solidity time literals** | No time literals in arithmetic |
| **Off-by-one in comparisons** | `> 0` checks are correct for "has balance" semantics |
| **Unsigned underflow** | No subtraction operations |
| **Precision loss compounds** | No chained divisions |
| **Double-scaling** | No scaling operations |
| **Mismatched precision modules** | Single contract, no cross-module flow |
| **Downcast invalidating invariants** | No downcasts |
| **Rounding leaks value to traders** | No fee rounding; contract is not an AMM |

---

**Summary**: The contract has minimal internal math — it delegates all swap logic to Uniswap V3. The primary precision-math concern is **PM-1** (zero slippage tolerance enabling sandwich attacks). **PM-2** is a minor dust-handling concern. The contract is otherwise clean from a precision-math perspective.
