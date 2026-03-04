"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract, useSwitchChain } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import deployedContracts from "~~/contracts/deployedContracts";

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const ERC20_ABI = [
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

function parseContractError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  // ── Wallet / network ──────────────────────────────────────────────────────
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "Transaction cancelled";
  if (/insufficient funds for gas/i.test(msg)) return "Not enough ETH for gas fees";
  if (/nonce too low|nonce has already been used/i.test(msg)) return "Transaction already processed — try refreshing";
  if (/transaction underpriced/i.test(msg)) return "Gas price too low — try again";

  // ── ERC-20 (OpenZeppelin v5 selectors + name fallback) ────────────────────
  if (/e450d38c|InsufficientBalance/i.test(msg))    return "Insufficient CLAWD balance";
  if (/fb8f41b2|InsufficientAllowance/i.test(msg))  return "Allowance too low — try approving again";
  if (/96c6fd1e|ERC20InvalidSender/i.test(msg))     return "Invalid token sender address";
  if (/ec442f05|ERC20InvalidReceiver/i.test(msg))   return "Invalid token receiver address";
  if (/e602df05|ERC20InvalidApprover/i.test(msg))   return "Invalid token approver address";
  if (/5274afe7|SafeERC20FailedOperation/i.test(msg)) return "Token transfer failed";

  // ── Access control ────────────────────────────────────────────────────────
  if (/118cdaa7|OwnableUnauthorizedAccount/i.test(msg)) return "Not authorized — owner only";
  if (/1e4fbdf7|OwnableInvalidOwner/i.test(msg))        return "Invalid owner address";
  if (/3ee5aeb5|ReentrancyGuardReentrantCall|ReentrantCall/i.test(msg)) return "Reentrant call — please try again";
  if (/Not an executor/i.test(msg))                     return "Only the assigned executor can do this";

  // ── Job state ─────────────────────────────────────────────────────────────
  if (/Job does not exist/i.test(msg))           return "Job not found";
  if (/Job not OPEN/i.test(msg))                 return "This job is no longer open";
  if (/Job not IN_PROGRESS/i.test(msg))          return "This job is not currently in progress";
  if (/Job not COMPLETED/i.test(msg))            return "This job has not been completed yet";
  if (/Job not DISPUTED/i.test(msg))             return "This job is not in dispute";
  if (/Job not claimable/i.test(msg))            return "Payment cannot be claimed yet";
  if (/Not the assigned executor/i.test(msg))    return "Only the assigned executor can do this";
  if (/Not the executor/i.test(msg))             return "Only the executor can claim payment";
  if (/Not the client/i.test(msg))               return "Only the job client can do this";
  if (/Already claimed|Payment already claimed/i.test(msg)) return "Payment has already been claimed";
  if (/Can only cancel OPEN jobs/i.test(msg))    return "You can only cancel jobs that are still open";
  if (/Dispute window active/i.test(msg))        return "Dispute window is still open — executor must wait to claim";
  if (/Dispute timeout not reached/i.test(msg))  return "30-day dispute timeout hasn't passed yet";
  if (/Dispute window expired/i.test(msg))       return "Dispute window has expired — you can no longer dispute this job";

  // ── Validation ────────────────────────────────────────────────────────────
  if (/Description required/i.test(msg))                return "A description is required";
  if (/Service price not set/i.test(msg))                return "This service type has no price configured";
  if (/Use postJobCustom for CUSTOM/i.test(msg))         return "Use the Custom Amount option for custom jobs";
  if (/Min 1 CLAWD/i.test(msg))                          return "Minimum custom amount is 1 CLAWD";
  if (/USDC amount must be > 0/i.test(msg))              return "USDC amount must be greater than zero";
  if (/Not a consultation job/i.test(msg))                return "This function is only for consultation jobs";
  if (/Gist URL required/i.test(msg))                    return "A gist URL is required to complete the consultation";
  if (/Result CID required/i.test(msg))                  return "A result reference is required";
  if (/Fee too high/i.test(msg))                         return "Fee exceeds maximum allowed";
  if (/No tokens to withdraw/i.test(msg))                return "No tokens available to withdraw";
  if (/No surplus CLAWD to withdraw/i.test(msg))         return "No surplus CLAWD — all tokens are locked in active jobs";
  if (/No fees to withdraw/i.test(msg))                  return "No accumulated fees to withdraw";
  if (/Zero address/i.test(msg))                         return "Invalid address";

  // ── Fallback: extract quoted revert reason if present ────────────────────
  const revertMatch = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (revertMatch) return revertMatch[1];

  return "Transaction failed — please try again";
}

