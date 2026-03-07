# SwapAndBurn — ERC20 Security Audit Findings

**Contract**: `SwapAndBurn.sol`
**Date**: 2026-03-06
**Auditor**: leftclaw (automated)
**Checklist**: evm-audit-erc20 (Weird ERC20 Token Security Checklist)
**Scope**: ERC20 token interaction edge cases

---

## [ERC20-1] Zero Slippage Protection Enables Sandwich Attacks

**Severity**: High
**Category**: evm-audit-erc20
**Location**: `execute()` lines with `amountOutMinimum: 0`

**Description**: Both the ETH→CLAWD and USDC→CLAWD swaps use `amountOutMinimum: 0`, meaning the contract accepts any output amount. An MEV searcher can sandwich the `execute()` transaction: front-run to move the price, let the swap execute at a terrible rate, then back-run to profit. The larger the balance being swapped, the more value is extracted. This directly reduces the amount of CLAWD burned.

**Proof of Concept**:
1. Contract holds 10 ETH.
2. Attacker sees `execute()` in mempool.
3. Attacker front-runs: buys CLAWD with large WETH amount, pushing price up.
4. `execute()` swaps 10 ETH → CLAWD at inflated price, receiving far fewer CLAWD.
5. Attacker back-runs: sells CLAWD, pocketing the difference.

**Recommendation**: Accept a `minAmountOut` parameter or use a TWAP oracle to compute a minimum. At minimum, allow the caller to specify slippage:
```solidity
function execute(uint256 minClawdOut) external {
    // ...
    // In each swap:
    amountOutMinimum: minClawdOut
}
```

---

## [ERC20-2] USDC Blocklist Can Permanently DoS Contract

**Severity**: Medium
**Category**: evm-audit-erc20
**Location**: `execute()` — USDC swap path

**Description**: USDC (Circle) has an admin-controlled blocklist. If the SwapAndBurn contract address is added to the USDC blocklist, `USDC.balanceOf(address(this))` will still return a balance, but any `transferFrom` / `approve` / `transfer` involving the contract will revert. USDC sent to the contract before blocklisting becomes permanently stuck. The ETH path remains functional.

**Proof of Concept**:
1. Circle adds SwapAndBurn's address to the USDC blocklist.
2. Any USDC already held by the contract cannot be swapped — `USDC.forceApprove()` reverts.
3. USDC is stuck forever (no rescue function, no owner).

**Recommendation**: This is largely an accepted risk for permissionless contracts interacting with USDC. Document it. Optionally add a rescue function for stuck tokens gated behind a timelock or governance. Note: adding an owner would change the permissionless design.

---

## [ERC20-3] USDC Transfer Pause Can Block execute()

**Severity**: Low
**Category**: evm-audit-erc20
**Location**: `execute()` — USDC swap path

