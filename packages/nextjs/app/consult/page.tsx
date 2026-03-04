"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import deployedContracts from "~~/contracts/deployedContracts";
import { parseContractError } from "~~/utils/parseContractError";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const BASE_CHAIN_ID = 8453;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const CONSULT_INFO = {
  0: {
    name: "Quick Consult",
    emoji: "💬",
    messages: 15,
    tagline: "Get clear answers and a concrete plan — fast.",
    bullets: [
      "15 back-and-forth messages with LeftClaw",
      "Architecture advice, stack recommendations, feasibility checks",
      "Ends with a written build plan",
      "Plan auto-populates a job post if you want to hire for the build",
    ],
  },
  1: {
    name: "Deep Consult",
    emoji: "🧠",
    messages: 30,
    tagline: "Deep-dive into complex architecture, protocol design, or strategy.",
    bullets: [
      "30 back-and-forth messages with LeftClaw",
      "Multi-contract systems, tokenomics, security tradeoffs",
      "Detailed written build plan included",
      "Plan auto-populates a job post if you want to hire for the build",
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

  const typeParam = Number(searchParams.get("type") ?? "0");
  const serviceType = typeParam === 1 ? 1 : 0;
  const info = CONSULT_INFO[serviceType as 0 | 1];

  const [topic, setTopic] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "posting" | "done">("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const postedJobIdRef = useRef<number | null>(null);

  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;
  const contractAddress = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}` | undefined;

  const { data: priceRaw } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "servicePriceInClawd",
    args: [serviceType],
  });

  const { data: nextJobId } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "nextJobId",
  });

  const clawdPrice = useCLAWDPrice();
  const priceWei = priceRaw ?? BigInt(0);
  const priceNum = Number(formatUnits(priceWei, 18));
  const priceDisplay = priceNum ? priceNum.toLocaleString() : "...";
  const priceUsd = clawdPrice && priceNum ? (priceNum * clawdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: !!address && !!contractAddress },
  });

  const { data: balanceRaw } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const needsApproval = !!address && priceWei > BigInt(0) && (allowanceRaw === undefined || allowanceRaw < priceWei);
  const insufficientBalance = !!address && balanceRaw !== undefined && balanceRaw < priceWei;

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

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
      [["coinbase", "cbwallet"], "cbwallet://"], [["trust"], "trust://"], [["phantom"], "phantom://"],
    ];
    for (const [kws, scheme] of schemes) {
      if (kws.some(k => wcWallet.includes(k))) { window.location.href = scheme; return; }
    }
  }, []);

  const writeAndOpen = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = fn();
    setTimeout(openWallet, 2000);
    return p;
  }, [openWallet]);

  // After done → redirect to chat (Vercel for IPFS builds, relative for Vercel)
  useEffect(() => {
    if (step === "done" && postedJobIdRef.current !== null) {
      const chatBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
      if (chatBaseUrl) {
        window.location.href = `${chatBaseUrl}/chat/${postedJobIdRef.current}`;
      } else {
        router.push(`/chat/${postedJobIdRef.current}`);
      }
    }
  }, [step, router]);

  const handleStart = async () => {
    if (!address || !contractAddress || isWrongNetwork || insufficientBalance) return;
    setTxError(null);

    try {
      // Step 1: Approve if needed
      if (needsApproval) {
        setStep("approving");
        await writeAndOpen(() => writeContractAsync({
          address: CLAWD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contractAddress, priceWei],
        }));
        // Poll for allowance
        let ok = false;
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const { data } = await refetchAllowance();
          if (data !== undefined && data >= priceWei) { ok = true; break; }
        }
        if (!ok) {
          setTxError("Approval didn't confirm — try again");
          setStep("idle");
          return;
        }
      }

      // Step 2: Post job
      postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
      setStep("posting");
      const description = topic.trim() || `${info.name} session`;
      const txHash = await writeAndOpen(() => writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "postJob",
        args: [serviceType, description],
      }));
      if (!txHash) {
        setTxError("Transaction failed — wallet not connected?");
        setStep("idle");
        return;
      }
      // Wait for on-chain confirmation before redirecting
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      setStep("done");
    } catch (e: any) {
      setTxError(parseContractError(e));
      setStep("idle");
    }
  };

  const busy = step === "approving" || step === "posting";

  const stepLabel = () => {
    if (step === "approving") return "Approving CLAWD...";
    if (step === "posting") return "Locking tokens on-chain...";
    if (step === "done") return "Redirecting to chat...";
    if (needsApproval) return `Approve ${priceDisplay} CLAWD & Start`;
    return `Lock ${priceDisplay} CLAWD & Start Chat →`;
  };

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">{info.emoji}</div>
          <h1 className="text-3xl font-bold">{info.name}</h1>
          <p className="text-base opacity-60 mt-2">{info.tagline}</p>
        </div>

        {/* What you get */}
        <div className="card bg-base-200 mb-6">
          <div className="card-body py-5">
            <h2 className="font-semibold mb-3">What&apos;s included</h2>
            <ul className="space-y-2">
              {info.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Price */}
        <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
          <div>
            <p className="text-sm opacity-60">Total cost</p>
            <p className="text-2xl font-mono font-bold">{priceDisplay} CLAWD</p>
            {priceUsd && <p className="text-sm opacity-50">~${priceUsd} USD</p>}
          </div>
          <div className="text-right text-sm opacity-60">
            <p>{info.messages} messages</p>
            <p>on Base</p>
          </div>
        </div>

        {/* Optional topic */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            What do you want to build? <span className="opacity-50">(optional)</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder="e.g. A staking dApp where users earn ETH rewards on CLAWD deposits..."
            value={topic}
            onChange={e => setTopic(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs opacity-40 mt-1">You can also just describe your idea in the chat.</p>
        </div>

        {/* Not connected */}
        {!address && (
          <div className="alert alert-warning mb-4">
            <span>Connect your wallet to start</span>
          </div>
        )}

        {/* Wrong network */}
        {isWrongNetwork && (
          <div className="alert alert-error mb-4">
            <span>Switch to Base network</span>
          </div>
        )}

        {/* Insufficient balance */}
        {insufficientBalance && (
          <div className="alert alert-error mb-4">
            <span>
              Insufficient CLAWD — you need {priceDisplay} CLAWD.{" "}
              <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">
                Get CLAWD →
              </a>
            </span>
          </div>
        )}

        {/* Start button */}
        <button
          className="btn btn-primary btn-lg w-full text-base"
          onClick={handleStart}
          disabled={!address || isWrongNetwork || insufficientBalance || busy || priceWei === BigInt(0)}
        >
          {busy && <span className="loading loading-spinner loading-sm mr-2" />}
          {stepLabel()}
        </button>

        {/* Progress indicator */}
        {busy && (
          <div className="mt-4 text-center text-sm opacity-60">
            {step === "approving" && "Step 1/2 — Approve CLAWD in your wallet"}
            {step === "posting" && "Step 2/2 — Confirm the job transaction"}
          </div>
        )}

        {/* Error */}
        {txError && (
          <div className="alert alert-error mt-4">
            <span>{txError}</span>
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-xs opacity-40 mt-6">
          Tokens are locked on-chain until the consultation ends.
          <br />
          CLAWD is burned when the plan is delivered. No refunds after chat begins.
        </p>

      </div>
    </div>
  );
}
