import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { checkSanitization, getSanitization, setSanitization } from "~~/lib/sanitize";
import { getConsultPrompt } from "~~/lib/consultPrompt";
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

// Never echo the sanitizer's content-derived reason/tldr to callers — for a flagged
// job it paraphrases the (possibly private, off-chain) prompt, and these endpoints are
// unauthenticated + enumerable by jobId. Return a generic label instead; the full
// reason/tldr stay in KV for the owner/worker admin tools. See PRIVACY_AUDIT.md F5.
function publicReason(safe: boolean | null | undefined): string {
  return safe === false ? "Job flagged for manual review" : "Passed security review";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, cvAutoPass } = body;
    let description: string | undefined = body.description;

    if (!jobId) {
      return Response.json({ error: "jobId required" }, { status: 400 });
    }

    // CV consults auto-pass sanitization — off-chain payment, no gate needed
    if (cvAutoPass && String(jobId).startsWith("cv-")) {
      if (!description) {
        return Response.json({ error: "description required for cvAutoPass" }, { status: 400 });
      }
      const result = {
        jobId: String(jobId),
        safe: true,
        reason: "CV consultation — auto-passed",
        checkedAt: new Date().toISOString(),
      };
      await setSanitization(result);
      return Response.json({ ...result, onChain: false });
    }

    // If no description provided, look it up. Supports recovery from stuck
    // "Reviewing your request..." states: clients can retrigger with just
    // {jobId} and the server resolves the prompt itself.
    if (!description) {
      // Off-chain consult prompt store (svc 1, 2 posted via current flow)
      const offChain = await getConsultPrompt(jobId);
      if (offChain) {
        description = offChain;
      } else if (!String(jobId).startsWith("cv-")) {
        // Fallback to on-chain (build/audit/etc and pre-PR-#41 consults)
        try {
          const job = (await viemClient.readContract({
            address: contractAddress,
            abi,
            functionName: "getJob",
            args: [BigInt(jobId)],
          })) as any;
          description = job.description || undefined;
        } catch {}
      }
    }

    if (!description) {
      return Response.json(
        { error: "description not provided and could not be resolved from KV or chain" },
        { status: 400 },
      );
    }

    const result = await checkSanitization(String(jobId), description);
    return Response.json({
      jobId: result.jobId,
      safe: result.safe,
      reason: publicReason(result.safe),
      checkedAt: result.checkedAt,
      onChain: false,
    });
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
      return Response.json({ jobId, safe: result.safe, reason: publicReason(result.safe), onChain: false });
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
      return Response.json({ jobId, safe: cached.safe, reason: publicReason(cached.safe), onChain: false });
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
