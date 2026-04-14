/**
 * Cron-able endpoint that auto-completes OPEN PFP jobs (serviceTypeId 3).
 *
 * The instant-PFP path lives in /api/pfp and /api/pfp/generate-cv — those never
 * touch the contract. But UnifiedPaymentFlow and direct `postJobWithCV(3, …)` callers
 * create real on-chain PFP jobs. There's no human worker watching for PFP, so those
 * jobs sit OPEN forever. This sweeper generates the image, stores it, and calls
 * acceptJob + completeJob as the sanitizer worker.
 *
 * POST/GET /api/job/pfp-sweep       — sweep all OPEN PFP jobs
 * POST/GET /api/job/pfp-sweep?jobId=53  — process a single job (useful for one-offs)
 */

import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import OpenAI, { toFile } from "openai";
import deployedContracts from "~~/contracts/deployedContracts";
import { getKV } from "~~/lib/kv";

export const maxDuration = 300;

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;
const PFP_SERVICE_TYPE_ID = 3;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw.services";
const AUTH_SECRET = process.env.CONSULT_TIMEOUT_SECRET; // reuse existing sweeper auth

let baseImageCache: Buffer | null = null;

async function getBaseImage(): Promise<Buffer> {
  if (baseImageCache) return baseImageCache;
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    baseImageCache = readFileSync(join(process.cwd(), "public", "clawd-base.jpg"));
    return baseImageCache;
  } catch {
    const res = await fetch(`${APP_URL}/clawd-base.jpg`);
    if (!res.ok) throw new Error("Failed to fetch base image");
    baseImageCache = Buffer.from(await res.arrayBuffer());
    return baseImageCache;
  }
}

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

async function generatePfp(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const baseImageBuffer = await getBaseImage();
  const openai = new OpenAI({ apiKey });

  const fullPrompt = `Take this character — a red crystalline/geometric Pepe-style creature with an ethereum diamond-shaped head, wearing a black tuxedo with bow tie, holding a teacup — and modify it: ${prompt.trim()}. Keep the same art style (clean anime/cartoon illustration, white/light background, bold outlines). Keep the character recognizable but apply the requested changes. Square format, profile picture crop.`;

  const imageFile = await toFile(baseImageBuffer, "clawd-base.jpg", { type: "image/jpeg" });

  const result = await openai.images.edit({
    model: "gpt-image-1.5",
    image: imageFile,
    prompt: fullPrompt,
    n: 1,
    size: "1024x1024",
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned empty result");
  return b64;
}

async function processJob(
  jobId: bigint,
  clients: ReturnType<typeof getClients>,
): Promise<{ jobId: string; status: string; acceptTx?: string; completeTx?: string; error?: string }> {
  const { publicClient, walletClient, account } = clients;

  const job = (await publicClient.readContract({
    address,
    abi,
    functionName: "getJob",
    args: [jobId],
  })) as any;

  if (Number(job.serviceTypeId) !== PFP_SERVICE_TYPE_ID) {
    return { jobId: jobId.toString(), status: "skipped: not a PFP job" };
  }
  if (Number(job.status) !== 0 && Number(job.status) !== 1) {
    return { jobId: jobId.toString(), status: `skipped: status ${job.status}` };
  }

  const prompt = (job.description as string)?.trim();
  if (!prompt || prompt.length < 3) {
    return { jobId: jobId.toString(), status: "skipped: empty prompt" };
  }

  // Generate image and store in KV before any on-chain tx, so a completed job
  // always has a retrievable result.
  const kv = getKV();
  if (!kv) return { jobId: jobId.toString(), status: "error: KV not configured" };

  let b64: string;
  try {
    b64 = await generatePfp(prompt);
  } catch (e: any) {
    return { jobId: jobId.toString(), status: "generation failed", error: e.message?.slice(0, 200) };
  }
  await kv.set(`pfp-result:${jobId.toString()}`, b64);

  const resultURL = `${APP_URL}/api/pfp/result/${jobId.toString()}`;
  let acceptTx: string | undefined;
  let completeTx: string | undefined;

  try {
    // Accept if still OPEN. If already IN_PROGRESS (accepted by a different worker), skip accept.
    if (Number(job.status) === 0) {
      acceptTx = await walletClient.writeContract({
        address,
        abi,
        functionName: "acceptJob",
        args: [jobId],
        chain: base,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: acceptTx as `0x${string}`, retryCount: 20, retryDelay: 3_000 });
    } else if (job.worker && job.worker.toLowerCase() !== account.address.toLowerCase()) {
      return { jobId: jobId.toString(), status: "skipped: in progress by another worker" };
    }

    completeTx = await walletClient.writeContract({
      address,
      abi,
      functionName: "completeJob",
      args: [jobId, resultURL],
      chain: base,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: completeTx as `0x${string}`, retryCount: 20, retryDelay: 3_000 });

    console.log(`[pfp-sweep] Completed job ${jobId} accept=${acceptTx ?? "-"} complete=${completeTx}`);
    return {
      jobId: jobId.toString(),
      status: "completed",
      acceptTx,
      completeTx,
    };
  } catch (e: any) {
    console.error(`[pfp-sweep] Job ${jobId} tx failed:`, e);
    return { jobId: jobId.toString(), status: "tx failed", error: e.message?.slice(0, 300), acceptTx };
  }
}

export async function POST(req: NextRequest) {
  if (AUTH_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${AUTH_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let clients;
  try {
    clients = getClients();
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }

  const singleJobId = req.nextUrl.searchParams.get("jobId");

  try {
    if (singleJobId) {
      const result = await processJob(BigInt(singleJobId), clients);
      return Response.json({ ok: true, results: [result] });
    }

    const openJobIds = (await clients.publicClient.readContract({
      address,
      abi,
      functionName: "getJobsByStatus",
      args: [0],
    })) as bigint[];

    const results = [];
    for (const jobId of openJobIds) {
      try {
        const job = (await clients.publicClient.readContract({
          address,
          abi,
          functionName: "getJob",
          args: [jobId],
        })) as any;
        if (Number(job.serviceTypeId) !== PFP_SERVICE_TYPE_ID) continue;
      } catch {
        continue;
      }
      results.push(await processJob(jobId, clients));
    }

    return Response.json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    console.error("[pfp-sweep] Fatal:", e);
    return Response.json({ error: e.message?.slice(0, 300) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
