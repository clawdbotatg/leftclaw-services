/**
 * Cron-able endpoint that delivers completion webhooks for x402 jobs.
 *
 * Agents can pass a callbackUrl when creating a job (e.g. POST /api/audit).
 * This sweep reads each pending job's on-chain status and, once it reaches a
 * terminal state, POSTs {jobId, status, reportUrl, statusUrl} to the callback.
 *
 * GET/POST /api/job/webhook-sweep
 */
import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import {
  MAX_WEBHOOK_ATTEMPTS,
  bumpWebhookAttempts,
  clearJobWebhook,
  getJobWebhook,
  listPendingWebhookJobIds,
} from "~~/lib/jobWebhooks";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

// Same slugs the onedollaraudit.com JSON job API uses — keep the two APIs consistent.
const STATUS_SLUGS: Record<number, string> = {
  0: "pending",
  1: "in_progress",
  2: "complete",
  3: "declined",
  4: "cancelled",
  5: "reassigned",
};
const TERMINAL_STATUSES = new Set([2, 3, 4]);

const AUTH_SECRET = process.env.CRON_SECRET;

export async function POST(req: NextRequest) {
  if (AUTH_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${AUTH_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) {
    return Response.json({ error: "BASE_RPC_URL not configured" }, { status: 500 });
  }
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });

  const pending = await listPendingWebhookJobIds();
  const results: Array<{ jobId: string; action: string; detail?: string }> = [];

  for (const jobId of pending) {
    try {
      const hook = await getJobWebhook(jobId);
      if (!hook) {
        // Record expired (7d TTL) — drop from the pending set.
        await clearJobWebhook(jobId);
        results.push({ jobId, action: "expired" });
        continue;
      }

      let job: any;
      try {
        job = await publicClient.readContract({ address, abi, functionName: "getJob", args: [BigInt(jobId)] });
      } catch {
        // getJob reverts (array panic) for ids the contract hasn't assigned yet — keep waiting.
        results.push({ jobId, action: "not_indexed_yet" });
        continue;
      }

      const statusNum = Number(job.status);
      if (!TERMINAL_STATUSES.has(statusNum)) {
        results.push({ jobId, action: "still_running", detail: STATUS_SLUGS[statusNum] });
        continue;
      }

      const payload = {
        jobId: Number(jobId),
        status: STATUS_SLUGS[statusNum],
        reportUrl: job.resultCID || null,
        statusUrl: `https://onedollaraudit.com/api/jobs/${jobId}`,
      };

      try {
        const res = await fetch(hook.callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`callback returned ${res.status}`);
        await clearJobWebhook(jobId);
        results.push({ jobId, action: "delivered", detail: payload.status });
      } catch (e: any) {
        if (hook.attempts + 1 >= MAX_WEBHOOK_ATTEMPTS) {
          await clearJobWebhook(jobId);
          results.push({ jobId, action: "gave_up", detail: e.message?.slice(0, 200) });
        } else {
          await bumpWebhookAttempts(hook);
          results.push({ jobId, action: "retry_later", detail: e.message?.slice(0, 200) });
        }
      }
    } catch (e: any) {
      results.push({ jobId, action: "error", detail: e.message?.slice(0, 200) });
    }
  }

  return Response.json({ ok: true, pending: pending.length, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
