import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300; // 5 min — receipt wait + OpenAI image gen + accept/complete txs
import OpenAI, { toFile } from "openai";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import { getKV } from "~~/lib/kv";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";
const { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI } = deployedContracts[8453].LeftClawServicesV2;
const PFP_SERVICE_TYPE_ID = 3;

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

async function closeOnChainJob(
  jobId: number | bigint,
  rpcUrl: string,
): Promise<{ acceptTx?: string; completeTx?: string; error?: string }> {
  const key = process.env.SANITIZER_PRIVATE_KEY;
  if (!key) return { error: "SANITIZER_PRIVATE_KEY not configured" };

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  const id = BigInt(jobId);

  // Read current state — skip if already completed or not a PFP job
  const job = (await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getJob",
    args: [id],
  })) as any;

  if (Number(job.serviceTypeId) !== PFP_SERVICE_TYPE_ID) {
    return { error: `job ${id} is not a PFP job` };
  }
  const status = Number(job.status);
  // 0 = OPEN, 1 = IN_PROGRESS, 2 = COMPLETED, others = terminal
  if (status >= 2) return {}; // already closed — nothing to do

  const resultURL = `${APP_URL}/api/pfp/result/${id.toString()}`;
  let acceptTx: string | undefined;

  if (status === 0) {
    acceptTx = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "acceptJob",
      args: [id],
      chain: base,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: acceptTx as `0x${string}`, retryCount: 20, retryDelay: 3_000 });
  } else if (job.worker && job.worker.toLowerCase() !== account.address.toLowerCase()) {
    return { error: `job ${id} in progress by another worker` };
  }

  const completeTx = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "completeJob",
    args: [id, resultURL],
    chain: base,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: completeTx as `0x${string}`, retryCount: 20, retryDelay: 3_000 });

  return { acceptTx, completeTx };
}

export async function POST(req: NextRequest) {
  let claimedDedupKey: string | null = null;
  try {
    const { prompt, txHash, address: requesterAddress, jobId } = await req.json();

    if (!prompt || prompt.trim().length < 3)
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
      return NextResponse.json({ error: "Valid txHash required" }, { status: 400 });
    if (!requesterAddress || !/^0x[0-9a-fA-F]{40}$/.test(requesterAddress))
      return NextResponse.json({ error: "Valid address required" }, { status: 400 });

    const rpcUrl = process.env.BASE_RPC_URL;
    if (!rpcUrl) return NextResponse.json({ error: "RPC not configured" }, { status: 500 });

    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

    // Wait up to 90s for the receipt
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 90_000,
      retryCount: 30,
      retryDelay: 3_000,
    });

    if (!receipt || receipt.status !== "success")
      return NextResponse.json({ error: "Transaction failed or not found" }, { status: 400 });

    // The contract guarantees payment + job creation atomically.
    // If the tx succeeded, the job was created. No event parsing needed.
    // The sender must match the requester address.
    const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    if (tx.from.toLowerCase() !== requesterAddress.toLowerCase())
      return NextResponse.json({ error: "Transaction sender does not match your address" }, { status: 403 });

    // Dedup — atomic SET NX to prevent race conditions
    const kv = getKV();
    const dedupKey = `pfp_tx_used:${txHash.toLowerCase()}`;
    if (kv) {
      const claimed = await kv.set(dedupKey, "1", { ex: 86400 * 365, nx: true });
      if (!claimed) return NextResponse.json({ error: "This transaction has already been used to generate a PFP." }, { status: 400 });
      claimedDedupKey = dedupKey;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });

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

    const imageData = result.data?.[0];
    if (!imageData?.b64_json) {
      if (kv && claimedDedupKey) await kv.del(claimedDedupKey);
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    // For on-chain payments (usdc/eth), close the job on-chain so it doesn't
    // linger as OPEN. Errors here are logged but not user-facing — the sweeper
    // is the safety net.
    let jobClosed: { acceptTx?: string; completeTx?: string; error?: string } | undefined;
    if (typeof jobId === "number" && Number.isFinite(jobId) && jobId > 0) {
      try {
        if (kv) await kv.set(`pfp-result:${jobId}`, imageData.b64_json);
        jobClosed = await closeOnChainJob(jobId, rpcUrl);
        if (jobClosed.error) console.error(`[pfp] closeOnChainJob soft-fail job=${jobId}:`, jobClosed.error);
      } catch (e: any) {
        console.error(`[pfp] closeOnChainJob threw job=${jobId}:`, e?.message || e);
        jobClosed = { error: e?.message?.slice(0, 200) };
      }
    }

    return NextResponse.json({
      image: `data:image/png;base64,${imageData.b64_json}`,
      prompt: prompt.trim(),
      txHash,
      jobId,
      jobClosed,
      message: "🦞 Your custom CLAWD PFP is ready!",
    });
  } catch (e: any) {
    console.error("PFP generate-payment error:", e);
    if (claimedDedupKey) {
      try { const kvInst = getKV(); if (kvInst) await kvInst.del(claimedDedupKey); } catch {}
    }
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
