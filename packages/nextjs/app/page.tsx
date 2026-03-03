"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";

const SERVICE_TYPES = [
  { id: 0, name: "Quick Consult", emoji: "💬", desc: "15-message consultation. Get answers to your Ethereum questions.", tier: "consult" },
  { id: 1, name: "Deep Consult", emoji: "🧠", desc: "30-message deep-dive. Architecture review, strategy planning.", tier: "consult" },
  { id: 2, name: "Simple Build", emoji: "🔨", desc: "Single contract + basic frontend. Simple but solid.", tier: "build" },
  { id: 3, name: "Standard Build", emoji: "⚡", desc: "Full dApp build — contract + frontend + deployment.", tier: "build" },
  { id: 4, name: "Complex Build", emoji: "🏗️", desc: "Multi-contract system with advanced frontend and integrations.", tier: "build" },
  { id: 5, name: "Enterprise Build", emoji: "🚀", desc: "The works. Complex protocol, testing, audit, deployment.", tier: "build" },
  { id: 6, name: "QA Report", emoji: "🔍", desc: "Comprehensive QA audit of your existing dApp.", tier: "audit" },
  { id: 7, name: "Contract Audit", emoji: "🛡️", desc: "Security review of a single smart contract.", tier: "audit" },
  { id: 8, name: "Multi-Contract Audit", emoji: "🔐", desc: "Full protocol security audit — multiple contracts.", tier: "audit" },
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
          <Link href={`/post?type=${service.id}`} className="btn btn-sm btn-primary">
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
          <div className="flex gap-4 mt-4">
            <Link href="/jobs" className="btn btn-outline">
              📋 View Job Board ({totalJobs?.toString() || "0"} jobs)
            </Link>
            <Link href="/post" className="btn btn-primary">
              🦞 Post a Job
            </Link>
          </div>
        </div>
      </div>

      {/* Service Cards */}
      <div className="w-full max-w-6xl px-4 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">Available Services</h2>

        {/* Consults */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">💬 Consultations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {SERVICE_TYPES.filter(s => s.tier === "consult").map(s => (
            <ServiceCard key={s.id} service={s} clawdPrice={clawdPrice} />
          ))}
        </div>

        {/* Builds */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">⚡ Builds</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {SERVICE_TYPES.filter(s => s.tier === "build").map(s => (
            <ServiceCard key={s.id} service={s} clawdPrice={clawdPrice} />
          ))}
        </div>

        {/* Audits */}
        <h3 className="text-lg font-semibold mb-4 opacity-70">🛡️ Audits</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {SERVICE_TYPES.filter(s => s.tier === "audit").map(s => (
            <ServiceCard key={s.id} service={s} clawdPrice={clawdPrice} />
          ))}
        </div>

        {/* Custom */}
        <div className="text-center mt-8">
          <Link href="/post?type=custom" className="btn btn-lg btn-outline btn-secondary">
            🎯 Post a Custom Job
          </Link>
        </div>

        {/* How it works */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: "1", icon: "📝", title: "Post a Job", desc: "Choose a service and describe what you need. Pay with CLAWD or USDC." },
              { step: "2", icon: "🦞", title: "LeftClaw Accepts", desc: "LeftClaw reviews and accepts your job. Work begins immediately." },
              { step: "3", icon: "✅", title: "Work Delivered", desc: "Receive your deliverables with an IPFS result link." },
              { step: "4", icon: "🔒", title: "7-Day Safety", desc: "Dispute window protects you. After 7 days, payment is released." },
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
          <Address address="0x8FB713Dc14Bd9d0f32E3b8eA13B4F4b7F4C9D335" />
          <p className="opacity-50 mt-2">Payments in <a href="https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" target="_blank" rel="noopener" className="underline">CLAWD</a> — USDC auto-swaps via Uniswap V3</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
