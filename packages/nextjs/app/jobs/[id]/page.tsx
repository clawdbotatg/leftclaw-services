"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { formatUnits } from "viem";

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
  7: "Contract Audit",
  8: "Multi-Contract Audit",
  9: "Custom",
};

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id as string;

  const { data: job, isLoading } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getJob",
    args: [BigInt(jobId || "0")],
  });

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
  const price = formatUnits(job.paymentClawd, 18);
  const createdAt = new Date(Number(job.createdAt) * 1000);
  const completedAt = job.completedAt > 0 ? new Date(Number(job.completedAt) * 1000) : null;
  const disputeEnd = completedAt ? new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null;

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
              </div>
              <div>
                <span className="text-sm opacity-50">Client</span>
                <p className="font-mono text-sm">{job.client?.slice(0,6)}...{job.client?.slice(-4)}</p>
              </div>
              <div>
                <span className="text-sm opacity-50">Created</span>
                <p className="text-sm">{createdAt.toLocaleString()}</p>
              </div>
              {job.executor !== "0x0000000000000000000000000000000000000000" && (
                <div>
                  <span className="text-sm opacity-50">Executor</span>
                  <p className="font-mono text-sm">{job.executor?.slice(0,6)}...{job.executor?.slice(-4)}</p>
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

            {disputeEnd && Number(job.status) === 2 && !job.paymentClaimed && (
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
          </div>
        </div>
      </div>
    </div>
  );
}
