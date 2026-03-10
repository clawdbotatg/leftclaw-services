"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const SERVICE_TYPES = [
  { id: 0, name: "Quick Consult", emoji: "💬" },
  { id: 1, name: "Deep Consult", emoji: "🧠" },
  { id: 2, name: "Daily Build", emoji: "🔨" },
  { id: 3, name: "Build M (reserved)", emoji: "🏗️" },
  { id: 4, name: "Build L (reserved)", emoji: "⚙️" },
  { id: 5, name: "Build XL (reserved)", emoji: "🏢" },
  { id: 6, name: "QA Report", emoji: "🔍" },
  { id: 7, name: "Quick Audit", emoji: "🛡️" },
  { id: 8, name: "AI Audit (Multi-Contract)", emoji: "🔐" },
  { id: 9, name: "Custom", emoji: "✨" },
];

const SERVICE_NAME: Record<number, string> = Object.fromEntries(SERVICE_TYPES.map(s => [s.id, `${s.emoji} ${s.name}`]));

const STATUS_LABELS: Record<number, { text: string; badge: string }> = {
  0: { text: "OPEN", badge: "badge-info" },
  1: { text: "IN PROGRESS", badge: "badge-warning" },
  2: { text: "COMPLETED", badge: "badge-success" },
  3: { text: "CANCELLED", badge: "badge-ghost" },
  4: { text: "DISPUTED", badge: "badge-error" },
};

const STATUS_FILTERS = [
  { value: -1, label: "All" },
  { value: 0, label: "Open" },
  { value: 1, label: "In Progress" },
  { value: 2, label: "Completed" },
  { value: 4, label: "Disputed" },
  { value: 3, label: "Cancelled" },
];

// Build service types for burn consultation dropdown (only build types make sense as recommendations)
const BUILD_TYPES = [
  { id: 2, name: "Simple Build" },
  { id: 3, name: "Standard Build" },
  { id: 4, name: "Complex Build" },
  { id: 5, name: "Enterprise Build" },
];

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|user denied/i.test(msg)) return "Cancelled";
  if (/Not authorized/i.test(msg)) return "Not authorized — worker only";
  const m = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (m) return m[1];
  return "Transaction failed";
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Pipeline Dashboard ──────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  "create_plan", "create_user_journey", "prototype", "contract_audit", "contract_fix",
  "deep_contract_audit", "deep_contract_fix",
  "frontend_audit", "frontend_fix", "full_audit", "full_audit_fix",
  "deploy_contract", "livecontract_fix", "deploy_app", "liveapp_fix",
  "liveuserjourney", "readme", "ready",
];

