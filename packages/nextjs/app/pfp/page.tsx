"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { parseEther, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { PaymentMethodSelector } from "~~/components/payment";
import { usePaymentContext, PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";
import { useCVCost } from "~~/hooks/scaffold-eth/useCVCost";
import { getCachedCVSignature, setCachedCVSignature, clearCachedCVSignature } from "~~/utils/cvSignatureCache";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TREASURY_ADDRESS = "0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0" as const;
const BASE_CHAIN_ID = 8453;
const PFP_SERVICE_TYPE_ID = 3;
const CV_SIGN_MESSAGE = "larv.ai CV Spend";

const ERC20_ABI = [
  {
    name: "transfer", type: "function", stateMutability: "nonpayable" as const,
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "approve", type: "function", stateMutability: "nonpayable" as const,
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance", type: "function", stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const PFP_PROMPT_STORAGE_KEY = "pfp_last_prompt";
const PFP_PROMPT_TTL_MS = 10 * 60 * 1000;

const savePfpPrompt = (prompt: string) => {
  try {
    localStorage.setItem(PFP_PROMPT_STORAGE_KEY, JSON.stringify({ prompt, ts: Date.now() }));
  } catch {}
};

const loadPfpPrompt = (): string => {
  try {
    const raw = localStorage.getItem(PFP_PROMPT_STORAGE_KEY);
    if (!raw) return "";
    const { prompt, ts } = JSON.parse(raw);
    if (Date.now() - ts > PFP_PROMPT_TTL_MS) return "";
    return prompt || "";
  } catch {
    return "";
  }
};

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

export default function PfpPage() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const {
    clawdBalance, usdcBalance, cvBalance, cvDisplayBalance,
    clawdPrice, ethPrice,
  } = usePaymentContext();

  // --- Fetch service type from contract ---
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [cvDivisor, setCvDivisor] = useState<number | null>(null);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [serviceNotFound, setServiceNotFound] = useState(false);

  useEffect(() => {
    if (!publicClient) return;
    (async () => {
      try {
        const svc = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "getServiceType",
          args: [BigInt(PFP_SERVICE_TYPE_ID)],
        }) as { id: bigint; name: string; slug: string; priceUsd: bigint; cvDivisor: bigint; status: string };

        if (svc.status !== "active") {
          setServiceNotFound(true);
        } else {
          setPriceUsd(Number(svc.priceUsd) / 1e6);
          setCvDivisor(Number(svc.cvDivisor));
        }
      } catch (e) {
        console.error("Failed to load PFP service type", e);
        setServiceNotFound(true);
      } finally {
        setServiceLoading(false);
      }
    })();
  }, [publicClient]);

  const { cvCost } = useCVCost(cvDivisor ?? 0);

  const savedPromptRef = useRef<string>("");
  const [prompt, setPrompt] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = loadPfpPrompt();
    savedPromptRef.current = saved;
    return saved;
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<"idle" | "signing" | "approving" | "paying" | "generating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<{ txHash?: string; method: string; amount?: string } | null>(null);
  

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;
  const clawdNeeded = clawdPrice && priceUsd ? Math.ceil(priceUsd / clawdPrice) : 0;
  const priceWei = BigInt(clawdNeeded) * BigInt(10) ** BigInt(18);
  const usdcAmount = priceUsd !== null ? parseUnits(priceUsd.toFixed(2), 6) : BigInt(0);
  const ethNeeded = ethPrice && priceUsd ? (priceUsd / ethPrice) * 1.05 : 0;

  const insufficientClawd = !!address && clawdBalance !== undefined && clawdBalance < priceWei;
  const insufficientCv = cvBalance !== null && cvCost !== null && cvBalance < cvCost;
  const insufficientUsdc = !!address && usdcBalance !== undefined && usdcAmount > BigInt(0) && usdcBalance < usdcAmount;

  // Read nextJobId for job tracking (for USDC/ETH contract calls)
  const readNextJobId = async (): Promise<bigint | null> => {
    if (!publicClient) return null;
    try {
      return (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "nextJobId",
      })) as bigint;
    } catch {
      return null;
    }
  };

  const handleGenerate = async () => {
    if (!address || !prompt.trim() || priceUsd === null) return;
    savedPromptRef.current = prompt.trim();
    savePfpPrompt(prompt.trim());
    setError(null); setGeneratedImage(null); setPaymentInfo(null);

    try {
      if (paymentMethod === "cv") {
        // CV payment — sign, spend, generate (same as before, works correctly)
        if (!walletClient || cvDivisor === null) throw new Error("Wallet not connected");
        setStep("signing");

        let signature = getCachedCVSignature(address);
        if (!signature) {
          signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
          setCachedCVSignature(address, signature);
        }

        setStep("generating");
        const res = await fetch("/api/pfp/generate-cv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim(), wallet: address, signature }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) clearCachedCVSignature(address);
          if (res.status === 402) throw new Error(`Not enough ClawdViction. You have ${(data.currentBalance || 0).toLocaleString()} CV, need ${(cvCost ?? 0).toLocaleString()}.`);
          throw new Error(data.error || "Generation failed");
        }
        setPaymentInfo({ method: "cv", amount: `${data.cvSpent?.toLocaleString() || ""} CV` });
        setGeneratedImage(data.image);
        setStep("done");

      } else if (paymentMethod === "clawd") {
        // CLAWD payment — direct transfer to treasury (PFP is instant, no escrow needed)
        if (!publicClient || priceWei === BigInt(0)) throw new Error("Price not loaded");
        setStep("paying");
        const txHash = await writeContractAsync({
          address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "transfer",
          args: [TREASURY_ADDRESS, priceWei],
        });
        if (!txHash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash: txHash, retryCount: 20, retryDelay: 3_000 });
        setPaymentInfo({ txHash, method: "clawd", amount: `${clawdNeeded.toLocaleString()} CLAWD` });

        setStep("generating");
        const res = await fetch("/api/pfp/generate-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim(), txHash, address, paymentMethod: "clawd" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation failed");
        setGeneratedImage(data.image);
        setStep("done");

      } else if (paymentMethod === "usdc") {
        // USDC payment — approve + postJobWithUsdc on contract (swaps USDC → CLAWD)
        if (!publicClient || !walletClient || usdcAmount === BigInt(0)) throw new Error("Price not loaded");

        // Read nextJobId before posting
        const jobId = await readNextJobId();

        // Step 1: Approve USDC to contract
        setStep("approving");
        const approveTxHash = await writeContractAsync({
          address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [CONTRACT_ADDRESS, usdcAmount],
        });
        if (!approveTxHash) throw new Error("Approval transaction failed");
        // Wait for approval to confirm before contract tries to pull USDC
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash, retryCount: 20, retryDelay: 3_000 });

        // Step 2: Post job via contract (swaps USDC → CLAWD via Uniswap)
        setStep("paying");
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithUsdc",
          args: [BigInt(PFP_SERVICE_TYPE_ID), `PFP: ${prompt.trim()}`, BigInt(1)],
        });
        if (!txHash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash: txHash, retryCount: 20, retryDelay: 3_000 });
        setPaymentInfo({ txHash, method: "usdc", amount: `$${priceUsd.toFixed(2)} USDC` });

        // Step 3: Generate PFP
        setStep("generating");
        const res = await fetch("/api/pfp/generate-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(), txHash, address, paymentMethod: "usdc",
            jobId: jobId !== null ? Number(jobId) : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation failed");
        setGeneratedImage(data.image);
        setStep("done");

      } else if (paymentMethod === "eth") {
        // ETH payment — postJobWithETH on contract (wraps ETH and swaps to CLAWD)
        if (!publicClient || !walletClient || !ethPrice) throw new Error("ETH price not loaded");

        // Read nextJobId before posting
        const jobId = await readNextJobId();

        setStep("paying");
        const ethWei = parseEther(ethNeeded.toFixed(18));
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithETH",
          args: [BigInt(PFP_SERVICE_TYPE_ID), `PFP: ${prompt.trim()}`, BigInt(1)],
          value: ethWei,
        });
        if (!txHash) throw new Error("Transaction failed");
        await publicClient.waitForTransactionReceipt({ hash: txHash, retryCount: 20, retryDelay: 3_000 });
        setPaymentInfo({ txHash, method: "eth", amount: `${(ethNeeded).toFixed(5)} ETH` });

        // Generate PFP
        setStep("generating");
        const res = await fetch("/api/pfp/generate-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(), txHash, address, paymentMethod: "eth",
            jobId: jobId !== null ? Number(jobId) : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation failed");
        setGeneratedImage(data.image);
        setStep("done");
      }
    } catch (e: any) {
      const raw = e?.shortMessage || e?.message || "Something went wrong";
      if (paymentMethod === "cv") {
        setError(raw.slice(0, 500));
      } else {
        const parsed = parseContractError(e);
        setError(parsed !== "Transaction failed — please try again" ? parsed : raw.slice(0, 300));
      }
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
    setStep("idle"); setError(null); setGeneratedImage(null); setPaymentInfo(null);
    setPrompt(savedPromptRef.current || loadPfpPrompt());
  };

  const randomPrompt = () => {
    setPrompt(EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]);
  };

  const busy = step === "paying" || step === "generating" || step === "signing" || step === "approving";
  const isInsufficient = paymentMethod === "clawd" ? insufficientClawd
    : paymentMethod === "cv" ? insufficientCv
    : paymentMethod === "usdc" ? insufficientUsdc
    : false;

  // --- Loading state while fetching service type ---
  if (serviceLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  // --- Service not found ---
  if (serviceNotFound || priceUsd === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="opacity-60">PFP Generator service not found or inactive</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🎨</div>
          <h1 className="text-3xl font-bold">CLAWD PFP Generator</h1>
          <p className="text-base opacity-60 mt-2">Custom profile pictures of the CLAWD mascot</p>
        </div>

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

        {step === "done" && generatedImage && (
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={handleDownload}>💾 Download PFP</button>
              <button className="btn btn-outline flex-1" onClick={handleReset}>🎨 Make Another</button>
            </div>
            {paymentInfo && (
              <div className="text-center text-sm opacity-50">
                {paymentInfo.method === "cv" ? (
                  <>Spent {paymentInfo.amount} ⚡</>
                ) : paymentInfo.method === "usdc" ? (
                  <>
                    Paid {paymentInfo.amount} 💵 → swapped to CLAWD{" "}
                    {paymentInfo.txHash && (
                      <a href={`https://basescan.org/tx/${paymentInfo.txHash}`} target="_blank" rel="noopener" className="underline">View tx →</a>
                    )}
                  </>
                ) : paymentInfo.method === "eth" ? (
                  <>
                    Paid {paymentInfo.amount} ⟠ → swapped to CLAWD{" "}
                    {paymentInfo.txHash && (
                      <a href={`https://basescan.org/tx/${paymentInfo.txHash}`} target="_blank" rel="noopener" className="underline">View tx →</a>
                    )}
                  </>
                ) : (
                  <>
                    Paid with {paymentInfo.amount} 🔥 → treasury{" "}
                    {paymentInfo.txHash && (
                      <a href={`https://basescan.org/tx/${paymentInfo.txHash}`} target="_blank" rel="noopener" className="underline">View tx →</a>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {step !== "done" && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Describe your CLAWD{" "}
                <button className="text-primary text-xs ml-2 opacity-70 hover:opacity-100" onClick={randomPrompt}>🎲 random</button>
              </label>
              <textarea
                className="textarea textarea-bordered w-full h-20 text-sm"
                placeholder='e.g. "wearing a cowboy hat and boots" or "as a pirate captain"'
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                disabled={busy}
                maxLength={500}
              />
            </div>

            <PaymentMethodSelector
              value={paymentMethod}
              onChange={m => setPaymentMethod(m)}
              disabled={busy}
              disabledMethods={cvCost === null ? ["cv"] : []}
            />

            <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
              {paymentMethod === "clawd" ? (
                <>
                  <div>
                    <p className="text-sm opacity-60">Cost</p>
                    <p className="text-2xl font-mono font-bold">${priceUsd.toFixed(2)}</p>
                    {clawdNeeded > 0 && <p className="text-sm opacity-50">~{clawdNeeded.toLocaleString()} CLAWD</p>}
                    {address && clawdBalance !== undefined && (
                      <p className="text-sm opacity-50">You have {Number(clawdBalance / BigInt(10) ** BigInt(18)).toLocaleString()} CLAWD</p>
                    )}
                  </div>
                  <div className="text-right text-sm opacity-60"><p>🔥 CLAWD</p><p>Sent to treasury</p></div>
                </>
              ) : paymentMethod === "cv" ? (
                <>
                  <div>
                    <p className="text-sm opacity-60">Cost</p>
                    <p className="text-2xl font-mono font-bold">{cvCost !== null ? cvCost.toLocaleString() : "..."} CV</p>
                    <p className="text-sm opacity-50">{cvBalance !== null ? `You have ${(cvDisplayBalance ?? cvBalance).toLocaleString()} CV` : "Connect wallet to check"}</p>
                    <p className="text-sm opacity-50">~${priceUsd.toFixed(2)} USD</p>
                  </div>
                  <div className="text-right text-sm opacity-60"><p>⚡ ClawdViction</p><p>Earned by staking</p></div>
                </>
              ) : paymentMethod === "usdc" ? (
                <>
                  <div>
                    <p className="text-sm opacity-60">Cost</p>
                    <p className="text-2xl font-mono font-bold">${priceUsd.toFixed(2)} USDC</p>
                    {address && usdcBalance !== undefined && (
                      <p className="text-sm opacity-50">You have {(Number(usdcBalance) / 1e6).toFixed(2)} USDC</p>
                    )}
                  </div>
                  <div className="text-right text-sm opacity-60"><p>💵 Stablecoin</p><p>Swapped to CLAWD</p></div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm opacity-60">Cost</p>
                    <p className="text-2xl font-mono font-bold">{ethPrice ? (priceUsd / ethPrice * 1.05).toFixed(5) : "..."} ETH</p>
                    <p className="text-sm opacity-50">~${priceUsd.toFixed(2)} USD (+5% slippage)</p>
                  </div>
                  <div className="text-right text-sm opacity-60"><p>⟠ Native ETH</p><p>Swapped to CLAWD</p></div>
                </>
              )}
            </div>

            {!address && <div className="alert alert-warning mb-4"><span>Connect your wallet to start</span></div>}
            {isWrongNetwork && <div className="alert alert-error mb-4"><span>Switch to Base network</span></div>}
            {paymentMethod === "clawd" && insufficientClawd && (
              <div className="alert alert-error mb-4">
                <span>Not enough CLAWD. <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">Get CLAWD →</a></span>
              </div>
            )}
            {paymentMethod === "cv" && insufficientCv && (
              <div className="alert alert-error mb-4">
                <span>Not enough ClawdViction. You have {(cvBalance || 0).toLocaleString()} CV, need {(cvCost ?? 0).toLocaleString()}. <a href="https://larv.ai/stake" target="_blank" rel="noopener" className="underline">Stake CLAWD →</a></span>
              </div>
            )}
            {paymentMethod === "usdc" && insufficientUsdc && (
              <div className="alert alert-error mb-4">
                <span>Not enough USDC. You have {usdcBalance !== undefined ? (Number(usdcBalance) / 1e6).toFixed(2) : "0"} USDC, need ${priceUsd.toFixed(2)}.</span>
              </div>
            )}
            {paymentMethod === "eth" && !ethPrice && (
              <div className="alert alert-warning mb-4"><span>Loading ETH price...</span></div>
            )}

            <button
              className="btn btn-primary btn-lg w-full text-base"
              onClick={handleGenerate}
              disabled={!address || isWrongNetwork || isInsufficient || busy || !prompt.trim() || (paymentMethod === "clawd" && priceWei === BigInt(0)) || (paymentMethod === "eth" && !ethPrice) || (paymentMethod === "cv" && cvCost === null)}
            >
              {busy && <span className="loading loading-spinner loading-sm mr-2" />}
              {step === "signing" ? "Sign message in wallet..." :
               step === "approving" ? "Approving USDC..." :
               step === "paying" ? "Confirm payment in wallet..." :
               step === "generating" ? "Generating PFP..." :
               paymentMethod === "cv" ? `⚡ Spend ${cvCost !== null ? cvCost.toLocaleString() : "..."} CV & Generate` :
               paymentMethod === "clawd" ? `🔥 Pay ${clawdNeeded > 0 ? clawdNeeded.toLocaleString() + " CLAWD" : "..."} & Generate` :
               paymentMethod === "usdc" ? `💵 Pay $${priceUsd.toFixed(2)} USDC & Generate` :
               `⟠ Pay ${ethPrice ? (priceUsd / ethPrice * 1.05).toFixed(5) : "..."} ETH & Generate`}
            </button>

            {busy && (
              <div className="mt-4 text-center text-sm opacity-60">
                {step === "signing" && "Sign the message to prove wallet ownership"}
                {step === "approving" && "Step 1/2 — Approve USDC in your wallet"}
                {step === "paying" && "Confirm the payment in your wallet"}
                {step === "generating" && "AI is creating your PFP (~30s)"}
              </div>
            )}

            {error && (
              <div className="alert alert-error mt-4">
                <div className="flex flex-col gap-1">
                  <span>{error}</span>
                  {step === "error" && paymentInfo && (
                    <span className="text-xs opacity-70">
                      Payment was sent but generation failed. Contact @leftclaw for help.
                      {paymentInfo.txHash && <><br />TX: {paymentInfo.txHash.slice(0, 10)}...</>}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-[100px] flex justify-center">
              <a href="/pfp/skill.md" className="btn btn-outline btn-sm opacity-60 hover:opacity-100">
                Agent / bot? Read the skill file →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
