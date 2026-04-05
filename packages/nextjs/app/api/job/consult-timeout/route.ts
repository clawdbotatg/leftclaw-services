/**
 * Cron-able endpoint to auto-timeout stale consultation jobs.
 *
 * - OPEN consultations older than 24h → COMPLETED
 * - IN_PROGRESS consultations older than 48h → COMPLETED
 *
 * POST /api/job/consult-timeout
 */

import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { execSync } from "child_process";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

const CONSULTATION_TYPE_IDS = [1, 2]; // Quick Consultation, Deep Consultation
const OPEN_TIMEOUT_HOURS = 24;
const IN_PROGRESS_TIMEOUT_HOURS = 48;
const TIMEOUT_RESULT_URL = "https://leftclaw.services/consult-timeout";

// Simple auth key — set CONSULT_TIMEOUT_SECRET env var to protect this endpoint
const AUTH_SECRET = process.env.CONSULT_TIMEOUT_SECRET;

function getViemClient() {
  return createPublicClient({
    chain: base,
    transport: http(
      process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : "https://mainnet.base.org",
    ),
  });
}

function getDeployerWalletClient() {
  try {
    const password = execSync('security find-generic-password -s "clawd-deployer-local" -a "clawd" -w 2>/dev/null').toString().trim();
    const privateKeyHex = execSync(
      `cast wallet decrypt-keystore clawd-deployer-local --unsafe-password "${password}"`,
      { env: { ...process.env, PATH: `${process.env.PATH}:/Users/clawd/.foundry/bin` } },
    ).toString().trim();
    const match = privateKeyHex.match(/(0x[0-9a-fA-F]{64})/);
    if (!match) return null;
    const account = privateKeyToAccount(match[1] as `0x${string}`);
    return createWalletClient({
      account,
      chain: base,
      transport: http(
        process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
          ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
          : "https://mainnet.base.org",
      ),
    });
  } catch (e) {
    console.error("[consult-timeout] Failed to create deployer wallet client:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Optional auth
  if (AUTH_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${AUTH_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const viemClient = getViemClient();
  const walletClient = getDeployerWalletClient();
  if (!walletClient) {
    return Response.json({ error: "Deployer wallet not available" }, { status: 500 });
  }

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

        // Check if consultation has been going for > 48h
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
