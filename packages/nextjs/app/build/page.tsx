"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
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

const DAY_OPTIONS = [1, 2, 3, 4, 5];

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

  const gistParam = searchParams.get("gist");
  const [days, setDays] = useState(1);
  const [description, setDescription] = useState(searchParams.get("description") ?? "");
  const [step, setStep] = useState<"idle" | "approving" | "posting" | "done">("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const postedJobIdRef = useRef<number | null>(null);

  const clawdPrice = useCLAWDPrice();
  const isWrongNetwork = !!address && chainId !== BASE_CHAIN_ID;

  // Calculate price: $1000/day in CLAWD
  const pricePerDayUsd = 1000;
  const totalUsd = pricePerDayUsd * days;
  const clawdPerDay = clawdPrice ? pricePerDayUsd / clawdPrice : 0;
  const totalClawd = clawdPerDay * days;
  const priceWei = clawdPrice && totalClawd > 0
    ? parseUnits(Math.round(totalClawd).toString(), 18)
    : BigInt(0);

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && CONTRACT_ADDRESS ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address && !!CONTRACT_ADDRESS },
  });

  const { data: balanceRaw } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: nextJobId } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "nextJobId",
  });

  const needsApproval = !!address && priceWei > BigInt(0) && (allowanceRaw === undefined || allowanceRaw < priceWei);
  const insufficientBalance = !!address && balanceRaw !== undefined && balanceRaw < priceWei;

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

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

  const handleStart = async () => {
    if (!address || !CONTRACT_ADDRESS || isWrongNetwork || insufficientBalance || priceWei === BigInt(0)) return;
    setTxError(null);

    try {
      // Step 1: Approve if needed
      if (needsApproval) {
        setStep("approving");
        await writeAndOpen(() => writeContractAsync({
          address: CLAWD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, priceWei],
        }));
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

      // Step 2: Post custom job
      postedJobIdRef.current = nextJobId ? Number(nextJobId) : null;
      setStep("posting");

      const jobDescription = description.trim() || `${days}-day build`;
      const txHash = await writeAndOpen(() => writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "postJobCustom",
        args: [priceWei, jobDescription],
      }));

      if (!txHash) {
        setTxError("Transaction failed — wallet not connected?");
        setStep("idle");
        return;
      }

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }
      setStep("done");
    } catch (e: any) {
      setTxError(parseContractError(e));
      setStep("idle");
    }
  };

  // Redirect to job after post
  if (step === "done" && postedJobIdRef.current !== null) {
    router.push(`/jobs/${postedJobIdRef.current}`);
  }

  const busy = step === "approving" || step === "posting";

  const buttonLabel = () => {
    if (step === "approving") return "Approving CLAWD...";
    if (step === "posting") return "Locking tokens on-chain...";
    if (step === "done") return "Starting build...";
    if (needsApproval) return `Approve & Lock ${totalUsd.toLocaleString()} CLAWD →`;
    return `Lock $${totalUsd.toLocaleString()} of CLAWD & Start →`;
  };

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🔨</div>
          <h1 className="text-3xl font-bold">Build with LeftClaw</h1>
          <p className="text-base opacity-60 mt-2">$1,000 of CLAWD per day. Live prototype, every day.</p>
        </div>

        {/* Consultation plan banner */}
        {gistParam && (
          <div className="alert alert-info mb-6">
            <span>📋 Based on your consultation — <a href={gistParam} target="_blank" rel="noopener noreferrer" className="link font-semibold">view build plan</a></span>
          </div>
        )}

        {/* How it works */}
        {!gistParam && <div className="card bg-base-200 mb-6">
          <div className="card-body py-5">
            <h2 className="font-semibold mb-3">How it works</h2>
            <ul className="space-y-2">
              {[
                "Lock CLAWD for however many days you want to fund upfront",
                "LeftClaw starts building — you get a live, working prototype by end of day 1",
                "Each additional day ships more features on top of the live app",
                "Source code on GitHub, deployed to IPFS + Vercel with an ENS subdomain",
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>}

        {/* Day selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">How many days?</label>
          <div className="flex gap-2">
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                className={`flex-1 btn ${days === d ? "btn-primary" : "btn-outline"}`}
                onClick={() => setDays(d)}
                disabled={busy}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs opacity-40 mt-2 text-center">
            Start with 1 day — you can always add more later
          </p>
        </div>

        {/* Price display */}
        <div className="flex items-center justify-between bg-base-300 rounded-xl px-5 py-4 mb-6">
          <div>
            <p className="text-sm opacity-60">Total to lock</p>
            <p className="text-3xl font-bold">${totalUsd.toLocaleString()}</p>
            <p className="text-sm opacity-50 font-mono mt-0.5">
              {clawdPrice && totalClawd > 0
                ? `${Math.round(totalClawd).toLocaleString()} CLAWD`
                : "..."}
            </p>
          </div>
          <div className="text-right text-sm opacity-60">
            <p className="text-lg font-bold">{days} {days === 1 ? "day" : "days"}</p>
            <p>$1,000 / day</p>
          </div>
        </div>

        {/* What you're building */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            What do you want to build?
          </label>
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder="e.g. A staking dApp where users deposit CLAWD and earn ETH rewards..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={busy}
          />
        </div>

        {/* Alerts */}
        {!address && (
          <div className="alert alert-warning mb-4"><span>Connect your wallet to start</span></div>
        )}
        {isWrongNetwork && (
          <div className="alert alert-error mb-4"><span>Switch to Base network</span></div>
        )}
        {insufficientBalance && (
          <div className="alert alert-error mb-4">
            <span>
              Not enough CLAWD.{" "}
              <a href="https://app.uniswap.org/swap?outputCurrency=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07&chain=base" target="_blank" rel="noopener" className="underline">
                Get CLAWD →
              </a>
            </span>
          </div>
        )}

        {/* CTA */}
        <button
          className="btn btn-primary btn-lg w-full text-base"
          onClick={handleStart}
          disabled={!address || isWrongNetwork || insufficientBalance || busy || priceWei === BigInt(0) || !description.trim()}
        >
          {busy && <span className="loading loading-spinner loading-sm mr-2" />}
          {buttonLabel()}
        </button>

        {busy && (
          <div className="mt-4 text-center text-sm opacity-60">
            {step === "approving" && "Step 1/2 — Approve CLAWD in your wallet"}
            {step === "posting" && "Step 2/2 — Confirm the job transaction"}
          </div>
        )}

        {txError && (
          <div className="alert alert-error mt-4"><span>{txError}</span></div>
        )}

        <p className="text-center text-xs opacity-40 mt-6">
          CLAWD is locked in escrow until the build is delivered and accepted.
          <br />
          7-day dispute window after delivery.
        </p>

      </div>
    </div>
  );
}
