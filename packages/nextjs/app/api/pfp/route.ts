import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "~~/lib/x402-next-adapter";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import OpenAI, { toFile } from "openai";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";

// Cache the base image buffer in memory after first fetch
let baseImageCache: Buffer | null = null;

async function getBaseImage(): Promise<Buffer> {
  if (baseImageCache) return baseImageCache;

  // Try filesystem first (works in dev), fall back to HTTP fetch (works on Vercel)
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    baseImageCache = readFileSync(join(process.cwd(), "public", "clawd-base.jpg"));
    return baseImageCache;
  } catch {
    // Fetch from public URL on Vercel
    const res = await fetch(`${APP_URL}/clawd-base.jpg`);
    if (!res.ok) throw new Error("Failed to fetch base image");
    baseImageCache = Buffer.from(await res.arrayBuffer());
    return baseImageCache;
  }
}

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json(
        { error: "prompt required (minimum 3 characters). Example: 'wearing a cowboy hat'" },
        { status: 400 },
      );
    }

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
      message: "🦞 Your custom CLAWD PFP is ready!",
    });
  } catch (e) {
    console.error("PFP generation error:", e);
    return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
  }
};

export const POST = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      price: SERVICE_PRICES.PFP_GENERATE,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description:
      "CLAWD PFP Generator — Custom profile picture of the CLAWD mascot in any style you describe. $0.50",
    extensions: {
      ...declareDiscoveryExtension({
        input: { prompt: "Description of how to modify the CLAWD character" },
        inputSchema: {
          properties: {
            prompt: {
              type: "string",
              description:
                "How to modify the CLAWD character (e.g. 'wearing a cowboy hat', 'as a pirate', 'in a space suit')",
            },
          },
          required: ["prompt"],
        },
        bodyType: "json",
        output: {
          example: {
            image: "data:image/png;base64,...",
            prompt: "wearing a cowboy hat",
            message: "🦞 Your custom CLAWD PFP is ready!",
          },
        },
      }),
    },
  },
  x402Server,
);
