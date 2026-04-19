import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
import OpenAI, { toFile } from "openai";
import { createPublicClient, http, parseAbi, verifyMessage } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const CV_SPEND_SECRET = process.env.CV_SPEND_SECRET || "";
const CV_SPEND_URL = "https://larv.ai/api/cv/spend";
const CV_HIGHEST_URL = "https://larv.ai/api/cv/highest";
const CV_SIGN_MESSAGE = "larv.ai CV Spend";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";
const PFP_SERVICE_TYPE_ID = 3;

const SERVICE_TYPE_ABI = parseAbi([
  "function getServiceType(uint256 id) view returns ((uint256 id, string name, string slug, uint256 priceUsd, uint256 cvDivisor, string status))",
]);
const SERVICE_TYPE_CONTRACT = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;

// Matches the UI formula in useCVCost: ceil((highestCVBalance / 5) / cvDivisor)
async function computePfpCvCost(): Promise<number> {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
  const [svc, highestRes] = await Promise.all([
    client.readContract({
      address: SERVICE_TYPE_CONTRACT,
      abi: SERVICE_TYPE_ABI,
      functionName: "getServiceType",
      args: [BigInt(PFP_SERVICE_TYPE_ID)],
    }),
    fetch(CV_HIGHEST_URL).then(r => r.json()),
  ]);
  const cvDivisor = Number(svc.cvDivisor);
  const highest = Number(highestRes?.highestCVBalance);
  if (!cvDivisor || !highest || !isFinite(highest)) throw new Error("Failed to compute CV cost");
  return Math.ceil((highest / 5) / cvDivisor);
}

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

export async function POST(req: NextRequest) {
  try {
    const { prompt, wallet, signature } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3)
      return NextResponse.json({ error: "Prompt required (minimum 3 characters)" }, { status: 400 });
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
      return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
    if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature))
      return NextResponse.json({ error: "Valid signature required" }, { status: 400 });

    const valid = await verifyMessage({
      address: wallet as `0x${string}`,
      message: CV_SIGN_MESSAGE,
      signature: signature as `0x${string}`,
    });
    if (!valid)
      return NextResponse.json({ error: "Invalid signature — sign the message with your wallet" }, { status: 403 });

    let cvCost: number;
    try {
      cvCost = await computePfpCvCost();
    } catch (e) {
      console.error("Failed to compute PFP CV cost", e);
      return NextResponse.json({ error: "Unable to determine CV cost right now — try again in a moment" }, { status: 503 });
    }

    const spendRes = await fetch(CV_SPEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, signature, secret: CV_SPEND_SECRET, amount: cvCost }),
    });
    const spendData = await spendRes.json();

    if (!spendRes.ok || !spendData.success) {
      const status = spendRes.status === 402 ? 402 : spendRes.status === 404 ? 404 : 400;
      return NextResponse.json(
        { error: spendData.error || "CV spend failed", ...(spendData.balance !== undefined ? { currentBalance: spendData.balance } : {}), required: cvCost },
        { status }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });

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
    if (!imageData?.b64_json)
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });

    return NextResponse.json({
      image: `data:image/png;base64,${imageData.b64_json}`,
      prompt: prompt.trim(),
      cvSpent: cvCost,
      newBalance: spendData.newBalance,
      message: "🦞 Your custom CLAWD PFP is ready! Paid with ClawdViction.",
    });
  } catch (e: any) {
    console.error("PFP generate-cv error:", e);
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
