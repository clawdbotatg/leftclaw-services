"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseEther, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient, useWriteContract, useSwitchChain } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { PaymentMethodSelector, formatBalance } from "~~/components/payment";
import { usePaymentContext, PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BASE_CHAIN_ID = 8453;
const CV_SIGN_MESSAGE = "larv.ai CV Spend";
const BUILD_DAILY_TYPE = 2;
const DAY_OPTIONS = [1, 2, 3, 4, 5];
const PRICE_PER_DAY_USD = 1000;
const CV_PER_DAY = 10_000_000;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable" as const, inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view" as const, inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export default function BuildPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg" /></div>}>
      <BuildPage />
    </Suspense>
  );
}

function BuildPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const {
    clawdBalance, usdcBalance, ethBalance, cvBalance,
    clawdPrice, ethPrice,
    clawdAllowance, refetchAllowance,
    bestPaymentMethod,
  } = usePaymentContext();

  const gistParam = searchParams.get("gist");
  const [days, setDays] = useState(1);
  const [description, setDescription] = useState(searchParams.get("description") ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<"idle" | "signing" | "approving" | "paying" | "posting" | "done">("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const postedJobIdRef = useRef<number | string | null>(null);
  const hasSetDefault = useRef(false);

  useEffect(() => {
    if (!hasSetDefault.current && bestPaymentMethod) {
      hasSetDefault.current = true;
      setPaymentMethod(bestPaymentMethod);
    }
  }, [bestPaymentMethod]);

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;
  const contractAddress = CONTRACT_ADDRESS;

  // Prices
  const totalUsd = PRICE_PER_DAY_USD * days;
  const clawdNeeded = clawdPrice && totalUsd ? Math.ceil(totalUsd / clawdPrice) : 0;
  const priceWei = BigInt(Math.ceil(clawdNeeded)) * BigInt(10) ** BigInt(18);
  const usdcAmount = parseUnits(totalUsd.toString(), 6);
  const ethNeeded = ethPrice && totalUsd ? totalUsd / ethPrice : 0;
  const cvCost = CV_PER_DAY * days;
  const isMultiDay = days > 1;

  const { data: nextJobId } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "nextJobId",
  });

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

  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.ethereum) return;
    let wcWallet = "";
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("wc@2:client") || key.startsWith("wagmi")) {
          const val = (localStorage.getItem(key) || "").toLowerCase();
          if (val.includes("metamask") || val.includes("rainbow") || val.includes("coinbase") || val.includes("trust") || val.includes("walletconnect")) {
            wcWallet = val;
            break;
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

  useEffect(() => {
    if (step !== "done" || postedJobIdRef.current === null) return;
    const jobId = postedJobIdRef.current;
    const desc = description.trim() || `${days}-day build`;
    if (desc) {
      try { sessionStorage.setItem(`build-desc-${jobId}`, desc); } catch {}
    }
    fetch("/api/job/sanitize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId), description: desc }),
    }).catch(() => {});
    router.push(`/jobs/${jobId}`);
  }, [step, router, description, days]);

  const handleStart = async () => {
    if (!address || isWrongNetwork || isInsufficient || !contractAddress) return;
    setTxError(null);

    try {
      const jobDesc = description.trim() || `${days}-day build`;

      if (paymentMethod === "cv") {
        if (!walletClient) throw new Error("Wallet not connected");
        setStep("signing");
        const sigKey = `cv-sig-v2-${address.toLowerCase()}`;
        let signature = localStorage.getItem(sigKey);
        if (!signature) {
          signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
          localStorage.setItem(sigKey, signature);
        }
        const spendRes = await fetch("/api/cv-spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, signature, amount: cvCost }),
        });
        const spendData = await spendRes.json();
        if (!spendRes.ok) throw new Error(spendData.error || "CV spend failed");

        // Record job on-chain (gas only — no token transfer)
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("posting");
        let txHash;
        if (isMultiDay) {
          const customPriceUsd = parseUnits(totalUsd.toString(), 6);
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobCustomCV", args: [BigInt(cvCost), customPriceUsd, jobDesc],
          }));
        } else {
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobWithCV", args: [BUILD_DAILY_TYPE, BigInt(cvCost), jobDesc],
          }));
        }
        if (!txHash) { setTxError("Transaction was not submitted — please try again"); setStep("idle"); return; }
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
        let txHash;
        if (isMultiDay) {
          const customPriceUsd = parseUnits(totalUsd.toString(), 6);
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobCustom", args: [priceWei, customPriceUsd, jobDesc],
          }));
        } else {
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJob", args: [BUILD_DAILY_TYPE, priceWei, jobDesc],
          }));
        }
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
        let txHash;
        if (isMultiDay) {
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobCustomUsdc", args: [usdcAmount, jobDesc, BigInt(1)],
          }));
        } else {
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobWithUsdc", args: [BUILD_DAILY_TYPE, jobDesc, BigInt(1)],
          }));
        }
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");

      } else if (paymentMethod === "eth") {
        if (!ethPrice || ethNeeded <= 0) throw new Error("ETH price not loaded");
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("paying");
        const ethWei = parseEther((ethNeeded * 1.05).toFixed(18));
        let txHash;
        if (isMultiDay) {
          const customPriceUsd = parseUnits(totalUsd.toString(), 6);
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobCustomETH", args: [customPriceUsd, jobDesc],
            value: ethWei,
          }));
        } else {
          txHash = await writeAndOpen(() => writeContractAsync({
            address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
            functionName: "postJobWithETH", args: [BUILD_DAILY_TYPE, jobDesc],
            value: ethWei,
          }));
        }
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");
      }
    } catch (e: any) {
      setTxError(parseContractError(e) || e?.message || "Something went wrong");
      setStep("idle");
    }
  };

  const busy = step === "approving" || step === "posting" || step === "signing" || step === "paying";

  const costDisplay = () => {
    const usdHint = totalUsd > 0 ? ` (~$${totalUsd.toLocaleString()})` : "";
    switch (paymentMethod) {
      case "cv": return `${cvCost.toLocaleString()} CV${usdHint}`;
      case "clawd": return clawdNeeded > 0 ? `~${clawdNeeded.toLocaleString()} CLAWD` : "...";
      case "usdc": return `$${totalUsd.toLocaleString()} USDC`;
      case "eth": return ethNeeded > 0 ? `~${ethNeeded.toFixed(4)} ETH` : "...";
    }
  };

  const balanceStr = () => formatBalance({ method: paymentMethod, clawdBalance, usdcBalance, ethBalance, cvBalance });

  const buttonLabel = () => {
    if (step === "signing") return "Sign message in wallet...";
    if (step === "approving") return paymentMethod === "usdc" ? "Approving USDC..." : "Approving CLAWD...";
    if (step === "paying") return "Confirm payment...";
    if (step === "posting") return "Starting build...";
    if (step === "done") return "Redirecting...";
    const labels: Record<PaymentMethod, string> = {
      cv: `⚡ Spend ${cvCost.toLocaleString()} CV & Start Build`,
      clawd: needsApproval ? `Approve & Lock CLAWD` : `🔥 Lock ${costDisplay()} & Start Build`,
      usdc: `💵 Pay ${costDisplay()} & Start Build`,
      eth: `⟠ Pay ${costDisplay()} & Start Build`,
    };
    return labels[paymentMethod];
  };

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🔨</div>
          <h1 className="text-3xl font-bold">Build with LeftClaw</h1>
          <p className="text-base opacity-60 mt-2">$1,000 per day. Live prototype, every day.</p>
        </div>

        {gistParam && (
          <div className="alert alert-info mb-6">
            <span>📋 Based on your consultation — <a href={gistParam} target="_blank" rel="noopener noreferrer" className="link font-semibold">view build plan</a></span>
          </div>
        )}

        {!gistParam && (
          <div className="card bg-base-200 mb-6">
            <div className="card-body py-5">
              <h2 className="font-semibold mb-3">How it works</h2>
              <ul className="space-y-2">
                {[
                  "Lock payment for however many days you want to fund upfront",
                  "LeftClaw starts building — you get a live, working prototype by end of day 1",
                  "Each additional day ships more features on top of the live app",
                  "Source code on GitHub, deployed to IPFS + Vercel with an ENS subdomain",
                ].map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-green-500 mt-0.5">✓</span><span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} disabled={busy} />

        {/* Day selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">How many days?</label>
          <div className="flex gap-2">
            {DAY_OPTIONS.map(d => (
              <button key={d} className={`flex-1 btn ${days === d ? "btn-primary" : "btn-outline"}`} onClick={() => setDays(d)} disabled={busy}>
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs opacity-40 mt-2 text-center">Start with 1 day — you can always add more later</p>
        </div>

        {/* Price & Balance */}
        <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
          <div>
            <p className="text-sm opacity-60">Total to lock</p>
            <p className="text-3xl font-bold">${totalUsd.toLocaleString()}</p>
            <p className="text-sm opacity-50 font-mono mt-0.5">{costDisplay()}</p>
            <p className="text-sm opacity-50">Balance: {balanceStr()}</p>
          </div>
          <div className="text-right text-sm opacity-60">
            <p className="text-lg font-bold">{days} {days === 1 ? "day" : "days"}</p>
            <p>$1,000 / day</p>
          </div>
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">What do you want to build?</label>
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder="e.g. A staking dApp where users deposit CLAWD and earn ETH rewards..."
            value={description} onChange={e => setDescription(e.target.value)} disabled={busy}
          />
        </div>

        {!address && <div className="flex justify-center mb-4"><RainbowKitCustomConnectButton /></div>}
        {isWrongNetwork && <button className="btn btn-error btn-lg w-full mb-4" onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}>⚠️ Switch to Base Network</button>}
        {isInsufficient && (
          <div className="alert alert-error mb-4">
            <span>
              Insufficient balance.{" "}
              {paymentMethod === "clawd" && (
                <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">Get CLAWD →</a>
              )}
            </span>
          </div>
        )}

        <button
          className="btn btn-primary btn-lg w-full text-base"
          onClick={handleStart}
          disabled={!address || isWrongNetwork || isInsufficient || busy || priceWei === BigInt(0) || !description.trim()}
        >
          {busy && <span className="loading loading-spinner loading-sm mr-2" />}
          {buttonLabel()}
        </button>

        {busy && (
          <div className="mt-4 text-center text-sm opacity-60">
            {step === "signing" && "Sign the message to prove wallet ownership"}
            {step === "approving" && `Step 1/2 — Approve ${paymentMethod === "usdc" ? "USDC" : "CLAWD"} in your wallet`}
            {step === "paying" && "Confirm the payment in your wallet"}
            {step === "posting" && "Creating your build job..."}
          </div>
        )}

        {txError && <div className="alert alert-error mt-4"><span>{txError}</span></div>}

        <p className="text-center text-xs opacity-40 mt-6">
          {paymentMethod === "clawd" ? "CLAWD locked in escrow. Burned when build delivered."
            : paymentMethod === "cv" ? "ClawdViction earned by staking CLAWD. No tokens burned."
            : paymentMethod === "usdc" ? "USDC auto-swaps to CLAWD on-chain. Locked until delivery."
            : "ETH payment processed on Base."}
          <br />7-day dispute window after delivery.
        </p>
      </div>
    </div>
  );
}
