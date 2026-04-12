import { NextRequest, NextResponse } from "next/server";
import { getJobPlanCount, getJobPlanGist } from "~~/lib/sessionStore";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
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
