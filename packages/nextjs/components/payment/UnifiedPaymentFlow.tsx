"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient, useWriteContract, useSwitchChain } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { PaymentMethodSelector, formatBalance } from "~~/components/payment";
import { usePaymentContext, PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";
import { useCVCost } from "~~/hooks/scaffold-eth/useCVCost";
import { getCachedCVSignature, setCachedCVSignature, clearCachedCVSignature } from "~~/utils/cvSignatureCache";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BASE_CHAIN_ID = 8453;
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
] as const;

type Step = "idle" | "signing" | "approving" | "paying" | "posting" | "done";

interface UnifiedPaymentFlowProps {
  /** Contract service type ID (1-6) */
  serviceTypeId: number;
  /** USD price in human-readable (e.g. 20 for $20) */
  priceUsd: number;
  /** CV divisor from contract */
  cvDivisor: number;
  /** Service name for display */
  serviceName: string;
  /** Description input label */
  descriptionLabel?: string;
  /** Description placeholder */
  descriptionPlaceholder?: string;
  /** Whether description is required */
  descriptionRequired?: boolean;
  /** Called on successful payment — receives jobId. If returns a URL, redirects. */
  onSuccess?: (jobId: number | string) => string | void;
  /** Custom success message instead of redirect */
  successMessage?: string;
  /** Additional content below the description */
  children?: React.ReactNode;
  /** Pre-populate the description textarea (e.g. from a gist URL) */
  initialDescription?: string;
  /** Read-only content locked at the top of the description (e.g. build plan from gist) — always prepended on submit */
  lockedContent?: string;
}

