import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { getConsultPrompt } from "~~/lib/consultPrompt";
import { verifyAuthSignature } from "~~/lib/authSignature";
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

const CONSULT_SERVICE_TYPE_IDS = new Set([1, 2]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!jobId) return NextResponse.json({ error: "Job ID required" }, { status: 400 });

  const callerAddress = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!callerAddress || !sig) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sigValid = await verifyAuthSignature(callerAddress, sig);
  if (!sigValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let job: any;
  try {
    job = await viemClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getJob",
      args: [BigInt(jobId)],
    });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.client.toLowerCase() !== callerAddress.toLowerCase()) {
    return NextResponse.json({ error: "Not the job client" }, { status: 403 });
  }

  if (!CONSULT_SERVICE_TYPE_IDS.has(Number(job.serviceTypeId))) {
    return NextResponse.json({ error: "Not a consult job" }, { status: 400 });
  }

  const prompt = await getConsultPrompt(jobId);
  return NextResponse.json({ jobId, description: prompt });
}
