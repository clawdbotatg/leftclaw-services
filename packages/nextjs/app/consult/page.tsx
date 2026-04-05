"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { ServiceHero, UnifiedPaymentFlow } from "~~/components/payment";
import { SERVICE_META } from "~~/lib/servicesMeta";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

interface ServiceType {
  id: bigint;
  name: string;
  slug: string;
  priceUsd: bigint;
  cvDivisor: bigint;
  status: string;
}

const CONSULT_EXTRA = {
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
  const publicClient = usePublicClient();
  const typeParam = Number(searchParams.get("type") ?? "0");
  const serviceType = typeParam === 1 ? 1 : 0;
  const extra = CONSULT_EXTRA[serviceType as 0 | 1];
  const meta = SERVICE_META["consult"] || SERVICE_META["consult-deep"];

  const [service, setService] = useState<ServiceType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!publicClient) return;

    const serviceId = serviceType === 1 ? 2 : 1; // type=0 → ID 1, type=1 → ID 2

    (async () => {
      try {
        const svc = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "getServiceType",
          args: [BigInt(serviceId)],
        }) as ServiceType;

        if (svc.status === "active") {
          setService(svc);
        } else {
          setNotFound(true);
        }
      } catch (e) {
        console.error("Failed to load consult service type", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [publicClient, serviceType]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (notFound || !service) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="opacity-60">Consult service not found or inactive</p>
      </div>
    );
  }

  const priceUsd = Number(service.priceUsd) / 1e6;
  const cvDivisor = Number(service.cvDivisor);
  const serviceTypeId = Number(service.id);

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <ServiceHero
          name={extra.name}
          emoji={extra.emoji}
          tagline={extra.tagline}
          bullets={extra.bullets}
          heroImage={meta?.heroImage}
          heroPosition={meta?.heroPosition}
        />

        <UnifiedPaymentFlow
          serviceTypeId={serviceTypeId}
          priceUsd={priceUsd}
          cvDivisor={cvDivisor}
          serviceName={extra.name}
          descriptionLabel="What do you want to build?"
          descriptionPlaceholder="e.g. A staking dApp where users earn ETH rewards on CLAUD deposits..."
          descriptionRequired={false}
          onSuccess={(jobId, description) => {
            const desc = description || `${extra.name} session`;
            try { localStorage.setItem(`consult-topic-${jobId}`, desc); } catch {}
            if (!String(jobId).startsWith("cv-")) {
              fetch("/api/job/sanitize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId: String(jobId), description: desc }),
              }).catch(() => {});
            }
            return `/chat/${jobId}`;
          }}
        />

        <div className="mt-[100px] flex justify-center">
          <a
            href={serviceType === 1 ? "/consult-deep/skill.md" : "/consult/skill.md"}
            className="btn btn-outline btn-sm opacity-60 hover:opacity-100"
          >
            Agent / bot? Read the skill file →
          </a>
        </div>
      </div>
    </div>
  );
}
