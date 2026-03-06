import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";
const RPC_URL = process.env.BASE_RPC_URL || "https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839";

// Minimum CLAWD burn in wei ($0.25 floor to allow price fluctuation)
const MIN_CLAWD_BURN = BigInt("50000") * BigInt(10) ** BigInt(18); // 50K CLAWD minimum

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

const client = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

// Track used tx hashes to prevent replay
const usedTxHashes = new Set<string>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, txHash } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json({ error: "prompt required (minimum 3 characters)" }, { status: 400 });
    }
    if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x")) {
      return NextResponse.json({ error: "txHash required — burn CLAWD first" }, { status: 400 });
    }

    // Prevent replay
    if (usedTxHashes.has(txHash.toLowerCase())) {
      return NextResponse.json({ error: "This transaction has already been used" }, { status: 400 });
    }

    // Verify the burn tx on-chain
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt || receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction failed or not found" }, { status: 400 });
    }

    // Check for ERC20 Transfer to dead address
    const burnLog = receipt.logs.find(log => {
      if (log.address.toLowerCase() !== CLAWD_ADDRESS.toLowerCase()) return false;
      if (log.topics.length < 3) return false;
      // topics[2] is the 'to' address
      const toAddr = "0x" + log.topics[2]!.slice(26);
      return toAddr.toLowerCase() === DEAD_ADDRESS.toLowerCase();
    });

    if (!burnLog) {
      return NextResponse.json({ error: "No CLAWD burn found in transaction" }, { status: 400 });
    }

    // Decode amount from data field
    const burnAmount = BigInt(burnLog.data);
    if (burnAmount < MIN_CLAWD_BURN) {
      return NextResponse.json(
        { error: `Burn amount too low. Minimum: ${(MIN_CLAWD_BURN / BigInt(10) ** BigInt(18)).toString()} CLAWD` },
        { status: 400 },
      );
    }

    // Mark tx as used
    usedTxHashes.add(txHash.toLowerCase());

    // Generate the PFP
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

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
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    return NextResponse.json({
      image: `data:image/png;base64,${imageData.b64_json}`,
      prompt: prompt.trim(),
      burnAmount: burnAmount.toString(),
      txHash,
      message: "🦞 Your custom CLAWD PFP is ready!",
    });
  } catch (e: any) {
    console.error("PFP generate error:", e);
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
