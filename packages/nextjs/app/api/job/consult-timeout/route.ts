/**
 * Cron-able endpoint to auto-timeout stale consultation jobs.
 *
 * - OPEN consultations older than 24h → COMPLETED
 * - IN_PROGRESS consultations older than 24h → COMPLETED
 *
 * POST /api/job/consult-timeout
 */

import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

const CONSULTATION_TYPE_IDS = [1, 2]; // Quick Consultation, Deep Consultation
const OPEN_TIMEOUT_HOURS = 24;
const IN_PROGRESS_TIMEOUT_HOURS = 24;
const TIMEOUT_RESULT_URL = "https://leftclaw.services/consult-timeout";

// Simple auth key — set CONSULT_TIMEOUT_SECRET env var to protect this endpoint
const AUTH_SECRET = process.env.CONSULT_TIMEOUT_SECRET;

function getClients() {
  const key = process.env.SANITIZER_PRIVATE_KEY;
  if (!key) return null;

  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) return null;

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  return { account, publicClient, walletClient };
}

export async function POST(req: NextRequest) {
  // Optional auth
  if (AUTH_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${AUTH_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const clients = getClients();
  if (!clients) {
    return Response.json({ error: "SANITIZER_PRIVATE_KEY or BASE_RPC_URL not configured" }, { status: 500 });
  }
  const { publicClient: viemClient, walletClient, account } = clients;

  const now = Math.floor(Date.now() / 1000);
  const results: Array<{ jobId: string; action: string; status: string; tx?: string; error?: string }> = [];

  try {
    // Fetch OPEN jobs (status 0)
    const openJobIds = (await viemClient.readContract({
      address,
      abi,
      functionName: "getJobsByStatus",
      args: [0],
    })) as bigint[];

    // Fetch IN_PROGRESS jobs (status 1)
    const inProgressJobIds = (await viemClient.readContract({
      address,
      abi,
      functionName: "getJobsByStatus",
      args: [1],
    })) as bigint[];

    // Process OPEN consultation jobs
    for (const jobId of openJobIds) {
      try {
        const job = (await viemClient.readContract({
          address,
          abi,
          functionName: "getJob",
          args: [jobId],
        })) as any;

        const serviceTypeId = Number(job.serviceTypeId);
        if (!CONSULTATION_TYPE_IDS.includes(serviceTypeId)) continue;

        const createdAt = Number(job.createdAt);
        const ageHours = (now - createdAt) / 3600;

        if (ageHours > OPEN_TIMEOUT_HOURS) {
          try {
            const hash = await walletClient.writeContract({
              address,
              abi,
              functionName: "completeJob",
              args: [jobId, TIMEOUT_RESULT_URL],
              chain: base,
              account,
            });
            results.push({
              jobId: jobId.toString(),
              action: "complete_timeout",
              status: `OPEN → COMPLETED (age: ${ageHours.toFixed(1)}h)`,
              tx: hash,
            });
            console.log(`[consult-timeout] Completed OPEN job ${jobId} (age: ${ageHours.toFixed(1)}h), tx: ${hash}`);
          } catch (e: any) {
            results.push({
              jobId: jobId.toString(),
              action: "complete_timeout",
              status: "failed",
              error: e.message?.slice(0, 200),
            });
          }
        }
      } catch (e: any) {
        results.push({
          jobId: jobId.toString(),
          action: "fetch_job",
          status: "failed",
          error: e.message?.slice(0, 200),
        });
      }
    }

    // Process IN_PROGRESS consultation jobs
    for (const jobId of inProgressJobIds) {
      try {
        const job = (await viemClient.readContract({
          address,
          abi,
          functionName: "getJob",
          args: [jobId],
        })) as any;

        const serviceTypeId = Number(job.serviceTypeId);
        if (!CONSULTATION_TYPE_IDS.includes(serviceTypeId)) continue;

        const createdAt = Number(job.createdAt);
        const ageHours = (now - createdAt) / 3600;

        let shouldComplete = false;
        let reason = "";

        // Check if consultation has been going for > 24h
        if (ageHours > IN_PROGRESS_TIMEOUT_HOURS) {
          shouldComplete = true;
          reason = `age: ${ageHours.toFixed(1)}h > ${IN_PROGRESS_TIMEOUT_HOURS}h`;
        }

        // Check work logs for completion signals
        if (!shouldComplete) {
          try {
            const workLogs = (await viemClient.readContract({
              address,
              abi,
              functionName: "getWorkLogs",
              args: [jobId],
            })) as any[];

            if (workLogs.length > 0) {
              const lastLog = workLogs[workLogs.length - 1];
              const lastNote = (lastLog.note || "").toLowerCase();
              const completionKeywords = [
                "consultation complete",
                "consultation done",
                "consultation finished",
                "consult complete",
                "session ended",
                "session complete",
                "thank you for the consultation",
                "consultation concluded",
              ];
              if (completionKeywords.some(kw => lastNote.includes(kw))) {
                shouldComplete = true;
                reason = `work log indicates completion: "${lastLog.note.slice(0, 100)}"`;
              }
            }
          } catch {
            // Work logs not available — skip this check
          }
        }

        if (shouldComplete) {
          try {
            const hash = await walletClient.writeContract({
              address,
              abi,
              functionName: "completeJob",
              args: [jobId, TIMEOUT_RESULT_URL],
              chain: base,
              account,
            });
            results.push({
              jobId: jobId.toString(),
              action: "complete_timeout",
              status: `IN_PROGRESS → COMPLETED (${reason})`,
              tx: hash,
            });
            console.log(`[consult-timeout] Completed IN_PROGRESS job ${jobId} (${reason}), tx: ${hash}`);
          } catch (e: any) {
            results.push({
              jobId: jobId.toString(),
              action: "complete_timeout",
              status: "failed",
              error: e.message?.slice(0, 200),
            });
          }
        }
      } catch (e: any) {
        results.push({
          jobId: jobId.toString(),
          action: "fetch_job",
          status: "failed",
          error: e.message?.slice(0, 200),
        });
      }
    }

    return Response.json({
      ok: true,
      processed: results.length,
      results,
      openJobsChecked: openJobIds.length,
      inProgressJobsChecked: inProgressJobIds.length,
    });
  } catch (e: any) {
    console.error("[consult-timeout] Fatal error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// Also support GET for easy testing/cron
export async function GET(req: NextRequest) {
  return POST(req);
}