function PipelineDashboard() {
  const [workers, setWorkers] = useState<{ address: string; activeJobs: number[] }[]>([]);
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [readyJobs, setReadyJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/job/workers").then(r => r.json()).catch(() => ({ workers: [] })),
      fetch("/api/job/pipeline").then(r => r.json()).catch(() => ({ jobs: [] })),
      fetch("/api/job/ready").then(r => r.json()).catch(() => ({ jobs: [] })),
    ]).then(([w, p, r]) => {
      setWorkers(w.workers || []);
      setPipeline(p.jobs || []);
      setReadyJobs(r.jobs || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="card bg-base-200 mb-8"><div className="card-body"><span className="loading loading-spinner" /></div></div>;

  return (
    <>
      {/* Workers */}
      <div className="card bg-base-200 mb-4">
        <div className="card-body">
          <h2 className="font-bold mb-3">🤖 Workers ({workers.length})</h2>
          {workers.length === 0 ? (
            <p className="text-sm opacity-50">No workers registered</p>
          ) : (
            <div className="space-y-2">
              {workers.map(w => (
                <div key={w.address} className="flex items-center justify-between bg-base-300 rounded-lg px-4 py-2">
                  <span className="font-mono text-sm">{w.address}</span>
                  <div>
                    {w.activeJobs.length > 0 ? (
                      <span className="badge badge-warning badge-sm">Working: #{w.activeJobs.join(", #")}</span>
                    ) : (
                      <span className="badge badge-ghost badge-sm">Idle</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="card bg-base-200 mb-8">
        <div className="card-body">
          <h2 className="font-bold mb-3">🔧 Pipeline</h2>

          {/* Open jobs waiting */}
          {readyJobs.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold opacity-60 mb-2">⏳ Open — Waiting for a bot to accept</h3>
              {readyJobs.map(j => (
                <div key={j.id} className="bg-base-300 rounded-lg px-4 py-2 mb-1 text-sm">
                  <span className="font-bold">Job #{j.id}</span> — {j.description?.slice(0, 80)}{j.description?.length > 80 ? "..." : ""}
                </div>
              ))}
            </div>
          )}

          {/* In-progress jobs by stage */}
          {pipeline.length > 0 ? (
            <div className="space-y-2">
              {pipeline.map(j => {
                const stageIdx = PIPELINE_STAGES.indexOf(j.stage);
                const nextStage = stageIdx >= 0 && stageIdx < PIPELINE_STAGES.length - 1
                  ? PIPELINE_STAGES[stageIdx + 1] : null;
                return (
                  <div key={j.id} className="bg-base-300 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">Job #{j.id}</span>
                      <div className="flex gap-2">
                        <span className="badge badge-info badge-sm">✅ {j.stage}</span>
                        {nextStage && <span className="badge badge-warning badge-sm">⏭️ {nextStage}</span>}
                      </div>
                    </div>
                    <p className="text-xs opacity-50">{j.description?.slice(0, 100)}{j.description?.length > 100 ? "..." : ""}</p>
                    {/* Progress bar */}
                    <div className="w-full bg-base-100 rounded-full h-2 mt-2">
                      <div
                        className="bg-primary rounded-full h-2 transition-all"
                        style={{ width: `${((stageIdx + 1) / PIPELINE_STAGES.length) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs opacity-40 mt-1">{stageIdx + 1}/{PIPELINE_STAGES.length} stages</p>
                    {/* Last work log */}
                    {j.workLogs?.length > 0 && (
                      <p className="text-xs opacity-50 mt-1 italic">
                        Last log: {j.workLogs[j.workLogs.length - 1].note.slice(0, 120)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            readyJobs.length === 0 && <p className="text-sm opacity-50">No jobs in pipeline</p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────

interface JobData {
  id: bigint;
  client: string;
  serviceType: number;
  paymentClawd: bigint;
  priceUsd: bigint;
  descriptionCID: string;
  status: number;
  createdAt: bigint;
  startedAt: bigint;
  completedAt: bigint;
  resultCID: string;
  worker: string;
  paymentClaimed: boolean;
  feeSnapshot: bigint;
  disputedAt: bigint;
}

function JobCard({
  job,
  clawdPrice,
  onAction,
}: {
  job: JobData;
  clawdPrice: number | null;
  onAction: (action: string, jobId: bigint, args?: any) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resultCID, setResultCID] = useState("");
  const [gistUrl, setGistUrl] = useState("");
  const [recommendedBuild, setRecommendedBuild] = useState(2);
  const [workNote, setWorkNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const clawdAmount = Number(formatUnits(job.paymentClawd, 18));
  const usdValue =
    job.priceUsd > 0n ? Number(formatUnits(job.priceUsd, 6)) : clawdPrice ? clawdAmount * clawdPrice : null;
  const isConsult = job.serviceType === 0 || job.serviceType === 1;
  const statusInfo = STATUS_LABELS[job.status] || { text: "UNKNOWN", badge: "badge-ghost" };

  const DISPUTE_WINDOW = 7 * 24 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const disputeExpired = job.completedAt > 0n && now > Number(job.completedAt) + DISPUTE_WINDOW;

  // Work logs
  const { data: workLogs, refetch: refetchLogs } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getWorkLogs",
    args: [job.id],
    query: { enabled: expanded },
  });

  const doAction = async (action: string, args?: any) => {
    setBusy(action);
    setError("");
    setSuccessMsg("");
    try {
      await onAction(action, job.id, args);
      setSuccessMsg(`${action} ✓`);
      setTimeout(() => setSuccessMsg(""), 3000);
      if (action === "logWork") {
        setWorkNote("");
        refetchLogs();
      }
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-base-300 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm">#{Number(job.id)}</span>
          <span className={`badge ${statusInfo.badge} badge-sm`}>{statusInfo.text}</span>
          <span className="text-xs opacity-60">{SERVICE_NAME[job.serviceType] || "Unknown"}</span>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Summary row */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="opacity-60">
            Client: <span className="font-mono">{truncAddr(job.client)}</span>
          </span>
          <span className="opacity-40">·</span>
          <span className="opacity-60">{timeAgo(Number(job.createdAt))}</span>
        </div>
        <div className="text-right">
          <span className="font-mono font-bold">
            {usdValue ? `$${usdValue.toLocaleString()}` : `${clawdAmount.toLocaleString()} CLAWD`}
          </span>
          <span className="text-xs opacity-50 ml-2">{clawdAmount.toLocaleString()} CLAWD</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        {job.status === 0 && (
          <>
            <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => doAction("accept")}>
              {busy === "accept" ? <span className="loading loading-spinner loading-xs" /> : "Accept"}
            </button>
            <button
              className="btn btn-sm btn-error btn-outline"
              disabled={busy !== null}
              onClick={() => doAction("reject")}
            >
              {busy === "reject" ? <span className="loading loading-spinner loading-xs" /> : "Reject"}
            </button>
          </>
        )}

        {job.status === 2 && !job.paymentClaimed && disputeExpired && (
          <button className="btn btn-sm btn-success" disabled={busy !== null} onClick={() => doAction("claim")}>
            {busy === "claim" ? <span className="loading loading-spinner loading-xs" /> : "Claim Payment"}
          </button>
        )}

        {job.status === 2 && !job.paymentClaimed && !disputeExpired && job.completedAt > 0n && (
          <span className="text-xs opacity-50 self-center">
            Dispute window: {Math.ceil((Number(job.completedAt) + DISPUTE_WINDOW - now) / 86400)}d left
          </span>
        )}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="mt-4 space-y-4 border-t border-base-100 pt-4">
          {/* Description CID */}
          <div className="text-xs">
            <span className="opacity-50">Description CID: </span>
            <a
              href={`https://ipfs.io/ipfs/${job.descriptionCID}`}
              target="_blank"
              className="link link-primary font-mono break-all"
            >
              {job.descriptionCID}
            </a>
          </div>

          {/* Result CID if exists */}
          {job.resultCID && (
            <div className="text-xs">
              <span className="opacity-50">Result: </span>
              <a
                href={job.resultCID.startsWith("http") ? job.resultCID : `https://ipfs.io/ipfs/${job.resultCID}`}
                target="_blank"
                className="link link-primary font-mono break-all"
              >
                {job.resultCID}
              </a>
            </div>
          )}

          {/* Worker */}
          {job.worker !== "0x0000000000000000000000000000000000000000" && (
            <div className="text-xs">
              <span className="opacity-50">Worker: </span>
              <span className="font-mono">{truncAddr(job.worker)}</span>
            </div>
          )}

          {/* IN_PROGRESS actions */}
          {job.status === 1 && (
            <div className="space-y-3">
              {/* Complete Job (non-consult) */}
              {!isConsult && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs opacity-50 mb-1 block">Result CID</label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full font-mono text-xs"
                      placeholder="bafybei..."
                      value={resultCID}
                      onChange={e => setResultCID(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-success"
                    disabled={busy !== null || !resultCID}
                    onClick={() => doAction("complete", { resultCID })}
                  >
                    {busy === "complete" ? <span className="loading loading-spinner loading-xs" /> : "Complete"}
                  </button>
                </div>
              )}

              {/* Burn Consultation */}
              {isConsult && (
                <div className="bg-base-200 rounded-lg p-3 space-y-2">
                  <h4 className="text-xs font-bold opacity-70">🔥 Burn Consultation</h4>
                  <div>
                    <label className="text-xs opacity-50 mb-1 block">Gist / Plan URL</label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full text-xs"
                      placeholder="https://gist.github.com/..."
                      value={gistUrl}
                      onChange={e => setGistUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs opacity-50 mb-1 block">Recommended Build Type</label>
                    <select
                      className="select select-bordered select-sm w-full text-xs"
                      value={recommendedBuild}
                      onChange={e => setRecommendedBuild(Number(e.target.value))}
                    >
                      {BUILD_TYPES.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn btn-sm btn-warning"
                    disabled={busy !== null || !gistUrl}
                    onClick={() => doAction("burnConsultation", { gistUrl, recommendedBuildType: recommendedBuild })}
                  >
                    {busy === "burnConsultation" ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      "🔥 Burn & Complete"
                    )}
                  </button>
                </div>
              )}

              {/* Log Work */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs opacity-50 mb-1 block">Work Log ({workNote.length}/500)</label>
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full text-xs"
                    placeholder="Progress update..."
                    maxLength={500}
                    value={workNote}
                    onChange={e => setWorkNote(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={busy !== null || !workNote}
                  onClick={() => doAction("logWork", { note: workNote })}
                >
                  {busy === "logWork" ? <span className="loading loading-spinner loading-xs" /> : "Log"}
                </button>
              </div>
            </div>
          )}

          {/* Work Logs */}
          {Array.isArray(workLogs) && (workLogs as any[]).length > 0 && (
            <div>
              <h4 className="text-xs font-bold opacity-70 mb-2">📝 Work Logs</h4>
              <div className="space-y-1">
                {(workLogs as any[]).map((log: any, i: number) => (
                  <div key={i} className="text-xs bg-base-200 rounded px-3 py-2 flex justify-between">
                    <span>{log.note}</span>
                    <span className="opacity-40 ml-2 whitespace-nowrap">{timeAgo(Number(log.timestamp))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors / Success */}
          {error && <p className="text-xs text-error">{error}</p>}
          {successMsg && <p className="text-xs text-success">{successMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const { address } = useAccount();
  const clawdPrice = useCLAWDPrice();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Price management state
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [success, setSuccess] = useState<Record<number, boolean>>({});

  // Job management state
  const [statusFilter, setStatusFilter] = useState(-1);

  // Check worker status
  const { data: isWorkerData } = useReadContracts({
    contracts: address
      ? [{ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any, functionName: "isWorker", args: [address] }]
      : [],
    query: { enabled: !!address },
  });
  const isWorker = !!isWorkerData?.[0]?.result;

  // Total jobs count
  const { data: totalJobsData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getTotalJobs",
  });
  const totalJobs = totalJobsData ? Number(totalJobsData) : 0;

  // Read all jobs
  const { data: jobsData, refetch: refetchJobs } = useReadContracts({
    contracts: Array.from({ length: totalJobs }, (_, i) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI as any,
      functionName: "getJob",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: totalJobs > 0 },
  });

  const allJobs: JobData[] = (jobsData || [])
    .map(d => d.result as JobData | undefined)
    .filter((j): j is JobData => !!j);

  const filteredJobs = statusFilter === -1 ? allJobs : allJobs.filter(j => j.status === statusFilter);

  // Sort: most recent first
  const sortedJobs = [...filteredJobs].sort((a, b) => Number(b.id) - Number(a.id));

  // Read all service prices
  const { data: pricesData, refetch: refetchPrices } = useReadContracts({
    contracts: SERVICE_TYPES.filter(s => s.id < 9).map(s => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI as any,
      functionName: "servicePriceUsd",
      args: [s.id],
    })),
  });

  // Job actions
  const handleJobAction = async (action: string, jobId: bigint, args?: any) => {
    let hash: `0x${string}`;
    switch (action) {
      case "accept":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "acceptJob",
          args: [jobId],
        });
        break;
      case "reject":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "rejectJob",
          args: [jobId],
        });
        break;
      case "complete":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "completeJob",
          args: [jobId, args.resultCID],
        });
        break;
      case "burnConsultation":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "burnConsultation",
          args: [jobId, args.gistUrl, args.recommendedBuildType],
        });
        break;
      case "claim":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "claimPayment",
          args: [jobId],
        });
        break;
      case "logWork":
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI as any,
          functionName: "logWork",
          args: [jobId, args.note],
        });
        break;
      default:
        throw new Error("Unknown action");
    }
    await publicClient?.waitForTransactionReceipt({ hash });
    await refetchJobs();
  };

  // Price update
  const handlePriceUpdate = async (serviceId: number) => {
    const usdInput = inputs[serviceId];
    if (!usdInput || !clawdPrice) return;

    const usdValue = parseFloat(usdInput);
    if (isNaN(usdValue) || usdValue <= 0) {
      setErrors(e => ({ ...e, [serviceId]: "Enter a valid USD amount" }));
      return;
    }

    // Convert USD to USDC (6 decimals)
    const usdcAmount = parseUnits(usdValue.toString(), 6);

    setErrors(e => ({ ...e, [serviceId]: "" }));
    setSuccess(s => ({ ...s, [serviceId]: false }));
    setPending(serviceId);

    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "updatePrice",
        args: [serviceId, usdcAmount],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchPrices();
      setInputs(i => ({ ...i, [serviceId]: "" }));
      setSuccess(s => ({ ...s, [serviceId]: true }));
      setTimeout(() => setSuccess(s => ({ ...s, [serviceId]: false })), 3000);
    } catch (e) {
      setErrors(err => ({ ...err, [serviceId]: parseError(e) }));
    } finally {
      setPending(null);
    }
  };

  if (!address) {
    return (
      <div className="flex justify-center py-20">
        <p className="opacity-60">Connect your wallet to access admin</p>
      </div>
    );
  }

  if (!isWorker) {
    return (
      <div className="flex justify-center py-20">
        <p className="opacity-60">🚫 Worker access only</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-bold mb-1">🦞 Admin</h1>
        <p className="opacity-50 text-sm mb-8">
          CLAWD price: {clawdPrice ? `$${clawdPrice.toFixed(8)}` : "loading..."}
        </p>

        {/* ─── Pipeline Dashboard ──────────────────────────────────── */}
        <PipelineDashboard />

        {/* ─── Job Management ──────────────────────────────────────── */}
        <div className="card bg-base-200 mb-8">
          <div className="card-body">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold">Jobs ({totalJobs})</h2>
              <button className="btn btn-ghost btn-xs" onClick={() => refetchJobs()}>
                ↻ Refresh
              </button>
            </div>

            {/* Status filter tabs */}
            <div className="tabs tabs-boxed mb-4">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  className={`tab tab-sm ${statusFilter === f.value ? "tab-active" : ""}`}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                  {f.value >= 0 && (
                    <span className="ml-1 opacity-50">({allJobs.filter(j => j.status === f.value).length})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Job list */}
            <div className="space-y-3">
              {sortedJobs.length === 0 ? (
                <p className="text-sm opacity-50 text-center py-4">No jobs</p>
              ) : (
                sortedJobs.map(job => (
                  <JobCard key={Number(job.id)} job={job} clawdPrice={clawdPrice} onAction={handleJobAction} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── Service Prices ──────────────────────────────────────── */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="font-bold mb-4">Service Prices</h2>
            <div className="space-y-4">
              {SERVICE_TYPES.filter(s => s.id < 9).map((service, i) => {
                const priceRaw = pricesData?.[i]?.result as bigint | undefined;
                const priceUsd = priceRaw ? Number(formatUnits(priceRaw, 6)) : null;
                const isBusy = pending === service.id;

                return (
                  <div key={service.id} className="flex flex-col gap-1.5 bg-base-300 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {service.emoji} {service.name}
                      </span>
                      <div className="text-right">
                        <p className="font-mono text-sm font-bold">
                          {priceUsd !== null ? `$${priceUsd.toLocaleString()}` : "..."}
                        </p>
                        {priceUsd !== null && clawdPrice && (
                          <p className="text-xs opacity-50">
                            ~{Math.round(priceUsd / clawdPrice).toLocaleString()} CLAWD
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 items-center mt-1">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-50">$</span>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full pl-6 text-sm"
                          placeholder="New price in USD"
                          value={inputs[service.id] ?? ""}
                          onChange={e => setInputs(i => ({ ...i, [service.id]: e.target.value }))}
                          disabled={isBusy}
                          min="0"
                          step="1"
                        />
                      </div>
                      <button
                        className={`btn btn-sm ${success[service.id] ? "btn-success" : "btn-primary"}`}
                        onClick={() => handlePriceUpdate(service.id)}
                        disabled={isBusy || !inputs[service.id]}
                      >
                        {isBusy ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : success[service.id] ? (
                          "✓"
                        ) : (
                          "Update"
                        )}
                      </button>
                    </div>

                    {errors[service.id] && <p className="text-xs text-error">{errors[service.id]}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
