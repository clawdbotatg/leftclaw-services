import { NextRequest, NextResponse } from "next/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { isValidCallbackUrl, registerJobWebhook } from "~~/lib/jobWebhooks";
import { postJobForOnChain } from "~~/lib/postJobFor";
import { BASE_NETWORK, PAYMENT_ADDRESS, getContractPriceUsd, x402Server } from "~~/lib/x402";
import { withX402DynamicSettleFirst } from "~~/lib/x402-next-adapter";

// onedollaraudit.com reads the chain directly, so its pages/API work the moment
// the job tx confirms — the leftclaw.services /jobs/<id> page can lag a bit.
const AUDIT_FRONTEND_URL = "https://onedollaraudit.com";
const ESTIMATED_COMPLETION_SECONDS = 3600;

const handler = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const { description, context, callbackUrl } = body;

    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return NextResponse.json(
        {
          error:
            "Description required — include contract address (verified on Basescan/Etherscan) or paste source code",
        },
        { status: 400 },
      );
    }

    if (callbackUrl !== undefined && !isValidCallbackUrl(callbackUrl)) {
      return NextResponse.json({ error: "callbackUrl must be an http(s) URL" }, { status: 400 });
    }

    const fullDescription = context?.trim()
      ? `${description.trim()}\n\nContext: ${context.trim()}`
      : description.trim();

    const jobId = await postJobForOnChain(4, fullDescription);

    let callbackRegistered = false;
    if (callbackUrl) {
      try {
        callbackRegistered = await registerJobWebhook(jobId, callbackUrl);
      } catch (e) {
        console.error(`Audit route: webhook registration failed for job ${jobId}:`, e);
      }
    }

    return NextResponse.json({
      jobId,
      jobUrl: `${AUDIT_FRONTEND_URL}/audit/${jobId}`,
      statusUrl: `${AUDIT_FRONTEND_URL}/api/jobs/${jobId}`,
      estimatedCompletionSeconds: ESTIMATED_COMPLETION_SECONDS,
      ...(callbackUrl ? { callbackRegistered } : {}),
      message:
        "Audit job created on-chain. Poll statusUrl (JSON) until status is 'complete', or pass a callbackUrl to get the result POSTed to you.",
    });
  } catch (e: any) {
    console.error("Audit route error:", e);
    return NextResponse.json({ error: e.message || "Failed to create job" }, { status: 500 });
  }
};

export const POST = withX402DynamicSettleFirst(
  handler,
  price => ({
    accepts: {
      scheme: "exact",
      price,
      network: BASE_NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "Smart Contract Audit — Security review of a single contract",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          description: "contract address (verified on Basescan/Etherscan) or source code",
          context: "optional context",
          callbackUrl: "optional webhook URL — completed report is POSTed to it",
        },
        inputSchema: {
          properties: {
            description: {
              type: "string",
              description: "Contract address (verified on Basescan/Etherscan) or source code (min 10 chars)",
            },
            context: { type: "string", description: "Additional context (optional)" },
            callbackUrl: {
              type: "string",
              description:
                "Optional https URL — when the job finishes, {jobId, status, reportUrl, statusUrl} is POSTed to it",
            },
          },
          required: ["description"],
        },
        bodyType: "json",
        output: {
          example: {
            jobId: 42,
            jobUrl: "https://onedollaraudit.com/audit/42",
            statusUrl: "https://onedollaraudit.com/api/jobs/42",
            estimatedCompletionSeconds: 3600,
            message:
              "Audit job created on-chain. Poll statusUrl (JSON) until status is 'complete', or pass a callbackUrl to get the result POSTed to you.",
          },
        },
      }),
    },
  }),
  () => getContractPriceUsd(4),
  x402Server,
);
