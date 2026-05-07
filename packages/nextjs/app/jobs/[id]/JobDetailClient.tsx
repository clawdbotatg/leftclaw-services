"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import JobChatPanel from "./JobChatPanel";
import { useParams } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "Transaction cancelled";
  if (/insufficient funds for gas/i.test(msg)) return "Not enough ETH for gas fees";
  if (/Not the client/i.test(msg)) return "Only the job client can do this";
  if (/Can only cancel OPEN jobs/i.test(msg)) return "You can only cancel jobs that are still open";
  if (/Job not COMPLETED/i.test(msg)) return "This job has not been completed yet";
  const revertMatch = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (revertMatch) return revertMatch[1];
  return "Transaction failed — please try again";
}

const STATUS_LABELS: Record<number, { label: string; badge: string; desc: string }> = {
  0: { label: "Open", badge: "badge-success", desc: "Waiting for LeftClaw to accept" },
  1: { label: "In Progress", badge: "badge-warning", desc: "LeftClaw is working on this" },
  2: { label: "Completed", badge: "badge-info", desc: "Work delivered." },
  3: { label: "Declined", badge: "badge-error", desc: "Worker declined. Payment refunded." },
  4: { label: "Cancelled", badge: "badge-error", desc: "Job was cancelled. Payment refunded." },
};

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
};

const CONSULT_TYPES = new Set([1, 2]);

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

