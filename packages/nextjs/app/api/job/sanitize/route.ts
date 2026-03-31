import { NextRequest } from "next/server";
import { checkSanitization, getSanitization, setSanitization } from "~~/lib/sanitize";

export async function POST(req: NextRequest) {
  try {
    const { jobId, description, cvAutoPass } = await req.json();

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

    // Note: job.sanitized doesn't exist on-chain yet — markSanitized is not in the deployed ABI.
    // Skip on-chain flag check; rely on Redis/KV for sanitization state.

    // Run Opus analysis
    const result = await checkSanitization(String(jobId), description);

    // Placeholder: markSanitized doesn't exist in deployed contract ABI yet.
    // When added, uncomment to write on-chain flag.
    // if (result.safe && process.env.SANITIZER_PRIVATE_KEY) {
    //   try {
    //     const account = privateKeyToAccount(process.env.SANITIZER_PRIVATE_KEY as `0x${string}`);
    //     const wallet = createWalletClient({ account, chain: base, transport });
    //     const hash = await wallet.writeContract({
    //       address, abi, functionName: "markSanitized", args: [BigInt(jobId)],
    //     });
    //     return Response.json({ ...result, onChain: true, txHash: hash });
    //   } catch (txErr: any) {
    //     console.error("markSanitized tx failed:", txErr.message);
    //   }
    // }

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
    // Note: job.sanitized doesn't exist on-chain yet — check Redis/KV instead
    const { getSanitization, deleteSanitization } = await import("~~/lib/sanitize");
    const cached = await getSanitization(jobId);
    if (cached) {
      // Clean stale error artifacts
      if (!cached.safe && cached.reason && /error|fail open|skipped|failed/i.test(cached.reason)) {
        await deleteSanitization(jobId);
        return Response.json({ jobId, safe: null, pending: true, onChain: false });
      }
      return Response.json({ jobId, safe: cached.safe, reason: cached.reason, onChain: false });
    }
    // No KV entry — pending state
    return Response.json({ jobId, safe: null, pending: true, onChain: false });
  } catch {
    return Response.json({ error: "Job not found", safe: null, pending: true }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const secret = process.env.SANITIZER_PRIVATE_KEY;
    if (!secret) {
      return Response.json({ error: "Admin override not configured" }, { status: 500 });
    }

    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!auth || auth !== secret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await req.json();
    if (!jobId) {
      return Response.json({ error: "jobId required" }, { status: 400 });
    }

    const existing = await getSanitization(String(jobId));
    const result = {
      jobId: String(jobId),
      safe: true,
      reason: "Admin override" + (existing?.reason ? ` (was: ${existing.reason})` : ""),
      checkedAt: new Date().toISOString(),
      tldr: existing?.tldr,
    };
    await setSanitization(result);

    return Response.json(result);
  } catch (e) {
    console.error("Sanitize PATCH error:", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
