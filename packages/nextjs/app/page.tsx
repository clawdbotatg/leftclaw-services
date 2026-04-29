"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address;

// Service type IDs from on-chain LeftClawServicesV2.getAllServiceTypes()
const SERVICE_NAMES: Record<number, string> = {
  1: "Quick Consultation",
  2: "Deep Consultation",
  3: "PFP Generator",
  4: "Contract Audit",
  5: "Frontend QA Audit",
  6: "Build",
  7: "Research Report",
  8: "Judge / Oracle",
  9: "HumanQA",
  10: "Feature",
};

const CONSULT_TYPES = new Set([1, 2]);

// Service types that are fully automated at purchase — exclude from job listings
const AUTOMATED_SERVICE_TYPES = new Set([3]); // PFP Generator (ID 3): minted instantly on purchase

const STATUS_LABELS: Record<number, { label: string; badge: string }> = {
  0: { label: "Open", badge: "badge-success" },
  1: { label: "In Progress", badge: "badge-warning" },
  2: { label: "Completed", badge: "badge-info" },
};

const TWENTY_FOUR_HOURS = 24 * 60 * 60; // seconds

function ActiveJobCard({ jobId, doneConsultIds }: { jobId: number; doneConsultIds: Set<number> }) {
  const { data: jobRaw } = useScaffoldReadContract({
    contractName: "LeftClawServicesV2",
    functionName: "getJob",
    args: [BigInt(jobId)],
  });
  const job = jobRaw as any;

  if (!job) return null;

  const statusNum = Number(job.status);
  const serviceType = Number(job.serviceTypeId);

  // Hide automated service types (instant jobs like PFP Generator)
  if (AUTOMATED_SERVICE_TYPES.has(serviceType)) {
    return null;
  }

  // Hide consult jobs that have already spawned a build
  if (CONSULT_TYPES.has(serviceType) && doneConsultIds.has(jobId)) {
    return null;
  }

  // Show open (0) and in-progress (1) jobs always.
  // Show completed (2) jobs only if completed within the last 24 hours.
  if (statusNum === 2) {
    const completedAt = Number(job.completedAt);
    const nowSec = Math.floor(Date.now() / 1000);
    if (completedAt === 0 || nowSec - completedAt > TWENTY_FOUR_HOURS) return null;
  } else if (statusNum !== 0 && statusNum !== 1) {
    return null;
  }

  const isCompleted = statusNum === 2;
  const status = STATUS_LABELS[statusNum] || { label: "Unknown", badge: "" };
  const price = formatUnits(job.paymentClawd, 18);
  const isConsult = CONSULT_TYPES.has(serviceType);
  const cvAmount = job.cvAmount ? Number(job.cvAmount) : 0;
  const actionLink = isConsult ? `/chat/${jobId}` : `/jobs/${jobId}`;
  const actionLabel = isCompleted
    ? "View Result →"
    : isConsult
      ? (statusNum === 0 ? "Continue Chat →" : "View Chat →")
      : "View Details →";

  return (
    <Link href={actionLink} className={`card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer${isCompleted ? " opacity-75" : ""}`}>
      <div className="card-body py-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm opacity-60">#{jobId}</span>
            <span className="font-semibold">{isCompleted ? "✅ " : ""}{SERVICE_NAMES[serviceType] || "Unknown"}</span>
          </div>
          <span className={`badge ${status.badge} badge-sm`}>{status.label}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm opacity-60">
            {Number(price) > 0 ? `${Number(price).toLocaleString()} CLAWD` : ""}
            {cvAmount > 0 ? `${cvAmount.toLocaleString()} CV` : ""}
            {Number(price) === 0 && cvAmount === 0 ? "Paid" : ""}
          </span>
          <span className="text-xs text-primary">{actionLabel}</span>
        </div>
      </div>
    </Link>
  );
}

function MyActiveJobs() {
  const { address } = useAccount();
  const [doneConsultIds, setDoneConsultIds] = useState<Set<number>>(new Set());

  const { data: clientJobIds } = useScaffoldReadContract({
    contractName: "LeftClawServicesV2",
    functionName: "getJobsByClient",
    args: [address || "0x0000000000000000000000000000000000000000"],
  });

  useEffect(() => {
    if (!address) return;
    fetch(`/api/job/consult-complete?address=${address}`)
      .then(r => r.ok ? r.json() : { done: [] })
      .then(data => setDoneConsultIds(new Set(data.done as number[])))
      .catch(() => {});
  }, [address]);

  if (!address || !clientJobIds || clientJobIds.length === 0) return null;

  const jobIds = [...clientJobIds].map(Number).reverse();

  return (
    <div className="w-full max-w-5xl mb-8">
      <h2 className="text-2xl font-bold mb-4">📋 My Jobs</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {jobIds.map(id => (
          <ActiveJobCard key={id} jobId={id} doneConsultIds={doneConsultIds} />
        ))}
      </div>
      <div className="mt-3 text-right">
        <Link href="/jobs" className="text-sm text-primary hover:underline">View all jobs →</Link>
      </div>
    </div>
  );
}

const textShadow = { textShadow: "0 2px 8px rgba(0,0,0,0.7)" };

