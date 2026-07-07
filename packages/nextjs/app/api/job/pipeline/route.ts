import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import { verifyWindowedSig, getRegisteredWorkers, getContractOwner, workerAuthMessage } from "~~/lib/workerAuth";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

const rpcUrl = process.env.BASE_RPC_URL?.trim() ||
  (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : undefined);

const client = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const STAGES = ["create_repo", "create_plan", "create_user_journey", "prototype", "contract_audit", "contract_fix", "deep_contract_audit", "deep_contract_fix", "frontend_audit", "frontend_fix", "full_audit", "full_audit_fix", "deploy_contract", "livecontract_fix", "deploy_app", "liveapp_fix", "liveuserjourney", "readme", "ready", "blocked"] as const;

export async function GET(req: NextRequest) {
  const callerAddress = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!callerAddress || !sig) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sigValid = await verifyWindowedSig(callerAddress, sig, workerAuthMessage);
  if (!sigValid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const workers = await getRegisteredWorkers();
  if (!workers.includes(callerAddress.toLowerCase())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scope the pipeline to the caller's OWN in-progress jobs — a job is only
  // IN_PROGRESS after its worker accepted it (job.worker is set), so this is
  // exactly "my work, what stage next." The platform owner sees the full
  // pipeline for monitoring. Prevents any registered worker from enumerating
  // every other client's in-progress jobs + work logs. See PRIVACY_AUDIT.md F3.
  const caller = callerAddress.toLowerCase();
  const owner = await getContractOwner();
  const seesAll = caller === owner;

  const filterStage = req.nextUrl.searchParams.get("stage")?.toLowerCase();

  try {
    const nextJobId = await client.readContract({ address, abi, functionName: "nextJobId" }) as bigint;
    const jobs: any[] = [];

    for (let i = 1n; i < nextJobId; i++) {
      let job: any;
      try {
        job = await client.readContract({ address, abi, functionName: "getJob", args: [i] });
      } catch {
        // Job ID doesn't exist (contract deployed with _startJobId > 1)
        continue;
      }

      // Status 1 = IN_PROGRESS
      if (Number(job.status) !== 1) continue;

      if (!seesAll && (job.worker as string).toLowerCase() !== caller) continue;

      const stage = job.currentStage || "accepted";

      if (filterStage && stage !== filterStage) continue;

      const logs = await client.readContract({ address, abi, functionName: "getWorkLogs", args: [i] }) as readonly { note: string; timestamp: bigint }[];

      jobs.push({
        id: Number(job.id),
        client: job.client,
        worker: job.worker,
        serviceTypeId: Number(job.serviceTypeId),
        description: job.description || job.descriptionCID || "",
        priceUsd: Number(job.priceUsd),
        paymentClawd: job.paymentClawd.toString(),
        createdAt: Number(job.createdAt),
        stage,
        workLogs: logs.map(l => ({ note: l.note, timestamp: Number(l.timestamp) })),
      });
    }

    return Response.json({ jobs, count: jobs.length, stages: STAGES });
  } catch (e) {
    console.error("Pipeline error:", e);
    return Response.json({ error: "Failed to fetch pipeline" }, { status: 500 });
  }
}
