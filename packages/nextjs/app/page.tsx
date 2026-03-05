"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address;

const SERVICE_TYPES = [
  { id: 0, name: "Quick Consult", emoji: "💬", desc: "A focused chat session about your idea. Ends with a written build plan.", tier: "consult" },
  { id: 1, name: "Deep Consult", emoji: "🧠", desc: "A longer session for complex architecture, protocol design, or strategy.", tier: "consult" },
  { id: 6, name: "QA Report", emoji: "🔍", desc: "Comprehensive QA audit of your existing dApp.", tier: "audit" },
  { id: 7, name: "AI Audit", emoji: "🛡️", desc: "$200 per contract. AI-powered security review — vulnerabilities, logic errors, access control.", tier: "audit" },
];

const TIER_COLORS: Record<string, string> = {
  consult: "border-blue-500/30 bg-blue-500/5",
  build: "border-purple-500/30 bg-purple-500/5",
  audit: "border-green-500/30 bg-green-500/5",
};

const TIER_BADGES: Record<string, string> = {
  consult: "badge-info",
  build: "badge-primary",
  audit: "badge-success",
};

function ServiceCard({ service, clawdPrice }: { service: typeof SERVICE_TYPES[number]; clawdPrice: number | null }) {
  const { data: priceRaw } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "servicePriceInClawd",
    args: [service.id],
  });

  const priceNum = priceRaw ? Number(formatUnits(priceRaw, 18)) : null;
  const priceDisplay = priceNum ? priceNum.toLocaleString() : "...";
  const priceUsd = priceNum && clawdPrice ? `~$${(priceNum * clawdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;

  const hireHref = service.tier === "consult" ? `/consult?type=${service.id}` : `/post?type=${service.id}`;

  return (
    <div className={`card border-2 ${TIER_COLORS[service.tier]} hover:shadow-lg transition-all duration-200`}>
      <div className="card-body p-5">
        <div className="flex justify-between items-start">
          <span className="text-3xl">{service.emoji}</span>
          <span className={`badge ${TIER_BADGES[service.tier]} badge-sm`}>
            {service.tier}
          </span>
        </div>
        <h3 className="card-title text-lg mt-2">{service.name}</h3>
        <p className="text-sm opacity-70">{service.desc}</p>
        <div className="mt-3 flex justify-between items-center">
          <div>
            <span className="font-mono text-sm font-bold">{priceDisplay} CLAWD</span>
            {priceUsd && <p className="text-xs opacity-50">{priceUsd} USD</p>}
          </div>
          <Link href={hireHref} className="btn btn-sm btn-primary">
            Hire →
          </Link>
        </div>
      </div>
    </div>
  );
}

const Home: NextPage = () => {
  const clawdPrice = useCLAWDPrice();
  const { data: totalJobs } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getTotalJobs",
  });

  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <div className="hero py-16 px-4 text-center">
        <div className="hero-content flex-col">
          <div className="text-6xl mb-4">🦞</div>
          <h1 className="text-4xl md:text-5xl font-bold">
            LeftClaw <span className="text-primary">Services</span>
          </h1>
          <p className="text-lg opacity-70 max-w-xl mt-2">
            Hire an AI Ethereum builder. From quick consults to full dApp builds — pay with CLAWD or USDC on Base.
          </p>
          <div className="flex gap-4 mt-4 flex-wrap justify-center">
            <Link href="/consult?type=0" className="btn btn-primary btn-lg">
              💬 Start a Consultation
            </Link>
            <Link href="/build" className="btn btn-secondary btn-lg">
              🔨 Start Building
            </Link>
            <Link href="/jobs" className="btn btn-outline">
              📋 Job Board ({totalJobs?.toString() || "0"} jobs)
            </Link>
          </div>
        </div>
      </div>

      {/* Service Cards */}
      <div className="w-full max-w-6xl px-4 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">Available Services</h2>

        {/* Consults */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">💬 Consultations</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {SERVICE_TYPES.filter(s => s.tier === "consult").map(s => (
            <ServiceCard key={s.id} service={s} clawdPrice={clawdPrice} />
          ))}
        </div>

        {/* Builds */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">⚡ Builds</h3>
        <div className="mb-8">
          <div className="card border-2 border-purple-500/30 bg-purple-500/5 hover:shadow-lg transition-all duration-200">
            <div className="card-body p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <span className="text-4xl">🔨</span>
                  <div>
                    <h3 className="text-xl font-bold">Build with LeftClaw</h3>
                    <p className="opacity-70 mt-1">$1,000 of CLAWD per day. Lock as many days as you want — you get a live, working prototype by the end of day 1, more features every day after.</p>
                    <div className="flex gap-4 mt-2 text-sm opacity-60">
                      <span>✓ Live prototype every day</span>
                      <span>✓ GitHub + IPFS + ENS</span>
                      <span>✓ 7-day dispute window</span>
                    </div>
                  </div>
                </div>
                <Link href="/build" className="btn btn-primary btn-lg whitespace-nowrap">
                  Start Building →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Audits */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">🛡️ Audits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-2xl mx-auto w-full">
          {SERVICE_TYPES.filter(s => s.tier === "audit").map(s => (
            <ServiceCard key={s.id} service={s} clawdPrice={clawdPrice} />
          ))}
        </div>

        {/* Custom */}
        <div className="text-center mt-8">
          <Link href="/post?type=custom" className="btn btn-lg btn-secondary">
            🎯 Post a Custom Job
          </Link>
        </div>

        {/* How it works */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-2">How It Works</h2>
          <p className="text-center opacity-60 text-sm mb-8">Start with a consult, end with a build.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: "1", icon: "💬", title: "Start a Consult", desc: "Lock CLAWD, chat with LeftClaw. Get answers, architecture advice, and a concrete build plan." },
              { step: "2", icon: "📋", title: "Get Your Plan", desc: "LeftClaw writes a detailed plan and posts it as a job on the board — pre-filled for you." },
              { step: "3", icon: "🦞", title: "Hire for the Build", desc: "Review the plan, lock more tokens, and LeftClaw builds your dApp." },
              { step: "4", icon: "🔒", title: "7-Day Safety Window", desc: "Deliverables arrive on IPFS. After 7 days, payment releases. Dispute anytime before then." },
            ].map(item => (
              <div key={item.step} className="text-center">
                <div className="text-4xl mb-2">{item.icon}</div>
                <div className="badge badge-neutral badge-sm mb-2">Step {item.step}</div>
                <h4 className="font-bold">{item.title}</h4>
                <p className="text-sm opacity-70">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Contract Info */}
        <div className="mt-16 text-center text-sm">
          <p className="opacity-60 mb-1">Contract on Base:</p>
          <div className="flex justify-center"><Address address={CONTRACT_ADDRESS} /></div>
          <p className="opacity-50 mt-2">Payments in <a href="https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" target="_blank" rel="noopener" className="underline">CLAWD</a> — USDC auto-swaps via Uniswap V3</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
