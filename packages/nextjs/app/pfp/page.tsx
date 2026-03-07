"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { parseEther, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient, useWriteContract, useSendTransaction } from "wagmi";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
const PAY_TO = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442" as const;
const BASE_CHAIN_ID = 8453;
const PFP_PRICE_USD = 0.5;
const PFP_CV_COST = 50_000;
const CV_SIGN_MESSAGE = "ClawdViction CV Spend";

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const EXAMPLE_PROMPTS = [
  "wearing a cowboy hat and boots",
  "as a pirate captain with an eyepatch",
  "in a space suit floating in zero gravity",
  "as a medieval knight with a sword",
  "wearing a chef hat, cooking in a kitchen",
  "as a DJ with headphones and turntables",
  "in a Hawaiian shirt on the beach",
  "as a ninja with throwing stars",
  "wearing a lab coat with safety goggles",
  "as a wizard casting a spell",
];

type PaymentMethod = "cv" | "clawd" | "usdc" | "eth";

const PAYMENT_LABELS: Record<PaymentMethod, { icon: string; label: string; desc: string }> = {
  cv: { icon: "⚡", label: "ClawdViction", desc: "Earned by staking" },
  clawd: { icon: "🔥", label: "Burn CLAWD", desc: "Deflationary" },
  usdc: { icon: "💵", label: "USDC", desc: "Stablecoin" },
  eth: { icon: "⟠", label: "ETH", desc: "Native token" },
};

