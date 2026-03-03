"use client";

import Link from "next/link";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { formatUnits } from "viem";

const STATUS_LABELS: Record<number, { label: string; badge: string }> = {
  0: { label: "Open", badge: "badge-success" },
  1: { label: "In Progress", badge: "badge-warning" },
  2: { label: "Completed", badge: "badge-info" },
  3: { label: "Cancelled", badge: "badge-error" },
  4: { label: "Disputed", badge: "badge-error" },
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

function JobRow({ jobId }: { jobId: number }) {
  const { data: job } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getJob",
    args: [BigInt(jobId)],
  });

  if (!job) return <tr><td colSpan={5} className="text-center opacity-50">Loading...</td></tr>;

  const serviceType = Number(job.serviceType);
  // Hide consultation jobs from the board
  if (serviceType <= 1) return null;

  const status = STATUS_LABELS[Number(job.status)] || { label: "Unknown", badge: "" };
  const price = formatUnits(job.paymentClawd, 18);

  return (
    <tr className="hover">
      <td className="font-mono">#{jobId}</td>
      <td>{SERVICE_NAMES[serviceType] || "Unknown"}</td>
      <td>
        <span className="font-mono text-sm">{Number(price).toLocaleString()} CLAWD</span>
      </td>
      <td>
        <span className={`badge ${status.badge} badge-sm`}>{status.label}</span>
      </td>
      <td>
        <Link href={`/jobs/${jobId}`} className="btn btn-xs btn-outline">
          View →
        </Link>
      </td>
    </tr>
  );
}

export default function JobsPage() {
  const { data: totalJobs } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getTotalJobs",
  });

  const jobCount = totalJobs ? Number(totalJobs) : 0;
  const jobIds = Array.from({ length: jobCount }, (_, i) => jobCount - i);

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl font-bold mb-2">📋 Job Board</h1>
      <p className="opacity-70 mb-8">{jobCount} total jobs posted</p>

      <div className="flex gap-4 mb-8">
        <Link href="/post" className="btn btn-primary btn-sm">Post a Job</Link>
        <Link href="/" className="btn btn-outline btn-sm">← Services</Link>
      </div>

      {jobCount === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📭</div>
          <p className="text-lg opacity-70">No jobs posted yet</p>
          <Link href="/post" className="btn btn-primary mt-4">Be the first →</Link>
        </div>
      ) : (
        <div className="w-full max-w-4xl overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Service</th>
                <th>Payment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobIds.map(id => (
                <JobRow key={id} jobId={id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
