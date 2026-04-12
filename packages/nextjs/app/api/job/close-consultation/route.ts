/**
 * Backend endpoint to close a consultation job on-chain.
 *
 * Uses the sanitizer wallet (which is a registered worker) to call
 * completeJob() — so users never need to sign a tx themselves.
 *
 * POST /api/job/close-consultation
 * Body: { jobId: number | string, resultCID: string, address?: string }
 */

import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import { getKV } from "~~/lib/kv";

const { address: contractAddress, abi } = deployedContracts[8453].LeftClawServicesV2;

function getClients() {
  const key = process.env.SANITIZER_PRIVATE_KEY;
  if (!key) throw new Error("SANITIZER_PRIVATE_KEY not configured");

  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) throw new Error("BASE_RPC_URL not configured");

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  return { account, publicClient, walletClient };
}

export async function POST(req: NextRequest) {
  try {
    const { jobId, resultCID, address } = await req.json();

    if (!jobId || !resultCID) {
      return Response.json({ ok: false, error: "jobId and resultCID required" }, { status: 400 });
    }

    const numericJobId = BigInt(jobId);
    const { publicClient, walletClient, account } = getClients();

    // Verify the job is an active consultation before sending a tx
    const job = (await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getJob",
      args: [numericJobId],
    })) as any;

    const serviceTypeId = Number(job.serviceTypeId);
    if (serviceTypeId !== 1 && serviceTypeId !== 2) {
      return Response.json({ ok: false, error: "Not a consultation job" }, { status: 400 });
    }

    // Status 1 = IN_PROGRESS
    if (Number(job.status) !== 1) {
      // Already completed or in another state — just update Redis and return success
      await markDoneInRedis(address, jobId);
      return Response.json({ ok: true, alreadyClosed: true });
    }

    // Call completeJob as the sanitizer worker
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi,
      functionName: "completeJob",
      args: [numericJobId, resultCID],
      chain: base,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash, retryCount: 20, retryDelay: 3_000 });

    // Mark done in Redis for UI tracking
    await markDoneInRedis(address, jobId);

    console.log(`[close-consultation] Closed job ${jobId}, tx: ${hash}`);
    return Response.json({ ok: true, tx: hash });
  } catch (e: any) {
    console.error("[close-consultation] Error:", e);
    return Response.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
  }
}

async function markDoneInRedis(address: string | undefined, jobId: string | number) {
  if (!address) return;
  const kv = getKV();
  if (!kv) return;
  try {
    await kv.sadd(`consult-done:${address.toLowerCase()}`, String(jobId));
  } catch {}
}