export function UnifiedPaymentFlow({
  serviceTypeId,
  priceUsd,
  cvDivisor,
  serviceName,
  descriptionLabel = "Describe your job",
  descriptionPlaceholder = "What do you need? Be specific...",
  descriptionRequired = true,
  onSuccess,
  successMessage,
  children,
  initialDescription,
  lockedContent,
}: UnifiedPaymentFlowProps) {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const {
    clawdBalance, usdcBalance, ethBalance, cvBalance, cvDisplayBalance,
    clawdPrice, ethPrice,
    clawdAllowance, refetchAllowance,
    bestPaymentMethod,
  } = usePaymentContext();

  const { cvCost } = useCVCost(cvDivisor);

  const [description, setDescription] = useState(initialDescription || "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<Step>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const postedJobIdRef = useRef<number | string | null>(null);
  const hasSetDefault = useRef(false);

  // Auto-select best payment method
  useEffect(() => {
    if (!hasSetDefault.current && bestPaymentMethod) {
      hasSetDefault.current = true;
      setPaymentMethod(bestPaymentMethod);
    }
  }, [bestPaymentMethod]);

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;

  // Price calculations
  const clawdNeeded = clawdPrice && priceUsd ? Math.ceil(priceUsd / clawdPrice) : 0;
  const priceWei = BigInt(Math.ceil(clawdNeeded)) * BigInt(10) ** BigInt(18);
  const usdcAmount = parseUnits(priceUsd.toString(), 6);
  const ethNeeded = ethPrice && priceUsd ? priceUsd / ethPrice : 0;

  const needsApproval = paymentMethod === "clawd" && !!address && priceWei > BigInt(0)
    && (clawdAllowance === undefined || clawdAllowance < priceWei);

  const isInsufficient = (() => {
    if (!address) return false;
    switch (paymentMethod) {
      case "cv": return cvCost !== null && cvBalance !== null && cvBalance < cvCost;
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
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("wc@2:client") || key.startsWith("wagmi")) {
          const val = (localStorage.getItem(key) || "").toLowerCase();
          if (val.includes("metamask") || val.includes("rainbow") || val.includes("coinbase") || val.includes("trust") || val.includes("walletconnect")) {
            wcWallet = val; break;
          }
        }
      }
    } catch {}
    const schemes: [string[], string][] = [
      [["metamask"], "https://metamask.app.link/"],
      [["coinbase", "cbwallet"], "https://go.cb-w.com/"],
      [["rainbow"], "https://rnbwapp.com/"],
      [["trust"], "https://link.trustwallet.com/"],
    ];
    for (const [kws, scheme] of schemes) {
      if (kws.some(k => wcWallet.includes(k))) { window.location.href = scheme; return; }
    }
    if (wcWallet) window.location.href = "https://metamask.app.link/";
  }, []);

  const writeAndOpen = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => { const p = fn(); setTimeout(openWallet, 2000); return p; },
    [openWallet],
  );

  // Read nextJobId for job tracking
  const [nextJobId, setNextJobId] = useState<bigint | null>(null);
  useEffect(() => {
    if (!publicClient) return;
    publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "nextJobId",
    }).then(id => setNextJobId(id as bigint)).catch(() => {});
  }, [publicClient, step]);

  // Handle redirect on success
  useEffect(() => {
    if (step !== "done" || postedJobIdRef.current === null) return;
    const jobId = postedJobIdRef.current;
    if (onSuccess) {
      const result = onSuccess(jobId);
      if (result) router.push(result);
    } else if (successMessage) {
      setSuccessMsg(successMessage);
    } else {
      router.push(`/jobs/${jobId}`);
    }
  }, [step, router, onSuccess, successMessage]);

  const handleSubmit = async () => {
    if (!address || isWrongNetwork || isInsufficient) return;
    if (descriptionRequired && !description.trim()) return;
    setTxError(null);
    setSuccessMsg(null);

    try {
      const userNotes = description.trim();
      const desc = lockedContent
        ? `${lockedContent.trim()}\n\n${userNotes || "(no additional notes)"}`
        : (userNotes || `${serviceName} session`);
      const svcId = BigInt(serviceTypeId);

      if (paymentMethod === "cv") {
        if (!walletClient) throw new Error("Wallet not connected");
        setStep("signing");

        let signature = getCachedCVSignature(address);
        if (!signature) {
          signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
          setCachedCVSignature(address, signature);
        }

        // Fetch fresh CV cost
        const highestRes = await fetch("https://larv.ai/api/cv/highest");
        const highestData = await highestRes.json();
        const fifth = highestData.highestCVBalance / 5;
        const cvAmount = Math.ceil(fifth / cvDivisor);

        // Spend CV
        const spendRes = await fetch("/api/cv-spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, signature, amount: cvAmount }),
        });
        const spendData = await spendRes.json();

        if (!spendRes.ok || !spendData.success) {
          if (spendRes.status === 401) clearCachedCVSignature(address);
          throw new Error(spendData.error || "CV spend failed");
        }

        // Post CV job on-chain for tracking
        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithCV",
          args: [svcId, BigInt(cvAmount), desc],
        }));
        if (txHash && publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });

        postedJobIdRef.current = nextJobId ? Number(nextJobId) : `cv-${Date.now()}`;
        setStep("done");

      } else if (paymentMethod === "clawd") {
        if (needsApproval) {
          setStep("approving");
          await writeAndOpen(() => writeContractAsync({
            address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "approve",
            args: [CONTRACT_ADDRESS, priceWei],
          }));
          let ok = false;
          for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1500));
            refetchAllowance();
            const data = await publicClient?.readContract({
              address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
              args: [address, CONTRACT_ADDRESS],
            });
            if (data !== undefined && (data as bigint) >= priceWei) { ok = true; break; }
          }
          if (!ok) { setTxError("Approval didn't confirm — try again"); setStep("idle"); return; }
        }
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJob", args: [svcId, priceWei, desc],
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
          functionName: "postJobWithETH", args: [svcId, desc, BigInt(1)],
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
          args: [CONTRACT_ADDRESS, usdcAmount],
        }));
        let approveOk = false;
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const bal = await publicClient?.readContract({
            address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
            args: [address, CONTRACT_ADDRESS],
          });
          if (bal !== undefined && (bal as bigint) >= usdcAmount) { approveOk = true; break; }
        }
        if (!approveOk) { setTxError("USDC approval didn't confirm"); setStep("idle"); return; }

        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithUsdc", args: [svcId, desc, BigInt(1)],
        }));
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");
      }
    } catch (e: any) {
      console.error("Payment error:", e);
      const raw = e?.shortMessage || e?.message || String(e);
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
      case "cv": return cvCost !== null ? `${cvCost.toLocaleString()} CV` : "...";
      case "clawd": return clawdNeeded > 0 ? `~${clawdNeeded.toLocaleString()} CLAWD` : "...";
      case "usdc": return `$${priceUsd.toFixed(2)} USDC`;
      case "eth": return ethNeeded > 0 ? `~${ethNeeded.toFixed(6)} ETH` : "...";
    }
  };

  const balanceStr = () => formatBalance({
    method: paymentMethod, clawdBalance, usdcBalance, ethBalance, cvBalance, cvDisplayBalance,
  });

  const buttonLabel = () => {
    if (step === "signing") return "Sign message in wallet...";
    if (step === "approving") return "Approving...";
    if (step === "paying") return "Confirm payment...";
    if (step === "posting") return "Posting job...";
    if (step === "done") return "Done!";
    if (paymentMethod === "cv") return `⚡ Spend ${cvCost !== null ? cvCost.toLocaleString() : "..."} CV & Submit`;
    if (paymentMethod === "clawd") return needsApproval
      ? `Approve & Lock CLAWD`
      : `🔥 Lock ${costDisplay()} & Submit`;
    if (paymentMethod === "usdc") return `💵 Pay ${costDisplay()} & Submit`;
    if (paymentMethod === "eth") return `⟠ Pay ${costDisplay()} & Submit`;
    return "Submit";
  };

  const canSubmit = !!address && !isWrongNetwork && !isInsufficient && !busy
    && step !== "done" && (!descriptionRequired || description.trim().length > 0)
    && (paymentMethod !== "clawd" || priceWei > BigInt(0))
    && (paymentMethod !== "eth" || !!ethPrice)
    && (paymentMethod !== "cv" || cvCost !== null);

  return (
    <div className="w-full">
      {/* Payment method */}
      <PaymentMethodSelector
        value={paymentMethod}
        onChange={setPaymentMethod}
        disabled={busy}
        disabledMethods={cvCost === null ? ["cv"] : []}
      />

      {/* Price & Balance */}
      <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
        <div>
          <p className="text-sm opacity-60">Total cost</p>
          <p className="text-2xl font-mono font-bold">{costDisplay()}</p>
          {paymentMethod !== "usdc" && priceUsd > 0 && (
            <p className="text-sm opacity-60">~${priceUsd.toLocaleString()} USD</p>
          )}
          <p className="text-sm opacity-50">Balance: {balanceStr()}</p>
        </div>
        <div className="text-right text-sm opacity-60">
          <p>${priceUsd.toLocaleString()}</p>
          {paymentMethod === "cv" && <p className="text-xs">⚡ ClawdViction</p>}
          {paymentMethod === "clawd" && <p className="text-xs">🔥 Escrowed in contract</p>}
          {paymentMethod === "usdc" && <p className="text-xs">💵 Swapped to CLAWD</p>}
          {paymentMethod === "eth" && <p className="text-xs">⟠ Swapped to CLAWD</p>}
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          {descriptionLabel}{" "}
          {!descriptionRequired && <span className="opacity-50">(optional)</span>}
        </label>

        {lockedContent ? (
          <>
            {/* Locked build plan — always submitted */}
            <pre className="bg-base-200 border border-base-300 rounded-lg px-4 py-3 text-xs overflow-x-auto whitespace-pre-wrap text-base-content font-mono max-h-64 overflow-y-auto mb-3">
              {lockedContent}
            </pre>
            {/* User notes — editable */}
            <label className="block text-sm font-medium mb-2 opacity-70">Additional Notes</label>
            <textarea
              className="textarea textarea-bordered w-full text-sm"
              placeholder="Add any clarifications, changes, or new requirements here..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={busy || step === "done"}
              rows={5}
            />
          </>
        ) : (
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder={descriptionPlaceholder}
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={busy || step === "done"}
          />
        )}
      </div>

      {children}

      {/* Success message */}
      {successMsg && (
        <div className="alert alert-success mb-4">
          <span>{successMsg}</span>
        </div>
      )}

      {/* Connect / Network / Insufficient / Submit button */}
      {!address && (
        <div className="flex justify-center mb-4">
          <RainbowKitCustomConnectButton />
        </div>
      )}
      {isWrongNetwork && (
        <button
          className="btn btn-error btn-lg w-full mb-4"
          onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}
        >
          ⚠️ Switch to Base Network
        </button>
      )}
      {isInsufficient && (
        <div className="alert alert-error mb-4">
          <span>
            Insufficient balance for selected payment method.{" "}
            {paymentMethod === "clawd" && (
              <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">Get CLAWD →</a>
            )}
            {paymentMethod === "cv" && (
              <a href="https://larv.ai/stake" target="_blank" rel="noopener" className="underline">Stake CLAWD →</a>
            )}
          </span>
        </div>
      )}

      <button
        className="btn btn-primary btn-lg w-full text-base"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {busy && <span className="loading loading-spinner loading-sm mr-2" />}
        {buttonLabel()}
      </button>

      {busy && (
        <div className="mt-4 text-center text-sm opacity-60">
          {step === "signing" && "Sign the message to prove wallet ownership"}
          {step === "approving" && `Step 1/2 — Approve ${paymentMethod === "usdc" ? "USDC" : "CLAWD"} in your wallet`}
          {step === "paying" && "Confirm the payment in your wallet"}
          {step === "posting" && "Creating your job on-chain..."}
        </div>
      )}

      {txError && <div className="alert alert-error mt-4"><span>{txError}</span></div>}

      <p className="text-center text-xs opacity-40 mt-6">
        {paymentMethod === "clawd"
          ? "CLAWD escrowed in contract. Sent to treasury on accept, returned to you on decline."
          : paymentMethod === "cv"
          ? "ClawdViction earned by staking CLAWD. Job tracked on-chain."
          : paymentMethod === "usdc"
          ? "USDC swapped to CLAWD via Uniswap and escrowed in contract."
          : "ETH swapped to CLAWD via Uniswap and escrowed in contract."}
      </p>
    </div>
  );
}
