import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { createJob } from "~~/lib/jobStore";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES, x402Server } from "~~/lib/x402";

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json(
        { error: "Description required — include dApp URL, contract address, or repo link" },
        { status: 400 },
      );
    }

    const job = createJob({
      serviceType: "QA_REPORT",
      description: description.trim(),
      context: context?.trim(),
      priceUsd: "$50",
    });

    return NextResponse.json({
      jobId: job.id,
      status: "queued",
      message: "QA report queued. A worker bot will review your dApp.",
      poll: `/api/job/${job.id}`,
      estimatedTime: "30-60 minutes",
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
      price: SERVICE_PRICES.QA_REPORT,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "QA Report — Pre-ship dApp quality review and testing",
  },
  x402Server,
);
