import { NextRequest } from "next/server";
import { getJobMessages } from "~~/lib/sessionStore";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), { status: 400 });
  }

  const messages = await getJobMessages(jobId);

  return new Response(JSON.stringify({ jobId, messages }), {
    headers: { "Content-Type": "application/json" },
  });
}