const SERVICE_NAMES: Record<number, string> = {
  0: "Quick Consult",
  1: "Deep Consult",
  2: "Simple Build (~$500)",
  3: "Standard Build (~$1000)",
  4: "Complex Build (~$1500)",
  5: "Enterprise Build (~$2500)",
  6: "QA Report (~$200)",
  7: "AI Audit (~$200/contract)",
};

export default function PostJobPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg"></span></div>}>
      <PostJobPage />
    </Suspense>
  );
}

function PostJobPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const typeParam = searchParams.get("type");
  const gistParam = searchParams.get("gist");
  const isCustom = typeParam === "custom";
  const initialType = isCustom ? 9 : (typeParam ? parseInt(typeParam) : 2);

  // Consult types have their own page — redirect
  useEffect(() => {
    if (initialType === 0 || initialType === 1) {
      router.replace(`/consult?type=${initialType}`);
    }
  }, [initialType, router]);

  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { targetNetwork } = useTargetNetwork();
  const isWrongNetwork = chainId !== targetNetwork.id;

  const [serviceType, setServiceType] = useState(initialType);
  const [description, setDescription] = useState(
    gistParam ? `Build plan: ${gistParam}\n\nSee consultation plan for full scope and requirements.` : ""
  );
  const [customAmount, setCustomAmount] = useState("");
  const [step, setStep] = useState<"form" | "approving" | "posting" | "done">("form");
  const postedJobIdRef = useRef<number | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const selectedStandard = serviceType < 9;

  const contractAddress = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}` | undefined;

  const { data: priceRaw } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "servicePriceInClawd",
    args: [serviceType],
  });

  const clawdPrice = useCLAWDPrice();
  const price = selectedStandard
    ? (priceRaw ? formatUnits(priceRaw, 18) : "0")
    : customAmount;
  const priceUsd = clawdPrice && Number(price) > 0
    ? `~$${(Number(price) * clawdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD`
    : null;

  const priceWei = selectedStandard
    ? (priceRaw || BigInt(0))
    : (customAmount ? parseUnits(customAmount, 18) : BigInt(0));

  // Read CLAWD allowance
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: !!address && !!contractAddress },
  });

  const needsApproval = !!address && !isWrongNetwork && priceWei > BigInt(0)
    && (allowanceRaw === undefined || allowanceRaw < priceWei);

  // Approve tx
  const { writeContractAsync: approveAsync, isPending: isApproving } = useWriteContract();

  // Post tx
  const { writeContractAsync: postAsync, isPending: isPosting } = useScaffoldWriteContract("LeftClawServices");

  // Mobile deep link helper
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    let wcWallet = "";
    try {
      const wcKey = Object.keys(localStorage).find(k => k.startsWith("wc@2:client"));
      if (wcKey) wcWallet = (localStorage.getItem(wcKey) || "").toLowerCase();
    } catch {}
    const search = wcWallet;

    const schemes: [string[], string][] = [
      [["rainbow"], "rainbow://"],
      [["metamask"], "metamask://"],
      [["coinbase", "cbwallet"], "cbwallet://"],
      [["trust"], "trust://"],
      [["phantom"], "phantom://"],
    ];
    for (const [keywords, scheme] of schemes) {
      if (keywords.some(k => search.includes(k))) {
        window.location.href = scheme;
        return;
      }
    }
  }, []);

  const writeAndOpen = useCallback(<T,>(writeFn: () => Promise<T>): Promise<T> => {
    const promise = writeFn();
    setTimeout(openWallet, 2000);
    return promise;
  }, [openWallet]);

  const handleSubmit = async () => {
    if (!description.trim() || !contractAddress) return;
    setTxError(null);
    try {
      // Step 1: Approve if needed — then auto-continue to post
      if (needsApproval) {
        setStep("approving");
        await writeAndOpen(() => approveAsync({
          address: CLAWD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contractAddress, priceWei],
        }));
        // Poll until allowance confirms on-chain
        let ok = false;
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const { data } = await refetchAllowance();
          if (data !== undefined && data >= priceWei) { ok = true; break; }
        }
        if (!ok) {
          setTxError("Approval didn't confirm — please try again");
          setStep("form");
          return;
        }
      }

      // Step 2: Post job (auto-fires after approval, or immediately if already approved)
      postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
      setStep("posting");
      if (selectedStandard) {
        await writeAndOpen(() => postAsync({
          functionName: "postJob",
          args: [serviceType, description],
        }));
      } else {
        await writeAndOpen(() => postAsync({
          functionName: "postJobCustom",
          args: [priceWei, description],
        }));
      }
      setStep("done");
    } catch (e) {
      console.error(e);
      setTxError(parseContractError(e));
      setStep("form");
    }
  };

  const isConsultation = serviceType === 0 || serviceType === 1;

  const { data: nextJobId } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "nextJobId",
  });

  // Redirect consultations to chat after posting
  useEffect(() => {
    if (step === "done" && isConsultation && postedJobIdRef.current !== null) {
      router.push(`/chat/${postedJobIdRef.current}`);
    }
  }, [step, isConsultation, router]);

  if (step === "done") {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-4">{isConsultation ? "Consultation Started!" : "Job Posted!"}</h1>
        <p className="opacity-70 mb-8">Your job has been posted on-chain. LeftClaw will review and accept it shortly.</p>
        <Link href={postedJobIdRef.current ? `/jobs/${postedJobIdRef.current}` : "/jobs"} className="btn btn-primary btn-lg">
          View My Job →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl font-bold mb-2">🦞 Post a Job</h1>
      <p className="opacity-70 mb-8">Describe what you need built, audited, or consulted on.</p>

      <div className="w-full max-w-lg">
        {/* Consultation badge */}
        {gistParam && (
          <div className="alert alert-info mb-4">
            <span>📋 Based on your consultation — <a href={gistParam} target="_blank" rel="noopener noreferrer" className="link">view plan</a></span>
          </div>
        )}

        {/* Service Type */}
        <div className="form-control mb-4">
          <label className="label"><span className="label-text font-bold">Service Type</span></label>
          <select
            className="select select-bordered w-full rounded-md"
            value={serviceType}
            onChange={e => setServiceType(parseInt(e.target.value))}
            disabled={!!gistParam}
          >
            {Object.entries(SERVICE_NAMES).filter(([id]) => Number(id) > 1).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
            <option value={9}>Custom Amount</option>
          </select>
        </div>

        {/* Custom Amount */}
        {serviceType === 9 && (
          <div className="form-control mb-4">
            <label className="label"><span className="label-text font-bold">CLAWD Amount</span></label>
            <input
              type="number"
              placeholder="e.g. 1000000"
              className="input input-bordered w-full rounded-md"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
            />
          </div>
        )}

        {/* Price Display */}
        <div className="bg-base-200 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-baseline">
            <span className="opacity-70">Price:</span>
            <div className="text-right">
              <span className="font-mono font-bold">{Number(price).toLocaleString()} CLAWD</span>
              {priceUsd && <p className="text-xs opacity-50">{priceUsd}</p>}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="form-control mb-6">
          <label className="label"><span className="label-text font-bold">Job Description</span></label>
          <textarea
            className="textarea textarea-bordered w-full h-32 rounded-md"
            placeholder="Describe what you need. Be specific about requirements, timeline, and deliverables..."
            value={description}
            onChange={e => { setDescription(e.target.value); setTxError(null); }}
          />
          <label className="label">
            <span className="label-text-alt opacity-50">This will be stored as the description CID on-chain</span>
          </label>
        </div>

        {/* Four-state button flow */}
        {!address ? (
          /* State 1: Not connected */
          <div className="flex justify-center">
            <RainbowKitCustomConnectButton />
          </div>
        ) : isWrongNetwork ? (
          /* State 2: Wrong network */
          <button
            className="btn btn-warning w-full"
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: targetNetwork.id })}
          >
            {isSwitching ? <span className="loading loading-spinner loading-sm" /> : null}
            {isSwitching ? "Switching..." : `Switch to ${targetNetwork.name}`}
          </button>
        ) : (
          /* State 3+4: Single button — approve then auto-post */
          <div className="flex flex-col gap-2">
            <button
              className="btn btn-primary btn-lg w-full"
              onClick={handleSubmit}
              disabled={step === "approving" || step === "posting" || isApproving || isPosting || !description.trim() || (serviceType === 9 && !customAmount)}
            >
              {(step === "approving" || step === "posting" || isApproving || isPosting) && (
                <span className="loading loading-spinner loading-sm mr-2" />
              )}
              {step === "approving" || isApproving
                ? "Approving CLAWD..."
                : step === "posting" || isPosting
                ? "Posting Job..."
                : needsApproval
                ? "Approve & Post Job 🦞"
                : "Post Job 🦞"}
            </button>
            {needsApproval && step === "form" && (
              <p className="text-center text-xs opacity-40">Approve + post in 2 wallet taps</p>
            )}
          </div>
        )}

        {/* Error display */}
        {txError && (
          <div className="mt-4 alert alert-error">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{txError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
