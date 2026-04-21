import { NextRequest, NextResponse } from "next/server";
import { getJob } from "~~/lib/jobStore";
import { verifyWindowedSig, getRegisteredWorkers } from "~~/lib/workerAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const callerAddress = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!callerAddress || !sig) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sigValid = await verifyWindowedSig(callerAddress, sig, w => `LeftClaw Job ${id} - ${w}`);
  if (!sigValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const isOwner = job.payer && callerAddress.toLowerCase() === job.payer.toLowerCase();
  if (!isOwner) {
    const workers = await getRegisteredWorkers();
    if (!workers.includes(callerAddress.toLowerCase())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
