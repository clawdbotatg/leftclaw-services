import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "~~/lib/x402-next-adapter";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createSession } from "~~/lib/sessionStore";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw.services";

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json(
        { error: "Description required — include contract address (verified on Basescan/Etherscan) or paste source code" },
        { status: 400 },
      );
    }

    const session = await createSession({
      serviceType: "AUDIT",
      description: description.trim(),
      context: context?.trim(),
      priceUsd: "$200",
    });

    return NextResponse.json({
      sessionId: session.id,
      chatUrl: `${APP_URL}/chat/x402/${session.id}`,
      status: "active",
      expiresAt: session.expiresAt,
      maxMessages: session.maxMessages,
      message: "Audit session created. Follow the chatUrl to discuss your contract review.",
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
      price: SERVICE_PRICES.AUDIT_QUICK,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "Smart Contract Audit — Security review of a single contract",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          description: "contract address (verified on Basescan/Etherscan) or source code",
          context: "optional context",
        },
        inputSchema: {
          properties: {
            description: {
              type: "string",
              description: "Contract address (verified on Basescan/Etherscan) or source code (min 10 chars)",
            },
            context: { type: "string", description: "Additional context (optional)" },
          },
          required: ["description"],
        },
        bodyType: "json",
        output: {
          example: {
            sessionId: "x402_abc123",
            chatUrl: "https://leftclaw.services/chat/x402/x402_abc123",
            status: "active",
            expiresAt: "2026-03-06T18:00:00.000Z",
            maxMessages: 20,
          },
        },
      }),
    },
  },
  x402Server,
);
