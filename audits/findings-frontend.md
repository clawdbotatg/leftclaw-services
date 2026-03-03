# Frontend QA Findings — LeftClawServices

**Date**: 2026-03-03
**Auditor**: clawdhead (clawdadglm)

---

## [MEDIUM-FE-1] Missing Approve Flow in Post Job Page

**Severity**: Medium (UX / Breaking Flow)  
**Category**: Frontend UX  
**Location**: `packages/nextjs/app/post/page.tsx`

**Description**:  
The post job page does not proactively check CLAWD allowance and show an approve button. Instead, it catches the "insufficient allowance" error and shows an alert telling users to go to the Debug page.

Per ethskills.com/frontend-ux, every token interaction needs a proper approve flow:
> **Four-State Flow — Connect → Network → Approve → Action**
> Show exactly ONE big button at a time:
> 3. Not enough approved? → "Approve" button (with loader)

**Current Code**:
```tsx
const handlePost = async () => {
  try {
    setStep("post");
    await postAsync({ functionName: "postJob", args: [...] });
  } catch (e: any) {
    if (e?.message?.includes("insufficient allowance")) {
      alert("You need to approve CLAWD spending first. Visit the Debug page...");
    }
  }
};
```

**Expected Behavior**:
1. Read user's CLAWD allowance for the contract
2. If allowance < price: show "Approve CLAWD" button
3. After approval confirms: show "Post Job" button
4. Each button has its own loading state

**Recommendation**:
```tsx
const { data: allowance } = useScaffoldReadContract({
  contractName: "CLAWD", // from externalContracts
  functionName: "allowance",
  args: [address, LEFTCLAW_SERVICES_ADDRESS],
});

const { writeContractAsync: approveAsync } = useScaffoldWriteContract("CLAWD");

const needsApproval = allowance ? allowance < priceWei : true;

// Then in UI:
if (!address) {
  return <ConnectWalletButton />;
}

if (needsApproval) {
  return (
    <button 
      onClick={handleApprove}
      disabled={step === "approve"}
      className={step === "approve" ? "loading" : ""}
    >
      {step === "approve" ? "Approving..." : "Approve CLAWD"}
    </button>
  );
}

return (
  <button onClick={handlePost} disabled={step === "post"}>
    {step === "post" ? "Posting..." : "Post Job 🦞"}
  </button>
);
```

---

## [LOW-FE-1] No Network Switch Prompt

**Severity**: Low  
**Category**: Frontend UX  
**Location**: `packages/nextjs/app/post/page.tsx`

**Description**:  
The app is deployed on Base mainnet, but there's no network switch prompt if the user is on a different chain.

**Recommendation**:  
Add network switch check:
```tsx
import { useSwitchChain } from "wagmi";
import { base } from "viem/chains";

const { chain } = useAccount();
const { switchChain } = useSwitchChain();

if (chain?.id !== base.id) {
  return (
    <button onClick={() => switchChain({ chainId: base.id })}>
      Switch to Base
    </button>
  );
}
```

---

## [INFO-FE-1] No Loading State for Price fetch

**Severity**: Info  
**Category**: Frontend UX  
**Location**: `packages/nextjs/app/page.tsx` and `app/post/page.tsx`

**Description**:  
The price display shows "..." while loading, but there's no skeleton or loading indicator. This is acceptable but could be improved.

---

## Summary

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 1 |
| Info | 1 |

**Priority**: Fix the approve flow (MEDIUM-FE-1) before users try to post jobs.