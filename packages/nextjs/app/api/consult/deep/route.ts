import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createSession } from "~~/lib/sessionStore";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw-services-nextjs.vercel.app";

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json({ error: "Description required (minimum 10 characters)" }, { status: 400 });
    }

    const session = await createSession({
      serviceType: "CONSULT_DEEP",
      description: description.trim(),
      context: context?.trim(),
      priceUsd: "$30",
    });

    return NextResponse.json({
      sessionId: session.id,
      chatUrl: `${APP_URL}/chat/x402/${session.id}`,
      status: "active",
      expiresAt: session.expiresAt,
      maxMessages: session.maxMessages,
      message: "Deep consultation session created. Follow the chatUrl to begin.",
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
};

export const POST = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      price: SERVICE_PRICES.CONSULT_DEEP,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "Deep Consultation — 30-message deep-dive on architecture, protocol design, or strategy",
    extensions: {
      ...declareDiscoveryExtension({
        input: { description: "What you need help with", context: "optional context" },
        inputSchema: {
          properties: {
            description: { type: "string", description: "What you need help with (min 10 chars)" },
            context: { type: "string", description: "Additional context (optional)" },
          },
          required: ["description"],
        },
        bodyType: "json",
        output: {
          example: {
            sessionId: "x402_abc123",
            chatUrl: "https://leftclaw-services-nextjs.vercel.app/chat/x402/x402_abc123",
            status: "active",
            expiresAt: "2026-03-06T10:00:00.000Z",
            maxMessages: 30,
          },
        },
      }),
    },
  },
  x402Server,
);
