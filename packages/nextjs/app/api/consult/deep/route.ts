import { NextRequest, NextResponse } from "next/server";
import { withX402DynamicSettleFirst } from "~~/lib/x402-next-adapter";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { postJobForOnChain } from "~~/lib/postJobFor";
import { BASE_NETWORK, PAYMENT_ADDRESS, getContractPriceUsd, x402Server } from "~~/lib/x402";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw.services";

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json({ error: "Description required (minimum 10 characters)" }, { status: 400 });
    }

    const fullDescription = context?.trim()
      ? `${description.trim()}\n\nContext: ${context.trim()}`
      : description.trim();

    const jobId = await postJobForOnChain(2, fullDescription);

    return NextResponse.json({
      jobId,
      jobUrl: `${APP_URL}/jobs/${jobId}`,
      message: "Deep consultation job created on-chain. Visit the jobUrl to track progress.",
    });
  } catch (e: any) {
    console.error("Consult deep route error:", e);
    return NextResponse.json({ error: e.message || "Failed to create job" }, { status: 500 });
  }
};

export const POST = withX402DynamicSettleFirst(
  handler,
  (price) => ({
    accepts: {
      scheme: "exact",
      price,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "Deep Consultation — deep-dive on architecture, protocol design, or strategy",
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
            jobId: 42,
            jobUrl: "https://leftclaw.services/jobs/42",
            message: "Deep consultation job created on-chain. Visit the jobUrl to track progress.",
          },
        },
      }),
    },
  }),
  () => getContractPriceUsd(2),
  x402Server,
);
