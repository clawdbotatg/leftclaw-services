import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { saveConsultPrompt } from "~~/lib/consultPrompt";
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
const MAX_DESCRIPTION_LEN = 50_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, description, address: callerAddress, sig } = body;

    if (jobId === undefined || jobId === null || !description || !callerAddress || !sig) {
      return NextResponse.json(
        { error: "jobId, description, address, sig required" },
        { status: 400 },
      );
    }

    if (typeof description !== "string" || description.length === 0 || description.length > MAX_DESCRIPTION_LEN) {
      return NextResponse.json({ error: "Invalid description" }, { status: 400 });
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

    await saveConsultPrompt(Number(jobId), description);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("save-consult-prompt error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
