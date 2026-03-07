import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { verifyPayment, PaymentMethod } from "~~/lib/payments";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";

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
    const { prompt, method, wallet, signature, txHash } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json({ error: "Prompt required (minimum 3 characters)" }, { status: 400 });
    }

    const paymentMethod = (method || "cv") as PaymentMethod;

    // Verify payment via unified system
    const result = await verifyPayment("PFP_GENERATE", {
      method: paymentMethod,
      wallet,
      signature,
      txHash,
    });

    if (!result.success) {
      const status = result.error?.includes("insufficient") ? 402 : 400;
      return NextResponse.json({ error: result.error, ...result.details }, { status });
    }

    // Payment verified — generate PFP
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const baseImageBuffer = await getBaseImage();
    const openai = new OpenAI({ apiKey });

    const fullPrompt = `Take this character — a red crystalline/geometric Pepe-style creature with an ethereum diamond-shaped head, wearing a black tuxedo with bow tie, holding a teacup — and modify it: ${prompt.trim()}. Keep the same art style (clean anime/cartoon illustration, white/light background, bold outlines). Keep the character recognizable but apply the requested changes. Square format, profile picture crop.`;

    const imageFile = await toFile(baseImageBuffer, "clawd-base.jpg", { type: "image/jpeg" });

    const genResult = await openai.images.edit({
      model: "gpt-image-1.5",
      image: imageFile,
      prompt: fullPrompt,
      n: 1,
      size: "1024x1024",
    });

    const imageData = genResult.data?.[0];
    if (!imageData?.b64_json) {
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    return NextResponse.json({
      image: `data:image/png;base64,${imageData.b64_json}`,
      prompt: prompt.trim(),
      payment: { method: paymentMethod, ...result.details },
      message: "🦞 Your custom CLAWD PFP is ready!",
    });
  } catch (e: any) {
    console.error("PFP generate error:", e);
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
