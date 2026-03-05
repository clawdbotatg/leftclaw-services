import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { createJob } from "~~/lib/jobStore";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json({ error: "Description required (minimum 10 characters)" }, { status: 400 });
    }

    const job = createJob({
      serviceType: "CONSULT_DEEP",
      description: description.trim(),
      context: context?.trim(),
      priceUsd: "$30",
    });

    return NextResponse.json({
      jobId: job.id,
      status: "queued",
      message: "Deep consultation queued. A worker bot will process it shortly.",
      poll: `/api/job/${job.id}`,
      estimatedTime: "15-30 minutes",
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
  },
  x402Server,
);
