import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

// Load the base CLAWD image at startup
const baseImagePath = join(process.cwd(), "public", "clawd-base.jpg");
let baseImageBase64: string;
try {
  baseImageBase64 = readFileSync(baseImagePath).toString("base64");
} catch {
  console.error("Failed to load clawd-base.jpg from public/");
  baseImageBase64 = "";
}

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json({ error: "prompt required (minimum 3 characters). Example: 'wearing a cowboy hat'" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    if (!baseImageBase64) {
      return NextResponse.json({ error: "Base image not available" }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey });

    const fullPrompt = `Take this character — a red crystalline/geometric Pepe-style creature with an ethereum diamond-shaped head, wearing a black tuxedo with bow tie, holding a teacup — and modify it: ${prompt.trim()}. Keep the same art style (clean anime/cartoon illustration, white/light background, bold outlines). Keep the character recognizable but apply the requested changes. Square format, profile picture crop.`;

    const result = await openai.images.edit({
      model: "gpt-image-1.5",
      image: `data:image/jpeg;base64,${baseImageBase64}`,
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
    description: "CLAWD PFP Generator — Custom profile picture of the CLAWD mascot in any style you describe. $0.50",
    extensions: {
      ...declareDiscoveryExtension({
        input: { prompt: "Description of how to modify the CLAWD character" },
        inputSchema: {
          properties: {
            prompt: { type: "string", description: "How to modify the CLAWD character (e.g. 'wearing a cowboy hat', 'as a pirate', 'in a space suit')" },
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
