"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useWalletClient, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PAY_TO = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442" as const;
const BASE_CHAIN_ID = 8453;
const CV_SIGN_MESSAGE = "ClawdViction CV Spend";

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

type PaymentMethod = "cv" | "contract" | "usdc" | "eth";

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

  const [topic, setTopic] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cv");
  const [step, setStep] = useState<"idle" | "signing" | "approving" | "paying" | "posting" | "done">("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [cvBalance, setCvBalance] = useState<number | null>(null);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const postedJobIdRef = useRef<number | null>(null);

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

  const clawdPrice = useCLAWDPrice();
  const priceUsdRaw = priceRaw ?? BigInt(0);
  const priceUsdNum = Number(formatUnits(priceUsdRaw, 6));
  const priceDisplay = priceUsdNum ? `$${priceUsdNum.toLocaleString()}` : "...";
  const clawdNeeded = clawdPrice && priceUsdNum ? Math.ceil(priceUsdNum / clawdPrice) : 0;
  const priceWei = BigInt(Math.ceil(clawdNeeded)) * BigInt(10) ** BigInt(18);
  const usdcAmount = parseUnits(priceUsdNum.toString(), 6);
  const ethNeeded = ethPrice && priceUsdNum ? priceUsdNum / ethPrice : 0;
  const cvCost = CV_PRICES[serviceType] || 20_000_000;

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: !!address && !!contractAddress },
  });

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

  const { data: ethBalanceData } = useBalance({ address, chainId: BASE_CHAIN_ID });
  const ethBalance = ethBalanceData?.value;

  const needsApproval = paymentMethod === "contract" && !!address && priceWei > BigInt(0) && (allowanceRaw === undefined || allowanceRaw < priceWei);

  // Auto-select payment method with highest USD-equivalent balance
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current || !address || !ethPrice || !clawdPrice) return;
    // Wait until at least one balance is loaded
    if (clawdBalance === undefined && usdcBalance === undefined && ethBalance === undefined && cvBalance === null) return;
    hasAutoSelected.current = true;

    const balancesUsd: { method: PaymentMethod; usd: number }[] = [
      { method: "cv", usd: cvBalance !== null ? (cvBalance / cvCost) * priceUsdNum : 0 }, // ratio of affordability
      { method: "contract", usd: clawdBalance !== undefined ? Number(clawdBalance / BigInt(10) ** BigInt(18)) * clawdPrice : 0 },
      { method: "usdc", usd: usdcBalance !== undefined ? Number(usdcBalance) / 1e6 : 0 },
      { method: "eth", usd: ethBalance !== undefined ? Number(ethBalance) / 1e18 * ethPrice : 0 },
    ];

    const best = balancesUsd.sort((a, b) => b.usd - a.usd)[0];
    if (best && best.usd > 0) setPaymentMethod(best.method);
  }, [address, ethPrice, clawdPrice, clawdBalance, usdcBalance, ethBalance, cvBalance, cvCost, priceUsdNum]);

  // Fetch CV balance
  useEffect(() => {
    if (!address) { setCvBalance(null); return; }
    
    fetch(`/api/cv-balance/${address}`)
      .then(r => r.json())
      .then(data => setCvBalance(Number(data.clawdviction) || 0))
      .catch(() => setCvBalance(null))
      ;
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
      case "cv": return cvBalance !== null && cvBalance < cvCost;
      case "contract": return clawdBalance !== undefined && clawdBalance < priceWei;
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

  // Redirect after done — all payments create on-chain jobs
  useEffect(() => {
    if (step !== "done" || postedJobIdRef.current === null) return;
    const jobId = postedJobIdRef.current;
    if (topic.trim()) {
      try { sessionStorage.setItem(`consult-topic-${jobId}`, topic.trim()); } catch {}
    }
    router.push(`/chat/${jobId}`);
  }, [step, router, topic]);

  const handleStart = async () => {
    if (!address || isWrongNetwork || isInsufficient || !contractAddress) return;
    setTxError(null);

    try {
      const description = topic.trim() || `${info.name} session`;

      if (paymentMethod === "cv") {
        // 1. Sign CV message + spend CV off-chain, then post job on-chain
        if (!walletClient) throw new Error("Wallet not connected");
        setStep("signing");

        // Get or cache CV signature
        const sigKey = `cv-sig-${address.toLowerCase()}`;
        let signature = localStorage.getItem(sigKey);
        if (!signature) {
          signature = await walletClient.signMessage({ message: CV_SIGN_MESSAGE });
          localStorage.setItem(sigKey, signature);
        }

        // Spend CV off-chain
        const spendRes = await fetch("/api/cv-spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, signature, amount: cvCost }),
        });
        const spendData = await spendRes.json();
        if (!spendRes.ok) throw new Error(spendData.error || "CV spend failed");

        // Post job on-chain (gas only)
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("posting");
        const txHash = await writeAndOpen(() => writeContractAsync({
          address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any,
          functionName: "postJobWithCV", args: [serviceType, BigInt(cvCost), description],
        }));
        if (!txHash) { setTxError("Transaction failed"); setStep("idle"); return; }
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash });
        setStep("done");

      } else if (paymentMethod === "contract") {
        // CLAWD payment — approve + postJob
        if (needsApproval) {
          setStep("approving");
          await writeAndOpen(() => writeContractAsync({
            address: CLAWD_ADDRESS, abi: ERC20_ABI, functionName: "approve",
            args: [contractAddress, priceWei],
          }));
          let ok = false;
          for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const { data } = await refetchAllowance();
            if (data !== undefined && data >= priceWei) { ok = true; break; }
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
        // ETH payment — postJobWithETH
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
        // USDC payment — postJobWithUsdc (auto-swaps to CLAWD on-chain)
        postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
        setStep("approving");
        // Approve USDC to contract
        await writeAndOpen(() => writeContractAsync({
          address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [contractAddress, usdcAmount],
        }));
        // Wait for approval
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
      setTxError(parseContractError(e) || e?.message || "Something went wrong");
      setStep("idle");
    }
  };

  const busy = step === "approving" || step === "posting" || step === "signing" || step === "paying";

  const costDisplay = () => {
    switch (paymentMethod) {
      case "cv": return `${cvCost.toLocaleString()} CV`;
      case "contract": return clawdNeeded > 0 ? `~${clawdNeeded.toLocaleString()} CLAWD` : "...";
      case "usdc": return `$${priceUsdNum.toFixed(2)} USDC`;
      case "eth": return ethNeeded > 0 ? `~${ethNeeded.toFixed(6)} ETH` : "...";
    }
  };

  const balanceDisplay = () => {
    switch (paymentMethod) {
      case "cv": return cvBalance !== null ? `${cvBalance.toLocaleString()} CV` : "—";
      case "contract": return clawdBalance !== undefined ? `${Number(clawdBalance / BigInt(10) ** BigInt(18)).toLocaleString()} CLAWD` : "—";
      case "usdc": return usdcBalance !== undefined ? `$${(Number(usdcBalance) / 1e6).toFixed(2)} USDC` : "—";
      case "eth": return "Check wallet";
    }
  };

  const buttonLabel = () => {
    if (step === "signing") return "Sign message in wallet...";
    if (step === "approving") return "Approving CLAWD...";
    if (step === "paying") return "Confirm payment...";
    if (step === "posting") return "Starting session...";
    if (step === "done") return "Redirecting to chat...";
    const labels: Record<PaymentMethod, string> = {
      cv: `⚡ Spend ${cvCost.toLocaleString()} CV & Start Chat`,
      contract: needsApproval ? `Approve & Lock ${priceDisplay} CLAWD` : `🔥 Lock ${costDisplay()} & Start Chat`,
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
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Pay with</label>
          <div className="grid grid-cols-4 gap-1">
            <button className={`btn btn-xs text-xs ${paymentMethod === "cv" ? "btn-primary" : "btn-outline"}`} onClick={() => setPaymentMethod("cv")} disabled={busy}>⚡ CV</button>
            <button className={`btn btn-xs text-xs ${paymentMethod === "contract" ? "btn-primary" : "btn-outline"}`} onClick={() => setPaymentMethod("contract")} disabled={busy}>🔥 CLAWD</button>
            <button className={`btn btn-xs text-xs ${paymentMethod === "usdc" ? "btn-primary" : "btn-outline"}`} onClick={() => setPaymentMethod("usdc")} disabled={busy}>💵 USDC</button>
            <button className={`btn btn-xs text-xs ${paymentMethod === "eth" ? "btn-primary" : "btn-outline"}`} onClick={() => setPaymentMethod("eth")} disabled={busy}>⟠ ETH</button>
          </div>
        </div>

        {/* Price & Balance */}
        <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
          <div>
            <p className="text-sm opacity-60">Total cost</p>
            <p className="text-2xl font-mono font-bold">{costDisplay()}</p>
            <p className="text-sm opacity-50">Balance: {balanceDisplay()}</p>
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
            {step === "approving" && "Step 1/2 — Approve CLAWD in your wallet"}
            {step === "paying" && "Confirm the payment in your wallet"}
            {step === "posting" && "Creating your session..."}
          </div>
        )}

        {txError && <div className="alert alert-error mt-4"><span>{txError}</span></div>}

        <p className="text-center text-xs opacity-40 mt-6">
          {paymentMethod === "contract" ? "Tokens locked on-chain. CLAWD burned when plan delivered."
            : paymentMethod === "cv" ? "ClawdViction earned by staking CLAWD. No tokens burned."
            : "Payment processed on Base."}
        </p>
      </div>
    </div>
  );
}
