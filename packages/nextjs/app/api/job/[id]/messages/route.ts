import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { getMessages, addJobMessage } from "~~/lib/jobMessages";
import { verifyAuthSignature } from "~~/lib/authSignature";
import { getRegisteredWorkers } from "~~/lib/workerAuth";
import deployedContracts from "~~/contracts/deployedContracts";

const { address: contractAddress, abi } = deployedContracts[8453].LeftClawServicesV2;

const viemClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
      : undefined,
  ),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), { status: 400 });
  }

  const callerAddress = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!callerAddress || !sig) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Verify the long-lived "LeftClaw Services Auth" signature (7-day localStorage cache on client)
  const sigValid = await verifyAuthSignature(callerAddress, sig);
  if (!sigValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  // Resolve job owner from chain; allow the assigned worker and registered workers too
  let jobClient: string | null = null;
  let jobWorker: string | null = null;
  try {
    const numericId = jobId.startsWith("cv-") ? BigInt(jobId.slice(3)) : BigInt(jobId);
    const job = (await viemClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getJob",
      args: [numericId],
    })) as any;
    jobClient = job.client.toLowerCase();
    jobWorker = job.worker.toLowerCase();
  } catch {
    // jobId not found on chain — fall through to worker check
  }

  const caller = callerAddress.toLowerCase();
  const isOwnerOrWorker = caller === jobClient || caller === jobWorker;
  if (!isOwnerOrWorker) {
    const workers = await getRegisteredWorkers();
    if (!workers.includes(caller)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
  }

  const messages = await getMessages(jobId);

  return new Response(JSON.stringify({ jobId, messages }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  if (!jobId) {
    return Response.json({ error: "Job ID required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { type, from, question, details, stage } = body;

    if (type !== "escalation" || from !== "bot") {
      return Response.json({ error: "Only escalation messages from bot are accepted via this endpoint" }, { status: 400 });
    }

    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }

    const msg = await addJobMessage(jobId, {
      type: "escalation",
      from: "bot",
      content: details || question,
      metadata: { question, stage: stage || "unknown" },
    });

    return Response.json({ ok: true, messageId: msg.id });
  } catch (e) {
    console.error("POST /api/job/[id]/messages error:", e);
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
