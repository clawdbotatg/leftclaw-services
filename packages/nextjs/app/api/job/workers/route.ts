import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ? process.env.BASE_RPC_URL.trim() : undefined),
});

export async function GET() {
  try {
    // Get workers directly from the contract array
    const workerAddresses = (await client.readContract({
      address,
      abi,
      functionName: "getWorkers",
    })) as `0x${string}`[];

    // Check which workers have active jobs
    const nextJobId = (await client.readContract({ address, abi, functionName: "nextJobId" })) as bigint;
    const activeJobs: Record<string, number[]> = {};

    for (let i = 1n; i < nextJobId; i++) {
      try {
        const job = (await client.readContract({ address, abi, functionName: "getJob", args: [i] })) as any;
        if (Number(job.status) === 1 && job.worker !== "0x0000000000000000000000000000000000000000") {
          const w = job.worker.toLowerCase();
          if (!activeJobs[w]) activeJobs[w] = [];
          activeJobs[w].push(Number(job.id));
        }
      } catch {
        // Job may not exist, skip
      }
    }

    // Fetch ETH balances in parallel
    const balances = await Promise.all(
      workerAddresses.map(w =>
        client.getBalance({ address: w }).catch(() => null),
      ),
    );

    const result = workerAddresses.map((w, i) => ({
      address: w,
      activeJobs: activeJobs[w.toLowerCase()] || [],
      ethBalance: balances[i] !== null ? balances[i]!.toString() : null,
    }));

    return Response.json({ workers: result, count: result.length });
  } catch (e) {
    console.error("Workers error:", e);
    return Response.json({ error: "Failed to fetch workers" }, { status: 500 });
  }
}
