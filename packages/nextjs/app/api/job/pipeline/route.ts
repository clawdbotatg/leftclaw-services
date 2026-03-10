import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : undefined),
});

const STAGES = ["create_plan", "create_user_journey", "prototype", "contract_audit", "contract_fix", "frontend_audit", "frontend_fix", "full_audit", "full_audit_fix", "deploy_contract", "livecontract_fix", "deploy_app", "liveapp_fix", "liveuserjourney", "readme", "ready"] as const;

export async function GET(req: NextRequest) {
  const filterStage = req.nextUrl.searchParams.get("stage")?.toLowerCase();

  try {
    const nextJobId = await client.readContract({ address, abi, functionName: "nextJobId" }) as bigint;
    const jobs: any[] = [];

    for (let i = 1n; i < nextJobId; i++) {
      const job = await client.readContract({ address, abi, functionName: "getJob", args: [i] }) as any;

      // Status 1 = IN_PROGRESS
      if (Number(job.status) !== 1) continue;

      const stage = job.currentStage || "accepted";

      if (filterStage && stage !== filterStage) continue;

      const logs = await client.readContract({ address, abi, functionName: "getWorkLogs", args: [i] }) as readonly { note: string; timestamp: bigint }[];

      jobs.push({
        id: Number(job.id),
        client: job.client,
        worker: job.worker,
        serviceType: Number(job.serviceType),
        description: job.descriptionCID,
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