export default function PfpPage() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const clawdPrice = useCLAWDPrice();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const [prompt, setPrompt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<"idle" | "signing" | "paying" | "generating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<Record<string, any> | null>(null);
  const [cvBalance, setCvBalance] = useState<number | null>(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;
  const clawdNeeded = clawdPrice ? Math.ceil(PFP_PRICE_USD / clawdPrice) : 0;
  const priceWei = BigInt(clawdNeeded) * BigInt(10) ** BigInt(18);
  const usdcAmount = parseUnits(PFP_PRICE_USD.toString(), 6); // 6 decimals
  const ethNeeded = ethPrice ? PFP_PRICE_USD / ethPrice : 0;

  const { data: clawdBalance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Fetch CV balance
  useEffect(() => {
    if (!address) { setCvBalance(null); return; }
    setCvLoading(true);
    fetch(`/api/cv-balance/${address}`)
      .then(r => r.json())
      .then(data => setCvBalance(Number(data.clawdviction) || 0))
      .catch(() => setCvBalance(null))
      .finally(() => setCvLoading(false));
  }, [address]);

  // Fetch ETH price
  useEffect(() => {
    fetch("https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006")
      .then(r => r.json())
      .then(data => setEthPrice(parseFloat(data.pairs?.[0]?.priceUsd || "0")))
      .catch(() => {});
  }, []);

  const isInsufficient = (() => {
    if (!address) return false;
    switch (paymentMethod) {
      case "cv": return cvBalance !== null && cvBalance < PFP_CV_COST;
      case "clawd": return clawdBalance !== undefined && clawdBalance < priceWei;
      case "usdc": return usdcBalance !== undefined && usdcBalance < usdcAmount;
      case "eth": return false; // checked at tx time
      default: return false;
    }
  })();

  const handleGenerate = async () => {
    if (!address || !publicClient || !prompt.trim()) return;
    setError(null);
    setGeneratedImage(null);
    setPaymentInfo(null);

    try {
      let txHash: string | undefined;
      let signature: string | undefined;

      if (paymentMethod === "cv") {
        if (!walletClient) throw new Error("Wallet not connected");
        setStep("signing");
        signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
      } else if (paymentMethod === "clawd") {
        if (priceWei === BigInt(0)) throw new Error("Price not loaded");
        setStep("paying");
        const hash = await writeContractAsync({
          address: CLAWD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [DEAD_ADDRESS, priceWei],
        });
        if (!hash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash });
        txHash = hash;
      } else if (paymentMethod === "usdc") {
        setStep("paying");
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [PAY_TO, usdcAmount],
        });
        if (!hash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash });
        txHash = hash;
      } else if (paymentMethod === "eth") {
        if (!ethPrice || ethNeeded <= 0) throw new Error("ETH price not loaded");
        setStep("paying");
        const ethWei = parseEther((ethNeeded * 1.05).toFixed(18)); // 5% buffer
        const hash = await sendTransactionAsync({
          to: PAY_TO,
          value: ethWei,
        });
        if (!hash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash });
        txHash = hash;
      }

      // Call the unified generate endpoint
      setStep("generating");
      const res = await fetch("/api/pfp/generate-cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          method: paymentMethod,
          wallet: address,
          signature,
          txHash,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      setGeneratedImage(data.image);
      setPaymentInfo(data.payment);
      setStep("done");

      // Refresh CV balance
      if (paymentMethod === "cv") {
        setCvBalance(data.payment?.newBalance ?? (cvBalance ? cvBalance - PFP_CV_COST : null));
      }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Something went wrong");
      setStep("error");
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement("a");
    link.href = generatedImage;
    link.download = `clawd-pfp-${Date.now()}.png`;
    link.click();
  };

  const handleReset = () => {
    setStep("idle");
    setError(null);
    setGeneratedImage(null);
    setPaymentInfo(null);
    setPrompt("");
  };

  const randomPrompt = () => setPrompt(EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]);
  const busy = step === "signing" || step === "paying" || step === "generating";

  const priceDisplay = () => {
    switch (paymentMethod) {
      case "cv": return `${PFP_CV_COST.toLocaleString()} CV`;
      case "clawd": return clawdNeeded > 0 ? `${clawdNeeded.toLocaleString()} CLAWD` : "...";
      case "usdc": return `$${PFP_PRICE_USD.toFixed(2)} USDC`;
      case "eth": return ethNeeded > 0 ? `~${ethNeeded.toFixed(6)} ETH` : "...";
    }
  };

  const balanceDisplay = () => {
    switch (paymentMethod) {
      case "cv": return cvLoading ? "Loading..." : cvBalance !== null ? `${cvBalance.toLocaleString()} CV` : "—";
      case "clawd": return clawdBalance !== undefined ? `${Number(clawdBalance / BigInt(10) ** BigInt(18)).toLocaleString()} CLAWD` : "—";
      case "usdc": return usdcBalance !== undefined ? `$${(Number(usdcBalance) / 1e6).toFixed(2)} USDC` : "—";
      case "eth": return "Check wallet";
    }
  };

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🎨</div>
          <h1 className="text-3xl font-bold">CLAWD PFP Generator</h1>
          <p className="text-base opacity-60 mt-2">Custom profile pictures of the CLAWD mascot</p>
        </div>

        {/* Preview */}
        <div className="flex justify-center mb-6">
          <div className="relative w-64 h-64 rounded-2xl overflow-hidden border-2 border-base-300 bg-base-200">
            {generatedImage ? (
              <Image src={generatedImage} alt="Generated CLAWD PFP" fill className="object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Image src="/clawd-base.jpg" alt="CLAWD base" width={180} height={180} className="rounded-xl opacity-40" />
                <p className="text-xs opacity-40 mt-2">Your custom PFP will appear here</p>
              </div>
            )}
            {step === "generating" && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                <span className="loading loading-spinner loading-lg text-primary"></span>
                <p className="text-white text-sm mt-3">Generating your PFP...</p>
              </div>
            )}
          </div>
        </div>

        {/* Done */}
        {step === "done" && generatedImage && (
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={handleDownload}>💾 Download PFP</button>
              <button className="btn btn-outline flex-1" onClick={handleReset}>🎨 Make Another</button>
            </div>
            {paymentInfo && (
              <div className="text-center text-sm opacity-50">
                {paymentInfo.cvSpent && `Spent ${paymentInfo.cvSpent.toLocaleString()} CV ⚡`}
                {paymentInfo.burnAmount && `Burned CLAWD 🔥`}
                {paymentInfo.usdcAmount && `Paid USDC 💵`}
                {paymentInfo.ethAmount && `Paid ETH ⟠`}
                {paymentInfo.txHash && (
                  <>{" "}<a href={`https://basescan.org/tx/${paymentInfo.txHash}`} target="_blank" rel="noopener" className="underline">View tx →</a></>
                )}
              </div>
            )}
          </div>
        )}

        {/* Form */}
        {step !== "done" && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Describe your CLAWD{" "}
                <button className="text-primary text-xs ml-2 opacity-70 hover:opacity-100" onClick={randomPrompt}>🎲 random</button>
              </label>
              <textarea
                className="textarea textarea-bordered w-full h-20 text-sm"
                placeholder='e.g. "wearing a cowboy hat and boots"'
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                disabled={busy}
                maxLength={500}
              />
            </div>

            {/* Payment method */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Pay with</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(["cv", "clawd", "usdc", "eth"] as PaymentMethod[]).map(m => (
                  <button
                    key={m}
                    className={`btn btn-sm ${paymentMethod === m ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setPaymentMethod(m)}
                    disabled={busy}
                  >
                    {PAYMENT_LABELS[m].icon} {PAYMENT_LABELS[m].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Price + balance */}
            <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
              <div>
                <p className="text-sm opacity-60">Cost</p>
                <p className="text-2xl font-mono font-bold">{priceDisplay()}</p>
                <p className="text-sm opacity-50">Balance: {balanceDisplay()}</p>
              </div>
              <div className="text-right text-sm opacity-60">
                <p>{PAYMENT_LABELS[paymentMethod].icon} {PAYMENT_LABELS[paymentMethod].desc}</p>
                <p className="text-xs">${PFP_PRICE_USD.toFixed(2)}</p>
              </div>
            </div>

            {/* Warnings */}
            {!address && <div className="alert alert-warning mb-4"><span>Connect your wallet to start</span></div>}
            {isWrongNetwork && <div className="alert alert-error mb-4"><span>Switch to Base network</span></div>}
            {isInsufficient && (
              <div className="alert alert-error mb-4">
                <span>
                  Insufficient {PAYMENT_LABELS[paymentMethod].label} balance.{" "}
                  {paymentMethod === "cv" && <a href="https://clawdviction.vercel.app/stake" target="_blank" rel="noopener" className="underline">Stake CLAWD →</a>}
                  {paymentMethod === "clawd" && <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">Get CLAWD →</a>}
                </span>
              </div>
            )}

            <button
              className="btn btn-primary btn-lg w-full text-base"
              onClick={handleGenerate}
              disabled={!address || isWrongNetwork || isInsufficient || busy || !prompt.trim()}
            >
              {busy && <span className="loading loading-spinner loading-sm mr-2" />}
              {step === "signing" ? "Sign message in wallet..."
                : step === "paying" ? "Confirm payment in wallet..."
                : step === "generating" ? "Generating PFP..."
                : `${PAYMENT_LABELS[paymentMethod].icon} Pay ${priceDisplay()} & Generate`}
            </button>

            {busy && (
              <div className="mt-4 text-center text-sm opacity-60">
                {step === "signing" && "Sign the message to prove wallet ownership"}
                {step === "paying" && "Confirm the transaction in your wallet"}
                {step === "generating" && "AI is creating your PFP (~30s)"}
              </div>
            )}

            {error && (
              <div className="alert alert-error mt-4">
                <div className="flex flex-col gap-1">
                  <span>{error}</span>
                </div>
              </div>
            )}

            <p className="text-center text-xs opacity-40 mt-6">
              Images generated by AI (gpt-image-1.5) based on the CLAWD mascot.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
