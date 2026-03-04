"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { Address } from "@scaffold-ui/components";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { formatUnits } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "Transaction cancelled";
  if (/insufficient funds for gas/i.test(msg)) return "Not enough ETH for gas fees";
  if (/Not the client/i.test(msg)) return "Only the job client can do this";
  if (/Can only cancel OPEN jobs/i.test(msg)) return "You can only cancel jobs that are still open";
  if (/Dispute window active/i.test(msg)) return "Dispute window is still open — executor must wait to claim";
  if (/Dispute window expired/i.test(msg)) return "Dispute window has expired";
  if (/Job not COMPLETED/i.test(msg)) return "This job has not been completed yet";
  if (/Job not claimable/i.test(msg)) return "Payment cannot be claimed yet";
  const revertMatch = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (revertMatch) return revertMatch[1];
  return "Transaction failed — please try again";
}

const STATUS_LABELS: Record<number, { label: string; badge: string; desc: string }> = {
  0: { label: "Open", badge: "badge-success", desc: "Waiting for LeftClaw to accept" },
  1: { label: "In Progress", badge: "badge-warning", desc: "LeftClaw is working on this" },
  2: { label: "Completed", badge: "badge-info", desc: "Work delivered. 7-day dispute window active." },
  3: { label: "Cancelled", badge: "badge-error", desc: "Job was cancelled. Payment refunded." },
  4: { label: "Disputed", badge: "badge-error", desc: "Client disputed. Awaiting owner resolution." },
};

const SERVICE_NAMES: Record<number, string> = {
  0: "Quick Consult",
  1: "Deep Consult",
  2: "Simple Build",
  3: "Standard Build",
  4: "Complex Build",
  5: "Enterprise Build",
  6: "QA Report",
  7: "AI Audit",
  8: "AI Audit (Multi-Contract)",
  9: "Custom",
};

const CONSULT_TYPES = new Set([0, 1]);

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

