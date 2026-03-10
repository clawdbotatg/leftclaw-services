import { NextRequest } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : undefined),
});

export async function GET(_req: NextRequest) {
  try {
    // Scan WorkerAdded/WorkerRemoved events to build current worker set
    // Get contract creation block (approximate — scan last 1M blocks)
    const latestBlock = await client.getBlockNumber();
    const fromBlock = latestBlock > 100_000n ? latestBlock - 100_000n : 0n;

    const addedLogs = await client.getLogs({
      address,
      event: parseAbiItem("event WorkerAdded(address indexed worker)"),
      fromBlock,
      toBlock: "latest",
    });

    const removedLogs = await client.getLogs({
      address,
      event: parseAbiItem("event WorkerRemoved(address indexed worker)"),
      fromBlock,
      toBlock: "latest",
    });

    const removed = new Set(removedLogs.map(l => (l.args as any).worker?.toLowerCase()));
    const workers = [...new Set(addedLogs.map(l => (l.args as any).worker))]
      .filter(w => w && !removed.has(w.toLowerCase()));

    // Check which workers have active jobs
    const nextJobId = await client.readContract({ address, abi, functionName: "nextJobId" }) as bigint;
    const activeJobs: Record<string, number[]> = {};

    for (let i = 1n; i < nextJobId; i++) {
      const job = await client.readContract({ address, abi, functionName: "getJob", args: [i] }) as any;
      if (Number(job.status) === 1 && job.worker !== "0x0000000000000000000000000000000000000000") {
        const w = job.worker.toLowerCase();
        if (!activeJobs[w]) activeJobs[w] = [];
        activeJobs[w].push(Number(job.id));
      }
    }

    const result = workers.map(w => ({
      address: w,
      activeJobs: activeJobs[w.toLowerCase()] || [],
    }));

    return Response.json({ workers: result, count: result.length });
  } catch (e) {
    console.error("Workers error:", e);
    return Response.json({ error: "Failed to fetch workers" }, { status: 500 });
  }
}
