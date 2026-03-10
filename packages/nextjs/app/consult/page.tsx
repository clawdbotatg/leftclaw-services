"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { PaymentMethodSelector, formatBalance } from "~~/components/payment";
import { usePaymentContext, PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PAY_TO = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442" as const;
const BASE_CHAIN_ID = 8453;
// Must match larv.ai's CV_SPEND_MESSAGE exactly
const CV_SIGN_MESSAGE = "larv.ai CV Spend";

const ERC20_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable" as const,
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance", type: "function", stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "transfer", type: "function", stateMutability: "nonpayable" as const,
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const CV_PRICES: Record<number, number> = { 0: 200_000, 1: 300_000 };
const SERVICE_KEYS: Record<number, string> = { 0: "CONSULT_QUICK", 1: "CONSULT_DEEP" };

const CONSULT_INFO = {
  0: {
    name: "Quick Consult",
    emoji: "💬",
    tagline: "Get clear answers and a concrete plan — fast.",
    bullets: [
      "A focused chat session with LeftClaw about your idea",
      "Architecture advice, stack recommendations, feasibility checks",
      "Ends with a written build plan you can act on immediately",
      "Plan auto-populates a job post if you want LeftClaw to build it",
    ],
  },
  1: {
    name: "Deep Consult",
    emoji: "🧠",
    tagline: "Deep-dive into complex architecture, protocol design, or strategy.",
    bullets: [
      "A longer, open-ended session to work through a complex idea",
      "Multi-contract systems, tokenomics, security tradeoffs, protocol design",
      "Ends with a detailed written build plan",
      "Plan auto-populates a job post if you want LeftClaw to build it",
    ],
  },
};

export default function ConsultPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg"></span></div>}>
      <ConsultPage />
    </Suspense>
  );
}

function ConsultPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const typeParam = Number(searchParams.get("type") ?? "0");
  const serviceType = typeParam === 1 ? 1 : 0;
  const info = CONSULT_INFO[serviceType as 0 | 1];

  // Payment context — single hook for all balances, prices, allowances
  const {
    clawdBalance, usdcBalance, ethBalance, cvBalance,
    clawdPrice, ethPrice,
    clawdAllowance, refetchAllowance,
    bestPaymentMethod,
  } = usePaymentContext();

  const [topic, setTopic] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<"idle" | "signing" | "approving" | "paying" | "posting" | "done">("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const postedJobIdRef = useRef<number | null>(null);
  const hasSetDefault = useRef(false);

  // Set default payment method from hook once
  useEffect(() => {
    if (!hasSetDefault.current && bestPaymentMethod) {
      hasSetDefault.current = true;
      setPaymentMethod(bestPaymentMethod);
    }
  }, [bestPaymentMethod]);

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;
  const contractAddress = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}` | undefined;

  const { data: priceRaw } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "servicePriceUsd",
    args: [serviceType],
  });

  const { data: nextJobId } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "nextJobId",
  });

  const priceUsdRaw = priceRaw ?? BigInt(0);
  const priceUsdNum = Number(formatUnits(priceUsdRaw, 6));
  const priceDisplay = priceUsdNum ? `$${priceUsdNum.toLocaleString()}` : "...";
  const clawdNeeded = clawdPrice && priceUsdNum ? Math.ceil(priceUsdNum / clawdPrice) : 0;
  const priceWei = BigInt(Math.ceil(clawdNeeded)) * BigInt(10) ** BigInt(18);
  const usdcAmount = parseUnits(priceUsdNum.toString(), 6);
  const ethNeeded = ethPrice && priceUsdNum ? priceUsdNum / ethPrice : 0;
  const cvCost = CV_PRICES[serviceType] || 20_000_000;

  const needsApproval = paymentMethod === "clawd" && !!address && priceWei > BigInt(0) && (clawdAllowance === undefined || clawdAllowance < priceWei);

  const isInsufficient = (() => {
    if (!address) return false;
    switch (paymentMethod) {
      case "cv": return cvBalance !== null && cvBalance < cvCost;
      case "clawd": return clawdBalance !== undefined && clawdBalance < priceWei;
      case "usdc": return usdcBalance !== undefined && usdcBalance < usdcAmount;
      case "eth": return false;
      default: return false;
    }
  })();

  // Mobile wallet deep-link
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.ethereum) return;
    let wcWallet = "";
    try {
      const wcKey = Object.keys(localStorage).find(k => k.startsWith("wc@2:client"));
      if (wcKey) wcWallet = (localStorage.getItem(wcKey) || "").toLowerCase();
    } catch {}
    const schemes: [string[], string][] = [
      [["rainbow"], "rainbow://"], [["metamask"], "metamask://"],
      [["coinbase", "cbwallet"], "cbwallet://"], [["trust"], "trust://"],
    ];
    for (const [kws, scheme] of schemes) {
      if (kws.some(k => wcWallet.includes(k))) { window.location.href = scheme; return; }
    }
  }, []);

  const writeAndOpen = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => { const p = fn(); setTimeout(openWallet, 2000); return p; },
    [openWallet],
  );

  // Redirect after done
  useEffect(() => {
    if (step !== "done" || postedJobIdRef.current === null) return;
    const jobId = postedJobIdRef.current;
    const desc = topic.trim() || "Consultation session";
    if (desc) {
      try { localStorage.setItem(`consult-topic-${jobId}`, desc); } catch {}
    }
    // Trigger sanitization immediately (fire-and-forget)
    fetch("/api/job/sanitize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId), description: desc }),
    }).catch(() => {});
    router.push(`/chat/${jobId}`);
  }, [step, router, topic]);

  const handleStart = async () => {
    if (!address || isWrongNetwork || isInsufficient || !contractAddress) return;
    setTxError(null);

    try {
      const description = topic.trim() || `${info.name} session`;

      if (paymentMethod === "cv") {
        if (!walletClient) throw new Error("Wallet not connected");
        setStep("signing");
        // Key includes message hash so cached sigs auto-invalidate if message changes
        const sigKey = `cv-sig-v2-${address.toLowerCase()}`;
        // Clear any old-format cached sigs
        localStorage.removeItem(`cv-sig-${address.toLowerCase()}`);
        let signature = localStorage.getItem(sigKey);
        let usedCached = !!signature;
        if (!signature) {
          signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
          localStorage.setItem(sigKey, signature);
          usedCached = false;
        }
        console.log("[cv-pay] sending cv-spend request", {
          wallet: address,
          sigLength: signature?.length,
          sigPrefix: signature?.slice(0, 20),
          usedCached,
          amount: cvCost,
        });
        const spendRes = await fetch("/api/cv-spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, signature, amount: cvCost }),
        });
        const spendData = await spendRes.json();
        if (!spendRes.ok) {
          // Always clear cached sig on any failure — stale sigs cause loops
          localStorage.removeItem(sigKey);
          const parts = [spendData.error || "CV spend failed"];
          if (spendData.detail) parts.push(spendData.detail);
          if (spendData.source) parts.push(`(source: ${spendData.source})`);
          if (usedCached) parts.push("Cached signature cleared — please try again.");
          throw new Error(parts.join(" — "));
        }

        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithCV", args: [serviceType, BigInt(cvCost), description],
        }));
        if (!txHash) { setTxError("On-chain transaction returned no hash"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");

      } else if (paymentMethod === "clawd") {
        if (needsApproval) {
          setStep("approving");
          await writeAndOpen(() => writeContractAsync({
            address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "approve",
            args: [contractAddress, priceWei],
          }));
          let ok = false;
          for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1500));
            refetchAllowance();
            // Re-read directly since refetch is async
            const data = await publicClient?.readContract({
              address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
              args: [address, contractAddress],
            });
            if (data !== undefined && (data as bigint) >= priceWei) { ok = true; break; }
          }
          if (!ok) { setTxError("Approval didn't confirm — try again"); setStep("idle"); return; }
        }
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJob", args: [serviceType, priceWei, description],
        }));
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");

      } else if (paymentMethod === "eth") {
        if (!ethPrice || ethNeeded <= 0) throw new Error("ETH price not loaded");
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("paying");
        const ethWei = parseEther((ethNeeded * 1.05).toFixed(18));
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithETH", args: [serviceType, description],
          value: ethWei,
        }));
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");

      } else if (paymentMethod === "usdc") {
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("approving");
        await writeAndOpen(() => writeContractAsync({
          address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [contractAddress, usdcAmount],
        }));
        let approveOk = false;
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const bal = await publicClient?.readContract({
            address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
            args: [address, contractAddress],
          });
          if (bal !== undefined && (bal as bigint) >= usdcAmount) { approveOk = true; break; }
        }
        if (!approveOk) { setTxError("USDC approval didn't confirm"); setStep("idle"); return; }

        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithUsdc", args: [serviceType, description, BigInt(1)],
        }));
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");
      }
    } catch (e: any) {
      console.error("Payment error:", e);
      const raw = e?.shortMessage || e?.message || String(e);
      // For CV payment errors, show the raw message directly (it already has good detail)
      // For contract errors, try parsing the revert reason
      if (paymentMethod === "cv") {
        setTxError(raw.slice(0, 500));
      } else {
        const parsed = parseContractError(e);
        setTxError(parsed !== "Transaction failed — please try again" ? parsed : `Error: ${raw.slice(0, 300)}`);
      }
      setStep("idle");
    }
  };

  const busy = step === "approving" || step === "posting" || step === "signing" || step === "paying";

  const costDisplay = () => {
    switch (paymentMethod) {
      case "cv": return `${cvCost.toLocaleString()} CV`;
      case "clawd": return clawdNeeded > 0 ? `~${clawdNeeded.toLocaleString()} CLAWD` : "...";
      case "usdc": return `$${priceUsdNum.toFixed(2)} USDC`;
      case "eth": return ethNeeded > 0 ? `~${ethNeeded.toFixed(6)} ETH` : "...";
    }
  };

  const balanceStr = () => formatBalance({ method: paymentMethod, clawdBalance, usdcBalance, ethBalance, cvBalance });

  const buttonLabel = () => {
    if (step === "signing") return "Sign message in wallet...";
    if (step === "approving") return "Approving...";
    if (step === "paying") return "Confirm payment...";
    if (step === "posting") return "Starting session...";
    if (step === "done") return "Redirecting to chat...";
    const labels: Record<PaymentMethod, string> = {
      cv: `⚡ Spend ${cvCost.toLocaleString()} CV & Start Chat`,
      clawd: needsApproval ? `Approve & Lock ${priceDisplay} CLAWD` : `🔥 Lock ${costDisplay()} & Start Chat`,
      usdc: `💵 Pay ${costDisplay()} & Start Chat`,
      eth: `⟠ Pay ${costDisplay()} & Start Chat`,
    };
    return labels[paymentMethod];
  };

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">{info.emoji}</div>
          <h1 className="text-3xl font-bold">{info.name}</h1>
          <p className="text-base opacity-60 mt-2">{info.tagline}</p>
        </div>

        <div className="card bg-base-200 mb-6">
          <div className="card-body py-5">
            <h2 className="font-semibold mb-3">What&apos;s included</h2>
            <ul className="space-y-2">
              {info.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">✓</span><span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Payment method */}
        <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} disabled={busy} />

        {/* Price & Balance */}
        <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
          <div>
            <p className="text-sm opacity-60">Total cost</p>
            <p className="text-2xl font-mono font-bold">{costDisplay()}</p>
            <p className="text-sm opacity-50">Balance: {balanceStr()}</p>
          </div>
          <div className="text-right text-sm opacity-60">
            <p>{serviceType === 0 ? "Quick session" : "Deep session"}</p>
            <p className="text-xs">{priceDisplay}</p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">What do you want to build? <span className="opacity-50">(optional)</span></label>
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder="e.g. A staking dApp where users earn ETH rewards on CLAWD deposits..."
            value={topic} onChange={e => setTopic(e.target.value)} disabled={busy}
          />
        </div>

        {!address && <div className="alert alert-warning mb-4"><span>Connect your wallet to start</span></div>}
        {isWrongNetwork && <div className="alert alert-error mb-4"><span>Switch to Base network</span></div>}
        {isInsufficient && <div className="alert alert-error mb-4"><span>Insufficient balance for selected payment method</span></div>}

        <button
          className="btn btn-primary btn-lg w-full text-base"
          onClick={handleStart}
          disabled={!address || isWrongNetwork || isInsufficient || busy || priceWei === BigInt(0)}
        >
          {busy && <span className="loading loading-spinner loading-sm mr-2" />}
          {buttonLabel()}
        </button>

        {busy && (
          <div className="mt-4 text-center text-sm opacity-60">
            {step === "signing" && "Sign the message to prove wallet ownership"}
            {step === "approving" && `Step 1/2 — Approve ${paymentMethod === "usdc" ? "USDC" : "CLAWD"} in your wallet`}
            {step === "paying" && "Confirm the payment in your wallet"}
            {step === "posting" && "Creating your session..."}
          </div>
        )}

        {txError && <div className="alert alert-error mt-4"><span>{txError}</span></div>}

        <p className="text-center text-xs opacity-40 mt-6">
          {paymentMethod === "clawd" ? "Tokens locked on-chain. CLAWD burned when plan delivered."
            : paymentMethod === "cv" ? "ClawdViction earned by staking CLAWD. No tokens burned."
            : "Payment processed on Base."}
        </p>
      </div>
    </div>
  );
}
