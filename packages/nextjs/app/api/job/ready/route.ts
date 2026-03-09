import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { getSanitization } from "~~/lib/sanitize";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : undefined),
});

export async function GET(req: NextRequest) {
  try {
    const nextJobId = await client.readContract({ address, abi, functionName: "nextJobId" }) as bigint;

    const ready: any[] = [];

    for (let i = 1n; i < nextJobId; i++) {
      const job = await client.readContract({ address, abi, functionName: "getJob", args: [i] }) as any;

      // Status 0 = OPEN
      if (Number(job.status) !== 0) continue;

      const sanitization = await getSanitization(String(i));
      if (!sanitization || !sanitization.safe) continue;

      ready.push({
        id: Number(job.id),
        client: job.client,
        serviceType: Number(job.serviceType),
        description: job.descriptionCID,
        priceUsd: Number(job.priceUsd),
        paymentClawd: job.paymentClawd.toString(),
        createdAt: Number(job.createdAt),
        sanitizedAt: sanitization.checkedAt,
      });
    }

    return Response.json({ jobs: ready, count: ready.length });
  } catch (e) {
    console.error("Ready jobs error:", e);
    return Response.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}