export default function JobDetailClient() {
  const params = useParams();
  const jobId = params.id as string;
  const { address } = useAccount();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [logNote, setLogNote] = useState("");
  const [resultCID, setResultCID] = useState("");

  const { data: job, isLoading, refetch } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getJob",
    args: [BigInt(jobId || "0")],
  });

  const { data: isContractExecutorRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "isExecutor",
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
        <Link href="/jobs" className="btn btn-primary mt-4">← Back to Jobs</Link>
      </div>
    );
  }

  const status = STATUS_LABELS[Number(job.status)] || { label: "Unknown", badge: "", desc: "" };
  const serviceType = Number(job.serviceType);
  const jobStatus = Number(job.status);
  const price = formatUnits(job.paymentClawd, 18);
  const priceUsd = clawdPrice ? (Number(price) * clawdPrice).toFixed(2) : null;
  const createdAt = new Date(Number(job.createdAt) * 1000);
  const completedAt = job.completedAt > 0 ? new Date(Number(job.completedAt) * 1000) : null;
  const disputeEnd = completedAt ? new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null;

  const isClient = address?.toLowerCase() === job.client?.toLowerCase();
  const isAssignedExecutor = address?.toLowerCase() === job.executor?.toLowerCase();
  const isOpen = jobStatus === 0;
  const isCompleted = jobStatus === 2;
  const isConsult = CONSULT_TYPES.has(serviceType);
  const disputeWindowOver = disputeEnd ? new Date() > disputeEnd : false;

  const call = async (functionName: string) => {
    setActionError(null);
    setPending(functionName);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName,
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
    if (!resultCID.trim()) return;
    setActionError(null);
    setPending("completeJob");
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "completeJob",
        args: [BigInt(jobId), resultCID.trim()],
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
        <Link href="/jobs" className="btn btn-ghost btn-sm mb-4">← Back to Jobs</Link>

        <div className="card bg-base-200">
          <div className="card-body">
            <div className="flex justify-between items-start">
              <h1 className="card-title text-2xl">Job #{jobId}</h1>
              <span className={`badge ${status.badge}`}>{status.label}</span>
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
                <p className="font-mono font-bold">{Number(price).toLocaleString()} CLAWD</p>
                {priceUsd && <p className="text-xs opacity-50">~${priceUsd} USD</p>}
              </div>
              <div>
                <span className="text-sm opacity-50">Client</span>
                <Address address={job.client} />
              </div>
              <div>
                <span className="text-sm opacity-50">Created</span>
                <p className="text-sm">{createdAt.toLocaleString()}</p>
              </div>
              {job.executor !== "0x0000000000000000000000000000000000000000" && (
                <div>
                  <span className="text-sm opacity-50">Executor</span>
                  <Address address={job.executor} />
                </div>
              )}
              {completedAt && (
                <div>
                  <span className="text-sm opacity-50">Completed</span>
                  <p className="text-sm">{completedAt.toLocaleString()}</p>
                </div>
              )}
            </div>

            {job.descriptionCID && (
              <>
                <div className="divider"></div>
                <div>
                  <span className="text-sm opacity-50">Description</span>
                  <p className="mt-1 whitespace-pre-wrap">{job.descriptionCID}</p>
                </div>
              </>
            )}

            {job.resultCID && (
              <>
                <div className="divider"></div>
                <div>
                  <span className="text-sm opacity-50">Result</span>
                  <p className="mt-1 font-mono text-sm break-all">{job.resultCID}</p>
                </div>
              </>
            )}

            {disputeEnd && isCompleted && !job.paymentClaimed && (
              <>
                <div className="divider"></div>
                <div className="alert alert-warning">
                  <span>⏰ Dispute window ends: {disputeEnd.toLocaleString()}</span>
                </div>
              </>
            )}

            {job.paymentClaimed && (
              <div className="alert alert-success mt-4">
                <span>✅ Payment claimed by executor</span>
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
                  {isOpen && (
                    <button
                      className="btn btn-error btn-outline"
                      onClick={() => call("cancelJob")}
                      disabled={!!pending}
                    >
                      {pending === "cancelJob" ? <span className="loading loading-spinner loading-sm" /> : "❌ Cancel Job"}
                    </button>
                  )}
                  {isCompleted && !job.paymentClaimed && !disputeWindowOver && (
                    <button
                      className="btn btn-warning"
                      onClick={() => call("disputeJob")}
                      disabled={!!pending}
                    >
                      {pending === "disputeJob" ? <span className="loading loading-spinner loading-sm" /> : "⚠️ Dispute"}
                    </button>
                  )}
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
                      <button
                        className="btn btn-primary w-full"
                        onClick={handleAccept}
                        disabled={!!pending}
                      >
                        {pending === "acceptJob" ? <span className="loading loading-spinner loading-sm" /> : "Accept Job →"}
                      </button>
                    )}

                    {/* Log work + Complete (IN_PROGRESS, assigned to me) */}
                    {jobStatus === 1 && isAssignedExecutor && (
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
                          {pending === "logWork" ? <span className="loading loading-spinner loading-sm" /> : "Log Work Update 🦞"}
                        </button>
                        <div className="divider my-0" />
                        <input
                          type="text"
                          className="input input-bordered w-full text-sm"
                          placeholder="Result URL, IPFS CID, or GitHub link"
                          value={resultCID}
                          onChange={e => setResultCID(e.target.value)}
                          disabled={!!pending}
                        />
                        <button
                          className="btn btn-success w-full"
                          onClick={handleComplete}
                          disabled={!!pending || !resultCID.trim()}
                        >
                          {pending === "completeJob" ? <span className="loading loading-spinner loading-sm" /> : "Mark Complete ✓"}
                        </button>
                      </>
                    )}

                    {/* Claim payment (COMPLETED, dispute window over) */}
                    {isAssignedExecutor && isCompleted && !job.paymentClaimed && disputeWindowOver && (
                      <button
                        className="btn btn-success w-full"
                        onClick={() => call("claimPayment")}
                        disabled={!!pending}
                      >
                        {pending === "claimPayment" ? <span className="loading loading-spinner loading-sm" /> : "💰 Claim Payment"}
                      </button>
                    )}
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
        {/* Work Log */}
        {(() => {
          const logs = workLogsData as {note: string; timestamp: bigint}[] | undefined;
          if (!logs || logs.length === 0) return null;
          return (
          <div className="mt-6">
            <h3 className="font-bold mb-3 text-lg">📋 Work Log</h3>
            <div className="space-y-2">
              {[...logs].reverse().map((log, i) => (
                <div key={i} className="flex gap-4 bg-base-200 rounded-lg px-4 py-3">
                  <div className="text-xs opacity-40 whitespace-nowrap pt-0.5 min-w-[90px]">
                    {new Date(Number(log.timestamp) * 1000).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
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
