"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";

const SERVICE_NAMES: Record<number, string> = {
  0: "Quick Consult (15 messages)",
  1: "Deep Consult (30 messages)",
  2: "Simple Build (~$500)",
  3: "Standard Build (~$1000)",
  4: "Complex Build (~$1500)",
  5: "Enterprise Build (~$2500)",
  6: "QA Report (~$200)",
  7: "Contract Audit (~$300)",
  8: "Multi-Contract Audit (~$600)",
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
  const typeParam = searchParams.get("type");
  const isCustom = typeParam === "custom";
  const initialType = isCustom ? 9 : (typeParam ? parseInt(typeParam) : 0);

  const { address } = useAccount();
  const [serviceType, setServiceType] = useState(initialType);
  const [description, setDescription] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [step, setStep] = useState<"form" | "approve" | "post" | "done">("form");

  const selectedStandard = serviceType < 9;

  const { data: priceRaw } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "servicePriceInClawd",
    args: [serviceType],
  });

  const price = selectedStandard
    ? (priceRaw ? formatUnits(priceRaw, 18) : "0")
    : customAmount;

  const priceWei = selectedStandard
    ? (priceRaw || BigInt(0))
    : (customAmount ? parseUnits(customAmount, 18) : BigInt(0));

  const { writeContractAsync: postAsync } = useScaffoldWriteContract("LeftClawServices");

  const handlePost = async () => {
    if (!description.trim()) {
      alert("Please describe your job");
      return;
    }

    try {
      setStep("post");

      if (selectedStandard) {
        await postAsync({
          functionName: "postJob",
          args: [serviceType, description],
        });
      } else {
        await postAsync({
          functionName: "postJobCustom",
          args: [priceWei, description],
        });
      }
      setStep("done");
    } catch (e: any) {
      console.error(e);
      if (e?.message?.includes("insufficient allowance") || e?.message?.includes("ERC20")) {
        alert("You need to approve CLAWD spending first. Visit the Debug page to call approve() on the CLAWD token.");
      }
      setStep("form");
    }
  };

  if (step === "done") {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-4">Job Posted!</h1>
        <p className="opacity-70 mb-8">Your job has been posted on-chain. LeftClaw will review and accept it shortly.</p>
        <Link href="/jobs" className="btn btn-primary">View Job Board →</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl font-bold mb-2">🦞 Post a Job</h1>
      <p className="opacity-70 mb-8">Describe what you need built, audited, or consulted on.</p>

      <div className="w-full max-w-lg">
        {/* Service Type */}
        <div className="form-control mb-4">
          <label className="label"><span className="label-text font-bold">Service Type</span></label>
          <select
            className="select select-bordered w-full"
            value={serviceType}
            onChange={e => setServiceType(parseInt(e.target.value))}
          >
            {Object.entries(SERVICE_NAMES).map(([id, name]) => (
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
              className="input input-bordered w-full"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
            />
          </div>
        )}

        {/* Price Display */}
        <div className="bg-base-200 rounded-lg p-4 mb-4">
          <div className="flex justify-between">
            <span className="opacity-70">Price:</span>
            <span className="font-mono font-bold">{Number(price).toLocaleString()} CLAWD</span>
          </div>
        </div>

        {/* Description */}
        <div className="form-control mb-6">
          <label className="label"><span className="label-text font-bold">Job Description</span></label>
          <textarea
            className="textarea textarea-bordered w-full h-32"
            placeholder="Describe what you need. Be specific about requirements, timeline, and deliverables..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <label className="label">
            <span className="label-text-alt opacity-50">This will be stored as the description CID on-chain</span>
          </label>
        </div>

        {/* Note about approval */}
        <div className="alert alert-info mb-4">
          <span>💡 You&apos;ll need to approve CLAWD spending first. Use the <a href="/debug" className="underline font-bold">Debug</a> page to call approve() on the CLAWD token contract, or approve directly in your wallet.</span>
        </div>

        {/* Submit */}
        {!address ? (
          <div className="alert alert-warning">
            <span>Connect your wallet to post a job</span>
          </div>
        ) : (
          <button
            className={`btn btn-primary w-full ${step === "post" ? "loading" : ""}`}
            onClick={handlePost}
            disabled={step !== "form" || !description.trim() || (serviceType === 9 && !customAmount)}
          >
            {step === "post" ? "Posting..." : "Post Job 🦞"}
          </button>
        )}
      </div>
    </div>
  );
}
