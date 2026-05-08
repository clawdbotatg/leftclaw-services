"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { ServiceHero, UnifiedPaymentFlow } from "~~/components/payment";
import { SERVICE_META } from "~~/lib/servicesMeta";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

// Contract service type ID 4 = Contract Audit
const SERVICE_TYPE_ID = 4;

const meta = SERVICE_META["audit"];

interface ServiceType {
  id: bigint;
  name: string;
  slug: string;
  priceUsd: bigint;
  cvDivisor: bigint;
  status: string;
}

function AuditPageContent() {
  const publicClient = usePublicClient();
  const searchParams = useSearchParams();
  const initialDescription = searchParams.get("description") || "";
  const [service, setService] = useState<ServiceType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!publicClient) return;

    (async () => {
      try {
        const svc = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "getServiceType",
          args: [BigInt(SERVICE_TYPE_ID)],
        }) as ServiceType;

        if (svc.status === "active") {
          setService(svc);
        } else {
          setNotFound(true);
        }
      } catch (e) {
        console.error("Failed to load audit service type", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [publicClient]);

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
        <p className="opacity-60">Audit service not found or inactive</p>
      </div>
    );
  }

  const priceUsd = Number(service.priceUsd) / 1e6;
  const cvDivisor = Number(service.cvDivisor);

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen">
      <div className="w-full max-w-lg">
        <ServiceHero
          name="Smart Contract Audit"
          emoji={meta.emoji}
          tagline={meta.tagline}
          bullets={meta.bullets}
          heroImage={meta.heroImage}
          heroPosition={meta.heroPosition}
        />

        <UnifiedPaymentFlow
          serviceTypeId={SERVICE_TYPE_ID}
          priceUsd={priceUsd}
          cvDivisor={cvDivisor}
          serviceName="Contract Audit"
          descriptionLabel={meta.descriptionLabel}
          descriptionPlaceholder={meta.descriptionPlaceholder}
          descriptionRequired={true}
          initialDescription={initialDescription}
          onSuccess={jobId => `/jobs/${jobId}`}
        />

        <div className="mt-[100px] flex justify-center">
          <a href="/audit/skill.md" className="btn btn-outline btn-sm opacity-60 hover:opacity-100">
            Agent / bot? Read the skill file →
          </a>
        </div>
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-[50vh]"><span className="loading loading-spinner loading-lg" /></div>}>
      <AuditPageContent />
    </Suspense>
  );
}
