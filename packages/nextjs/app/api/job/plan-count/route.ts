import { NextRequest, NextResponse } from "next/server";
import { verifyAuthSignature } from "~~/lib/authSignature";
import { getJobClient } from "~~/lib/workerAuth";
import { getJobPlanCount, getJobPlanGist } from "~~/lib/sessionStore";

// The latest plan gist URL points at a "secret" GitHub gist — anyone with the URL
// can read the full build plan, so leaking it leaks the plan. On-chain (numeric)
// job ids are sequentially enumerable, so gate them behind the owner signature.
// `cv-*` ids are off-chain synthetic (`cv-<epoch_ms>`), not sequentially
// enumerable and have no on-chain client to check against, so they pass through.
// See PRIVACY_AUDIT.md F2.
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  if (!jobId.startsWith("cv-")) {
    const address = req.nextUrl.searchParams.get("address");
    const sig = req.nextUrl.searchParams.get("sig");
    if (!address || !sig) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await verifyAuthSignature(address, sig))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const client = await getJobClient(jobId);
    if (!client) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (client !== address.toLowerCase()) {
      return NextResponse.json({ error: "Not the job client" }, { status: 403 });
    }
  }

  const [count, gist] = await Promise.all([
    getJobPlanCount(jobId),
    getJobPlanGist(jobId),
  ]);

  return NextResponse.json({
    planGenerations: count,
    latestPlanGistUrl: gist?.url || null,
    latestPlanDescription: gist?.description || null,
  });
}
