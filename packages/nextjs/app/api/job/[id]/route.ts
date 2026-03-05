import { NextRequest, NextResponse } from "next/server";
import { getJob } from "~~/lib/jobStore";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const response: Record<string, unknown> = {
    jobId: job.id,
    serviceType: job.serviceType,
    status: job.status,
    priceUsd: job.priceUsd,
    createdAt: job.createdAt,
  };

  if (job.status === "completed" && job.result) {
    response.result = job.result;
    response.completedAt = job.completedAt;
  }

  if (job.status === "failed" && job.error) {
    response.error = job.error;
  }

  if (job.status === "queued" || job.status === "processing") {
    response.message = "Job is being processed. Poll again shortly.";
  }

  return NextResponse.json(response);
}