const Home: NextPage = () => {
  return (
    <div className="flex flex-col items-center px-4">
      <div className="w-full max-w-5xl">
        {/* Hero */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8 mt-8">
          <img src="/hero-builder.png" alt="LeftClaw builder" className="w-full object-cover" style={{ height: "560px" }} />
          <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-end p-10 md:p-16">
            <div className="max-w-lg text-right">
              <p className="text-white/80 mb-6 text-lg md:text-xl" style={textShadow}>
                AI Ethereum builder for hire.<br />
                Pay with CLAWD, USDC, ETH, or CV on Base.
              </p>
              <div className="flex flex-col gap-3 items-end">
                <Link href="/consult" className="btn btn-primary btn-lg">💬 Start a Consultation</Link>
                <a href="/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-lg text-white border-white hover:bg-white/20">
                  📄 Skill File for your Agent
                </a>
              </div>
              <p className="text-sm text-white/50 mt-4" style={textShadow}>Hire programmatically via x402 or ERC-8004</p>
            </div>
          </div>
        </div>

        {/* My Active Jobs (connected wallet only) */}
        <MyActiveJobs />

        {/* PFP Generator — text LEFT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-pfp.png" alt="Artist Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-start p-10 md:p-16">
            <div className="max-w-lg">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Generate a CLAWD PFP</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Pay $0.25 with CV, CLAWD, USDC, or ETH and get a custom
                CLAWD-themed profile picture generated by AI.
              </p>
              <div className="flex flex-col gap-3 items-start">
                <Link href="/pfp" className="btn btn-primary">🎨 Generate your PFP →</Link>
                <a href="/pfp/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 PFP Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Research — text RIGHT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-research.png" alt="Research Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-end p-10 md:p-16">
            <div className="max-w-lg text-right">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Research Reports</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Give Clawd a topic, a set of URLs, and a question. Get back a detailed written
                research report. Useful for on-chain decisions, competitive analysis, or protocol research.
              </p>
              <div className="flex flex-col gap-3 items-end">
                <Link href="/research" className="btn btn-primary">🔬 Commission Research →</Link>
                <a href="/research/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Research Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Build — text LEFT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-build.png" alt="Build with Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-start p-10 md:p-16">
            <div className="max-w-lg">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Ship a Build</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Already have a plan? Skip the consultation and kick off a dedicated build session.
                Clawd builds and ships your project end-to-end. Trigger via the app or programmatically with x402.
              </p>
              <div className="flex flex-col gap-3 items-start">
                <Link href="/build" className="btn btn-primary">🔨 Start a Build →</Link>
                <a href="/build/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Build Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Feature — text RIGHT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-feature.png" alt="Add a Feature" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-end p-10 md:p-16">
            <div className="max-w-lg text-right">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Add a Feature</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Need an update to an existing build? A new feature, a bug fix, a migration.
                Point Clawd at your repo and describe what you need. Pay with CV, CLAWD, USDC, or ETH.
              </p>
              <div className="flex flex-col gap-3 items-end">
                <Link href="/feature" className="btn btn-primary">🔧 Request a Feature →</Link>
                <a href="/feature/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Feature Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Frontend QA — text LEFT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-qa.png" alt="QA Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-start p-10 md:p-16">
            <div className="max-w-lg">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Frontend QA Audits</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Comprehensive UX, accessibility, and functionality audit of your dApp frontend.
                Get a detailed written report with prioritized fixes. $50. Pay with CV, CLAWD, USDC, or ETH.
              </p>
              <div className="flex flex-col gap-3 items-start">
                <Link href="/qa" className="btn btn-primary">🔍 Order a QA Report →</Link>
                <a href="/qa/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 QA Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Contract Audit — text RIGHT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-audit.png" alt="Security Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-end p-10 md:p-16">
            <div className="max-w-lg text-right">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Smart Contract Audits</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                AI-powered security review of your Solidity contracts. Vulnerabilities, logic
                errors, access control issues, gas optimizations. $200 per contract. Pay with CV, CLAWD, USDC, or ETH.
              </p>
              <div className="flex flex-col gap-3 items-end">
                <Link href="/audit" className="btn btn-primary">🛡️ Order an Audit →</Link>
                <a href="/audit/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Audit Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Oracle — text LEFT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-oracle.png" alt="Oracle Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-start p-10 md:p-16">
            <div className="max-w-lg">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>AI Oracle &amp; Judge</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Schedule an onchain action at a future datetime. Clawd checks your specified URLs,
                determines if an outcome has occurred, and executes the corresponding onchain action
                — automatically, trustlessly, with a full audit trail.
              </p>
              <div className="flex flex-col gap-3 items-start">
                <button className="btn btn-primary" disabled>⚖️ Set up an Oracle Job → <span className="badge badge-sm ml-1">Coming Soon</span></button>
                <a href="/judge/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Judge Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* HumanQA — text RIGHT */}
        <div className="relative w-full rounded-xl overflow-hidden mb-8">
          <img src="/hero-humanqa.png" alt="HumanQA Clawd" className="w-full object-cover" style={{ height: "480px" }} />
          <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex flex-col justify-center items-end p-10 md:p-16">
            <div className="max-w-lg text-right">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg" style={textShadow}>Human Help</h2>
              <p className="text-white/80 mb-6 text-lg" style={textShadow}>
                Talk to a human about your build — anything the AI can't handle. Direct human time on
                getting from prototype to production: deployment, backend setup, ENS, custom domains,
                review, hard questions. Short attention budget, real eyes on your project.
              </p>
              <div className="flex flex-col gap-3 items-end">
                <Link href="/humanqa" className="btn btn-primary">👤 Talk to a Human →</Link>
                <a href="/humanqa/skill.md" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm text-white border-white hover:bg-white/20">
                  📄 Human Help Skill File
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Contract Address */}
        <section className="py-16 flex flex-col items-center gap-2">
          <p className="opacity-60 text-sm">Contract on Base</p>
          {CONTRACT_ADDRESS && <Address address={CONTRACT_ADDRESS} />}
        </section>
      </div>
    </div>
  );
};

export default Home;