export default function JobDetailClient() {
  const params = useParams();
  const jobId = params.id as string;
  const { address } = useAccount();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [logNote, setLogNote] = useState("");
  const [resultURL, setResultCID] = useState("");

  const {
    data: jobRaw,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "LeftClawServicesV2",
    functionName: "getJob",
    args: [BigInt(jobId || "0")],
  });
  const job = jobRaw as any;

  const { data: isContractExecutorRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "isWorker",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const isContractExecutor = !!isContractExecutorRaw;

  const { data: workLogsData, refetch: refetchWorkLogs } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getWorkLogs",
    args: [BigInt(jobId || "0")],
  });

  // Sanitization status — check first, trigger if missing (for pre-existing jobs)
  const [sanitization, setSanitization] = useState<{ safe: boolean | null; reason?: string; checkedAt?: string; pending?: boolean } | null>(null);
  useEffect(() => {
    if (!jobId || !job) return;

    const triggerCheck = () => {
      const desc = job.description || `Job #${jobId}`;
      return fetch("/api/job/sanitize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: String(jobId), description: desc }),
      }).then(r2 => r2.json()).then(d => setSanitization(d));
    };

    fetch(`/api/job/sanitize?jobId=${jobId}`)
      .then(r => r.json())
      .then(d => {
        // If pending or not found, trigger a check
        if (d.pending || d.safe === null || d.error) {
          return triggerCheck();
        }
        setSanitization(d);
      })
      .catch(() => triggerCheck());
  }, [jobId, job]);

  const clawdPrice = useCLAWDPrice();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-6xl mb-4">❌</div>
        <p>Job not found</p>
        <Link href="/jobs" className="btn btn-primary mt-4">
          ← Back to Jobs
        </Link>
      </div>
    );
  }

  const status = STATUS_LABELS[Number(job.status)] || { label: "Unknown", badge: "", desc: "" };
  const serviceType = Number(job.serviceTypeId);
  const jobStatus = Number(job.status);
  const price = formatUnits(job.paymentClawd, 18);
  const priceUsd = clawdPrice ? (Number(price) * clawdPrice).toFixed(2) : null;
  const createdAt = new Date(Number(job.createdAt) * 1000);
  const completedAt = job.completedAt > 0 ? new Date(Number(job.completedAt) * 1000) : null;
  const isClient = address?.toLowerCase() === job.client?.toLowerCase();
  const isAssignedWorker = address?.toLowerCase() === job.worker?.toLowerCase();
  const isOpen = jobStatus === 0;
  const isConsult = CONSULT_TYPES.has(serviceType);

  const handleAccept = async () => {
    setActionError(null);
    setPending("acceptJob");
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "acceptJob",
        args: [BigInt(jobId)],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
    } catch (e) {
      setActionError(parseError(e));
    } finally {
      setPending(null);
    }
  };

  const handleLogWork = async () => {
    if (!logNote.trim()) return;
    setActionError(null);
    setPending("logWork");
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "logWork",
        args: [BigInt(jobId), logNote.trim()],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setLogNote("");
      await refetchWorkLogs();
    } catch (e) {
      setActionError(parseError(e));
    } finally {
      setPending(null);
    }
  };

  const handleComplete = async () => {
    if (!resultURL.trim()) return;
    setActionError(null);
    setPending("completeJob");
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "completeJob",
        args: [BigInt(jobId), resultURL.trim()],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setResultCID("");
      await refetch();
    } catch (e) {
      setActionError(parseError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-2xl">
        <Link href="/jobs" className="btn btn-ghost btn-sm mb-4">
          ← Back to Jobs
        </Link>

        <div className="card bg-base-200">
          <div className="card-body">
            <div className="flex justify-between items-start">
              <h1 className="card-title text-2xl">Job #{jobId}</h1>
              <div className="flex gap-2 items-center">
                <span className={`badge ${status.badge}`}>{status.label}</span>
                {sanitization ? (
                  sanitization.safe === null || sanitization.pending
                    ? <span className="badge badge-warning badge-outline">🔄 Checking...</span>
                    : sanitization.safe
                    ? <span className="badge badge-success badge-outline" title={`Checked ${sanitization.checkedAt ? new Date(sanitization.checkedAt).toLocaleString() : ""}`}>🛡️ Sanitized</span>
                    : <span className="badge badge-error badge-outline" title={sanitization.reason || ""}>⚠️ Flagged</span>
                ) : (
                  <span className="badge badge-ghost badge-outline">⏳ Pending review</span>
                )}
              </div>
            </div>

            <p className="text-sm opacity-60">{status.desc}</p>
            <div className="divider"></div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm opacity-50">Service</span>
                <p className="font-bold">{SERVICE_NAMES[serviceType]}</p>
              </div>
              <div>
                <span className="text-sm opacity-50">Payment</span>
                {Number(price) > 0 ? (
                  <>
                    <p className="font-mono font-bold">{Number(price).toLocaleString()} CLAWD</p>
                    {priceUsd && <p className="text-xs opacity-50">~${priceUsd} USD</p>}
                  </>
                ) : job.cvAmount && Number(job.cvAmount) > 0 ? (
                  <p className="font-mono font-bold">{Number(job.cvAmount).toLocaleString()} CV</p>
                ) : (
                  <p className="font-mono font-bold">Paid (ETH/USDC)</p>
                )}
              </div>
              <div>
                <span className="text-sm opacity-50">Client</span>
                <Address address={job.client} />
              </div>
              <div>
                <span className="text-sm opacity-50">Created</span>
                <p className="text-sm">{createdAt.toLocaleString()}</p>
              </div>
              {job.worker !== "0x0000000000000000000000000000000000000000" && (
                <div>
                  <span className="text-sm opacity-50">Executor</span>
                  <Address address={job.worker} />
                </div>
              )}
              {completedAt && (
                <div>
                  <span className="text-sm opacity-50">Completed</span>
                  <p className="text-sm">{completedAt.toLocaleString()}</p>
                </div>
              )}
            </div>

            {job.description && (!isConsult || isClient) && (
              <>
                <div className="divider"></div>
                <div>
                  <span className="text-sm opacity-50">Description</span>
                  <p className="mt-1 whitespace-pre-wrap">{job.description}</p>
                </div>
              </>
            )}
            {isConsult && !isClient && (
              <>
                <div className="divider"></div>
                <div>
                  <span className="text-sm opacity-50">Description</span>
                  <p className="mt-1 italic opacity-60">Consultation prompt is private to the client.</p>
                </div>
              </>
            )}

            {job.resultCID && (
              <>
                <div className="divider"></div>
                <div>
                  <span className="text-sm opacity-50">Result</span>
                  {job.resultCID.startsWith("http") ? (
                    <a
                      href={job.resultCID}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 font-mono text-sm text-blue-400 hover:text-blue-300 underline break-all block"
                    >
                      {job.resultCID}
                    </a>
                  ) : (
                    <a
                      href={`https://${job.resultCID}.ipfs.community.bgipfs.com/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 font-mono text-sm text-blue-400 hover:text-blue-300 underline break-all block"
                    >
                      {job.resultCID}
                    </a>
                  )}
                </div>
              </>
            )}

            {job.paymentClaimed && (
              <div className="alert alert-success mt-4">
                <span>✅ Payment transferred to treasury on acceptance</span>
              </div>
            )}

            {/* Client action buttons */}
            {isClient && (
              <>
                <div className="divider"></div>
                <div className="flex flex-wrap gap-3">
                  {isConsult && isOpen && (
                    <Link href={`/chat/${jobId}`} className="btn btn-primary">
                      💬 Continue Consultation
                    </Link>
                  )}
                  {/* Cancel button hidden — jobs should not be cancelled by users */}
                </div>
              </>
            )}

            {/* Executor controls — only visible to LeftClaw */}
            {isContractExecutor && (
              <>
                <div className="divider"></div>
                <div className="card bg-base-300">
                  <div className="card-body py-4 gap-3">
                    <p className="text-xs font-bold opacity-50 tracking-widest">🦞 EXECUTOR CONTROLS</p>

                    {/* Accept (OPEN jobs) */}
                    {isOpen && (
                      <button className="btn btn-primary w-full" onClick={handleAccept} disabled={!!pending}>
                        {pending === "acceptJob" ? (
                          <span className="loading loading-spinner loading-sm" />
                        ) : (
                          "Accept Job →"
                        )}
                      </button>
                    )}

                    {/* Log work + Complete (IN_PROGRESS, assigned to me) */}
                    {jobStatus === 1 && isAssignedWorker && (
                      <>
                        <textarea
                          className="textarea textarea-bordered w-full text-sm"
                          placeholder="What are you working on right now? (max 500 chars)"
                          rows={2}
                          maxLength={500}
                          value={logNote}
                          onChange={e => setLogNote(e.target.value)}
                          disabled={!!pending}
                        />
                        <button
                          className="btn btn-primary w-full"
                          onClick={handleLogWork}
                          disabled={!!pending || !logNote.trim()}
                        >
                          {pending === "logWork" ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : (
                            "Log Work Update 🦞"
                          )}
                        </button>
                        <div className="divider my-0" />
                        <input
                          type="text"
                          className="input input-bordered w-full text-sm"
                          placeholder="https://github.com/... or https://{CID}.ipfs.community.bgipfs.com/ — URL to repo or report only"
                          value={resultURL}
                          onChange={e => setResultCID(e.target.value)}
                          disabled={!!pending}
                        />
                        <button
                          className="btn btn-success w-full"
                          onClick={handleComplete}
                          disabled={!!pending || !resultURL.trim()}
                        >
                          {pending === "completeJob" ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : (
                            "Mark Complete ✓"
                          )}
                        </button>
                      </>
                    )}

                    {/* V2: Payment transferred to treasury on accept — no claim step */}
                  </div>
                </div>
              </>
            )}

            {actionError && (
              <div className="alert alert-error mt-3">
                <span>{actionError}</span>
              </div>
            )}
          </div>
        </div>
        {/* Job Chat — build jobs, client only */}
        {isClient && !isConsult && address && (
          <JobChatPanel jobId={jobId} clientAddress={address} />
        )}

        {/* Work Log */}
        {(() => {
          const logs = workLogsData as { note: string; timestamp: bigint }[] | undefined;
          if (!logs || logs.length === 0) return null;
          return (
            <div className="mt-6">
              <h3 className="font-bold mb-3 text-lg">📋 Work Log</h3>
              <div className="space-y-2">
                {[...logs].reverse().map((log, i) => (
                  <div key={i} className="flex gap-4 bg-base-200 rounded-lg px-4 py-3">
                    <div className="text-xs opacity-40 whitespace-nowrap pt-0.5 min-w-[90px]">
                      {new Date(Number(log.timestamp) * 1000).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="text-sm">{log.note}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
