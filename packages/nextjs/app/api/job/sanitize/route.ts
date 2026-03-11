import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { checkSanitization, setSanitization } from "~~/lib/sanitize";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const transport = http(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  : undefined);

const client = createPublicClient({ chain: base, transport });

export async function POST(req: NextRequest) {
  try {
    const { jobId, description, force, cvAutoPass } = await req.json();

    if (!jobId || !description) {
      return Response.json({ error: "jobId and description required" }, { status: 400 });
    }

    // CV consults auto-pass sanitization — off-chain payment, no gate needed
    if (cvAutoPass && String(jobId).startsWith("cv-")) {
      const result = {
        jobId: String(jobId),
        safe: true,
        reason: "CV consultation — auto-passed",
        checkedAt: new Date().toISOString(),
      };
      await setSanitization(result);
      return Response.json({ ...result, onChain: false });
    }

    // Check on-chain flag first
    const job = await client.readContract({ address, abi, functionName: "getJob", args: [BigInt(jobId)] }) as any;
    if (job.sanitized && !force) {
      return Response.json({ jobId: String(jobId), safe: true, onChain: true });
    }

    // Run Opus analysis
    const result = await checkSanitization(String(jobId), description);

    // If safe, mark on-chain automatically
    if (result.safe && process.env.SANITIZER_PRIVATE_KEY) {
      try {
        const account = privateKeyToAccount(process.env.SANITIZER_PRIVATE_KEY as `0x${string}`);
        const wallet = createWalletClient({ account, chain: base, transport });
        const hash = await wallet.writeContract({
          address, abi,
          functionName: "markSanitized",
          args: [BigInt(jobId)],
        });
        return Response.json({ ...result, onChain: true, txHash: hash });
      } catch (txErr: any) {
        console.error("markSanitized tx failed:", txErr.message);
        return Response.json({ ...result, onChain: false, txError: txErr.message });
      }
    }

    return Response.json({ ...result, onChain: false });
  } catch (e) {
    console.error("Sanitize route error:", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ error: "jobId required" }, { status: 400 });
  }

  // CV jobs are off-chain — check KV store instead of on-chain
  if (jobId.startsWith("cv-")) {
    const { getSanitization, deleteSanitization } = await import("~~/lib/sanitize");
    const result = await getSanitization(jobId);
    if (result) {
      // If cached result is a stale error (fail-open artifacts from old code), clear it
      if (!result.safe && result.reason && /error|fail open|skipped|failed/i.test(result.reason)) {
        await deleteSanitization(jobId);
        return Response.json({ error: "Pending recheck", safe: null, pending: true }, { status: 404 });
      }
      return Response.json({ jobId, safe: result.safe, reason: result.reason, onChain: false });
    }
    return Response.json({ error: "CV job not found", safe: null, pending: true }, { status: 404 });
  }

  try {
    const job = await client.readContract({ address, abi, functionName: "getJob", args: [BigInt(jobId)] }) as any;
    // If not yet sanitized on-chain, also check KV for error artifacts and clean them
    if (!job.sanitized) {
      const { getSanitization, deleteSanitization } = await import("~~/lib/sanitize");
      const cached = await getSanitization(jobId);
      if (cached && !cached.safe && cached.reason && /error|fail open|skipped|failed/i.test(cached.reason)) {
        await deleteSanitization(jobId);
      }
      // Return pending state — frontend should poll/retry
      return Response.json({ jobId, safe: null, pending: true, onChain: true });
    }
    return Response.json({ jobId, safe: true, onChain: true });
  } catch {
    return Response.json({ error: "Job not found", safe: null, pending: true }, { status: 404 });
  }
}