**Description**: USDC has a pause mechanism that halts all transfers. If USDC is paused, the USDC branch of `execute()` reverts. However, since the ETH and USDC branches are independent (USDC failure doesn't block ETH), this only affects the USDC path. If USDC balance > 0 and USDC is paused, the entire `execute()` call reverts because the USDC `forceApprove` or the router's `transferFrom` will fail.

**Proof of Concept**:
1. Contract holds both ETH and USDC.
2. USDC is paused by Circle.
3. `execute()` is called — ETH swap succeeds, but USDC `forceApprove` reverts, reverting the whole transaction.

**Recommendation**: Wrap the USDC swap in a try/catch, or split into separate `executeETH()` and `executeUSDC()` functions so one path's failure doesn't block the other:
```solidity
function executeETH() external { /* ETH path only */ }
function executeUSDC() external { /* USDC path only */ }
```

---

## [ERC20-4] No Stuck Token Rescue Mechanism

**Severity**: Low
**Category**: evm-audit-erc20
**Location**: Contract-level

**Description**: If tokens other than USDC/ETH are accidentally sent to the contract (e.g., CLAWD, WETH, random tokens), they are permanently stuck. There is no sweep or rescue function. The contract is ownerless by design, so no recovery is possible.

**Proof of Concept**:
1. User accidentally sends CLAWD directly to SwapAndBurn.
2. No function exists to recover it. Funds are lost.

**Recommendation**: Add a permissionless sweep for non-USDC/non-ETH tokens, or at minimum handle WETH and CLAWD balances in `execute()`. For CLAWD, the contract could simply forward any held CLAWD to DEAD:
```solidity
uint256 clawdBal = CLAWD.balanceOf(address(this));
if (clawdBal > 0) {
    CLAWD.safeTransfer(DEAD, clawdBal);
    totalClawd += clawdBal;
}
```

---

## Checklist Items — No Finding (Pass)

The following checklist items were reviewed and are not applicable or not vulnerable:

| Checklist Item | Status | Notes |
|---|---|---|
| **Fee-on-transfer tokens** | ✅ Pass | Contract only handles USDC (no fee-on-transfer on Base) and ETH. Uses `balanceOf()` to measure actual holdings. Router handles swap amounts internally. |
| **Rebasing tokens** | ✅ N/A | Contract doesn't hold rebasing tokens. Balances are read and swapped atomically in `execute()`. |
| **Revert on zero-amount transfer** | ✅ Pass | Both ETH and USDC branches check `> 0` before proceeding. |
| **Revert on transfer to specific addresses** | ✅ N/A | USDC and WETH don't have destination restrictions. CLAWD is sent to `0xdead` by the router. |
| **Multiple-address tokens** | ✅ N/A | USDC on Base has a single canonical address. |
| **Flash-mintable tokens** | ✅ N/A | Contract doesn't use `totalSupply` for pricing. |
| **USDT approve race condition** | ✅ Pass | Uses `forceApprove()` (SafeERC20) which resets to 0 first. No USDT involved anyway. |
| **BNB zero-approval revert** | ✅ N/A | No BNB interaction. |
| **Infinite approval drain** | ✅ Pass | Approvals are set per-call to exact amounts needed, not infinite. |
| **Missing return values** | ✅ Pass | Uses OpenZeppelin SafeERC20 (`forceApprove`). Handles non-standard returns. |
| **Solmate SafeTransferLib** | ✅ N/A | Uses OpenZeppelin, not Solmate. |
| **Decimal quirks** | ✅ N/A | No hardcoded decimal math. Router handles conversions. |
| **ERC777 reentrancy** | ✅ N/A | Only interacts with USDC, WETH, CLAWD — none are ERC777. |
| **ERC677 hooks** | ✅ N/A | No LINK or ERC677 tokens. |
| **Permit edge cases** | ✅ N/A | Contract doesn't use `permit()`. |
| **Rebasing tokens in AMMs** | ✅ N/A | Not an AMM. |
| **UNI/COMP uint96 limits** | ✅ N/A | Not interacting with UNI/COMP. |
| **transferFrom src==msg.sender** | ✅ N/A | No `transferFrom` with self-as-source. |
| **cUSDCv3 max transfer** | ✅ N/A | Uses actual `balanceOf` values. |
| **Native currency ERC20 double-spend** | ✅ N/A | ETH is wrapped to WETH before swap. No dual-path for same asset. |
| **Non-string metadata** | ✅ N/A | Contract doesn't read token metadata. |
| **Cross-chain decimal differences** | ✅ N/A | Deployed only on Base. |
| **Phantom permit functions** | ✅ N/A | No permit usage. |
| **Transfer to self (token address)** | ✅ N/A | Never transfers to token's own address. |
| **Admin minting/burning** | ✅ Info | USDC admin could mint unlimited USDC, but this doesn't harm SwapAndBurn — it just means more CLAWD gets burned. |
| **Tether Gold false returns** | ✅ N/A | Not interacting with Tether Gold. |
| **USDT upgradeable on Polygon** | ✅ N/A | Base mainnet only. |
| **Gnosis Chain callbacks** | ✅ N/A | Base mainnet only. |

---

## Summary

| # | Finding | Severity |
|---|---------|----------|
| ERC20-1 | Zero slippage protection enables sandwich attacks | High |
| ERC20-2 | USDC blocklist can permanently DoS contract | Medium |
| ERC20-3 | USDC transfer pause blocks entire execute() | Low |
| ERC20-4 | No stuck token rescue mechanism | Low |

**Overall**: The contract is simple and well-written. SafeERC20 is used correctly, balance checks prevent zero-amount operations, and approvals use `forceApprove`. The most significant issue is the zero slippage protection (ERC20-1), which will leak value to MEV on every execution.
