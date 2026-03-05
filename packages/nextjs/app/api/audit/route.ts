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
        {
          error:
            "Description required — include contract address (verified on Basescan/Etherscan) or paste source code",
        },
        { status: 400 },
      );
    }

    const job = createJob({
      serviceType: "AUDIT_QUICK",
      description: description.trim(),
      context: context?.trim(),
      priceUsd: "$200",
    });

    return NextResponse.json({
      jobId: job.id,
      status: "queued",
      message: "Smart contract audit queued. A worker bot will review your contract.",
      poll: `/api/job/${job.id}`,
      estimatedTime: "1-3 hours",
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
  },
  x402Server,
);
