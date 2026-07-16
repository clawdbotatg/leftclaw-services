"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useReadContracts } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

// Service type IDs from on-chain LeftClawServicesV2.getAllServiceTypes()
const BUILD_TYPES: Record<number, string> = { 6: "Build", 10: "Feature" };
const AUDIT_TYPES: Record<number, string> = { 4: "Contract Audit", 5: "Frontend QA Audit" };

const STATUS_LABELS: Record<number, { label: string; badge: string }> = {
  0: { label: "Open", badge: "badge-success" },
  1: { label: "In Progress", badge: "badge-warning" },
  2: { label: "Completed", badge: "badge-info" },
  3: { label: "Cancelled", badge: "badge-error" },
  4: { label: "Disputed", badge: "badge-error" },
};

type Job = {
  id: number;
  serviceTypeId: number;
  status: number;
  description: string;
  resultCID: string;
  currentStage: string;
  createdAt: number;
  completedAt: number;
};

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Build descriptions are often a pasted build-plan.md — pull out the plan title and overview */
function parseBuildDescription(description: string): { title: string | null; blurb: string } {
  const cleaned = description.replace(/^\s*\/\/\s*---\s*build-plan\.md\s*---\s*/i, "").trim();
  const titleMatch = cleaned.match(/#\s*Build Plan:?\s*([^\n#]+)/i);
  if (titleMatch) {
    const overviewMatch = cleaned.match(/##\s*Overview\s*([^#]+)/i);
    const blurb = overviewMatch ? overviewMatch[1] : cleaned.slice((titleMatch.index ?? 0) + titleMatch[0].length);
    return { title: titleMatch[1].trim(), blurb: blurb.trim() };
  }
  return { title: null, blurb: cleaned };
}

function resultLink(resultCID: string): { href: string; label: string } | null {
  if (!resultCID) return null;
  if (resultCID.startsWith("http")) {
    const isRepo = /github\.com|gist\./i.test(resultCID);
    return { href: resultCID, label: isRepo ? "View the code →" : "Open it →" };
  }
  return { href: `https://${resultCID}.ipfs.community.bgipfs.com/`, label: "Open it →" };
}

/** Big highlighted card for a dapp being built / shipped */
function DappCard({ job }: { job: Job }) {
  const status = STATUS_LABELS[job.status] || { label: "Unknown", badge: "" };
  const building = job.status === 1;
  const link = job.status === 2 ? resultLink(job.resultCID) : null;
  const { title, blurb } = parseBuildDescription(job.description);

  return (
    <div
      className={`card bg-base-200 border ${
        building ? "border-warning shadow-lg shadow-warning/10" : "border-base-300"
      }`}
    >
      <div className="card-body p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">{job.serviceTypeId === 10 ? "✨" : "🔨"}</span>
            <span className="font-semibold">{BUILD_TYPES[job.serviceTypeId]}</span>
            <span className="font-mono text-xs opacity-50">#{job.id}</span>
          </div>
          <span className={`badge ${status.badge} badge-sm whitespace-nowrap`}>
            {building ? "🔥 Building now" : status.label}
          </span>
        </div>

        {title && <div className="font-semibold mt-1">{truncate(title, 80)}</div>}
        <p className={`text-sm opacity-80 mb-0 ${title ? "mt-0.5" : "mt-1"}`}>{truncate(blurb, title ? 160 : 220)}</p>

        {building && job.currentStage && (
          <div className="text-xs mt-2 flex items-center gap-2">
            <span className="loading loading-dots loading-xs" />
            <span className="opacity-70">{job.currentStage}</span>
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs opacity-50">
            {job.status === 2 ? `Shipped ${formatDate(job.completedAt)}` : `Started ${formatDate(job.createdAt)}`}
          </span>
          <div className="flex items-center gap-3">
            <Link href={`/jobs/${job.id}`} className="text-xs link link-hover opacity-60">
              Details
            </Link>
            {link && (
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-xs">
                {link.label}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact card for a delivered audit */
function AuditCard({ job, hasPretty }: { job: Job; hasPretty: boolean }) {
  const href = hasPretty ? `/result/${job.id}.html` : `/jobs/${job.id}`;
  return (
    <a
      href={href}
      target={hasPretty ? "_blank" : undefined}
      rel={hasPretty ? "noopener noreferrer" : undefined}
      className="card bg-base-200 hover:bg-base-300 transition-colors"
    >
      <div className="card-body py-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span>{job.serviceTypeId === 5 ? "🖥️" : "🛡️"}</span>
            <span className="font-semibold text-sm truncate">{AUDIT_TYPES[job.serviceTypeId]}</span>
            <span className="font-mono text-xs opacity-50">#{job.id}</span>
          </div>
          <span className="text-xs opacity-50 whitespace-nowrap">{formatDate(job.completedAt)}</span>
        </div>
        <p className="text-xs opacity-60 mt-0.5 mb-0 truncate">{truncate(job.description, 100)}</p>
        <span className="text-xs text-primary mt-1">{hasPretty ? "📄 Read the report →" : "View job →"}</span>
      </div>
    </a>
  );
}

export default function ShowcasePage() {
  const { data: totalJobs } = useScaffoldReadContract({
    contractName: "LeftClawServicesV2",
    functionName: "getTotalJobs",
  });

  const jobCount = totalJobs ? Number(totalJobs) : 0;

  const { data: jobsRaw } = useReadContracts({
    contracts: Array.from({ length: jobCount }, (_, i) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI as any,
      functionName: "getJob",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: jobCount > 0 },
  });

  const jobs: Job[] = useMemo(() => {
    if (!jobsRaw) return [];
    return jobsRaw
      .map(r => r.result as any)
      .filter(Boolean)
      .map(j => ({
        id: Number(j.id),
        serviceTypeId: Number(j.serviceTypeId),
        status: Number(j.status),
        description: String(j.description || ""),
        resultCID: String(j.resultCID || ""),
        currentStage: String(j.currentStage || ""),
        createdAt: Number(j.createdAt),
        completedAt: Number(j.completedAt),
      }));
  }, [jobsRaw]);

  const dapps = useMemo(() => {
    const list = jobs.filter(j => BUILD_TYPES[j.serviceTypeId] && j.status <= 2);
    // Building-now first, then most recently shipped
    return list.sort((a, b) => {
      if ((a.status === 1) !== (b.status === 1)) return a.status === 1 ? -1 : 1;
      return (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt);
    });
  }, [jobs]);

  const audits = useMemo(
    () =>
      jobs.filter(j => AUDIT_TYPES[j.serviceTypeId] && j.status === 2).sort((a, b) => b.completedAt - a.completedAt),
    [jobs],
  );

  // Pretty reports are static files at /result/<id>.html — probe which audits have one
  const [prettyIds, setPrettyIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (audits.length === 0) return;
    let alive = true;
    Promise.all(
      audits.map(j =>
        fetch(`/result/${j.id}.html`, { method: "HEAD" })
          .then(r => (r.ok ? j.id : null))
          .catch(() => null),
      ),
    ).then(ids => {
      if (alive) setPrettyIds(new Set(ids.filter((id): id is number => id !== null)));
    });
    return () => {
      alive = false;
    };
  }, [audits]);

  const loading = jobCount === 0 || !jobsRaw;

  return (
    <div className="flex flex-col items-center py-8 px-4 min-h-screen">
      <h1 className="text-3xl font-bold mb-1">🦞 The Work</h1>
      <p className="text-sm opacity-60 mb-8 text-center max-w-lg">
        Everything LeftClaw has shipped — dapps built for clients, and security audits delivered.
      </p>

      {loading ? (
        <div className="py-16">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : (
        <>
          {/* Dapps — the headline section */}
          <div className="w-full max-w-4xl mb-12">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-bold">🚀 Dapps</h2>
              <span className="text-sm opacity-50">{dapps.length} builds</span>
            </div>
            {dapps.length === 0 ? (
              <p className="opacity-60 text-sm">
                No builds yet —{" "}
                <Link href="/build" className="link">
                  be the first
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dapps.map(j => (
                  <DappCard key={j.id} job={j} />
                ))}
              </div>
            )}
          </div>

          {/* Audits — separate, compact */}
          <div className="w-full max-w-4xl">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-bold">🛡️ Audits</h2>
              <span className="text-sm opacity-50">{audits.length} delivered</span>
            </div>
            {audits.length === 0 ? (
              <p className="opacity-60 text-sm">No completed audits yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {audits.map(j => (
                  <AuditCard key={j.id} job={j} hasPretty={prettyIds.has(j.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
