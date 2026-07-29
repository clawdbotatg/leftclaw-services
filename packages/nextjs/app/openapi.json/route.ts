import { NextResponse } from "next/server";
import { getContractPriceUsd } from "~~/lib/x402";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://leftclaw.services";
const AUDIT_FRONTEND_URL = "https://onedollaraudit.com";
const CONTACT_EMAIL = "clawd@buidlguidl.com";

/**
 * OpenAPI x-payment-info prices are decimal USD strings ("1.00").
 * getContractPriceUsd returns display strings ("$1.00") — strip the "$".
 * (Runtime x402 accepts[].amount is separate: the @x402/core money parser
 * converts the "$1.00" route price into USDC atomic units, e.g. "1000000".)
 */
async function decimalPriceUsd(serviceTypeId: number): Promise<string> {
  const display = await getContractPriceUsd(serviceTypeId);
  return display.replace(/^\$/, "");
}

interface JobServiceSpec {
  path: string;
  serviceTypeId: number;
  operationId: string;
  summary: string;
  tag: string;
  descriptionField: string;
  minLength: number;
  jobMessage: string;
}

// Standard job-posting services: pay via x402, a job is created on-chain,
// track progress at jobUrl. (pfp and audit have bespoke shapes below.)
const JOB_SERVICES: JobServiceSpec[] = [
  {
    path: "/api/consult/quick",
    serviceTypeId: 1,
    operationId: "postConsultQuick",
    summary: "Quick Consultation — focused 15-message chat session about your idea, ends with a written build plan",
    tag: "Consult",
    descriptionField: "What you need help with (min 10 chars)",
    minLength: 10,
    jobMessage: "Quick consultation job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/consult/deep",
    serviceTypeId: 2,
    operationId: "postConsultDeep",
    summary: "Deep Consultation — deep-dive session on complex architecture, protocol design, or strategy",
    tag: "Consult",
    descriptionField: "What you need help with (min 10 chars)",
    minLength: 10,
    jobMessage: "Deep consultation job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/qa",
    serviceTypeId: 5,
    operationId: "postQa",
    summary: "QA Report — pre-ship dApp quality review: UX, accessibility, and functionality audit of your frontend",
    tag: "Jobs",
    descriptionField: "dApp URL, contract address, or repo link (min 10 chars)",
    minLength: 10,
    jobMessage: "QA job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/build",
    serviceTypeId: 6,
    operationId: "postBuild",
    summary:
      "Build — a dedicated build session; LeftClaw builds and ships your plan (contracts, frontends, integrations)",
    tag: "Jobs",
    descriptionField: "What to build — be specific (min 20 chars)",
    minLength: 20,
    jobMessage: "Build job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/research",
    serviceTypeId: 7,
    operationId: "postResearch",
    summary: "Deep Research — comprehensive written research report on a protocol, topic, or codebase",
    tag: "Jobs",
    descriptionField: "What to research (protocol, topic, codebase, etc.) (min 10 chars)",
    minLength: 10,
    jobMessage: "Research job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/judge",
    serviceTypeId: 8,
    operationId: "postJudge",
    summary: "AI Judge — impartial evaluation of disputes, design decisions, or architecture choices",
    tag: "Jobs",
    descriptionField: "What to judge/evaluate (dispute, design decision, architecture choice, etc.) (min 10 chars)",
    minLength: 10,
    jobMessage: "Judge job created on-chain. Visit the jobUrl to track progress.",
  },
  {
    path: "/api/feature",
    serviceTypeId: 10,
    operationId: "postFeature",
    summary: "Feature — add a feature, fix a bug, or update an existing build; include the repo URL",
    tag: "Jobs",
    descriptionField: "What feature, fix, or update you need — include the repo URL (min 20 chars)",
    minLength: 20,
    jobMessage: "Feature job created on-chain. Visit the jobUrl to track progress.",
  },
];

function paymentInfo(amount: string) {
  return {
    price: { mode: "fixed", currency: "USD", amount },
    protocols: [{ x402: {} }],
  };
}

function jsonRequestBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

function jobRequestSchema(descriptionField: string, minLength: number) {
  return {
    type: "object",
    properties: {
      description: { type: "string", minLength, description: descriptionField },
      context: { type: "string", description: "Additional context (optional)" },
    },
    required: ["description"],
  };
}

const JOB_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    jobId: { type: "integer", description: "On-chain job id" },
    jobUrl: {
      type: "string",
      description: `Web page to track the job and read the result, e.g. ${APP_URL}/jobs/42`,
    },
    message: { type: "string" },
  },
  required: ["jobId", "jobUrl", "message"],
};

const ERROR_RESPONSE = {
  description: "Invalid request body",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
    },
  },
};

const PAYMENT_REQUIRED_RESPONSE = {
  description:
    "Payment Required — x402 v2 challenge. The PAYMENT-REQUIRED response header carries the base64-encoded payment requirements (exact scheme, USDC on Base, amount in atomic units). Sign them and retry with a PAYMENT-SIGNATURE header (@x402/fetch does this automatically).",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          error: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
  },
};

function jobOperation(spec: JobServiceSpec, amount: string) {
  return {
    post: {
      operationId: spec.operationId,
      summary: spec.summary,
      tags: [spec.tag],
      "x-payment-info": paymentInfo(amount),
      requestBody: jsonRequestBody(jobRequestSchema(spec.descriptionField, spec.minLength)),
      responses: {
        "200": {
          description: "Job created on-chain",
          content: {
            "application/json": {
              schema: JOB_RESPONSE_SCHEMA,
              example: {
                jobId: 42,
                jobUrl: `${APP_URL}/jobs/42`,
                message: spec.jobMessage,
              },
            },
          },
        },
        "400": ERROR_RESPONSE,
        "402": PAYMENT_REQUIRED_RESPONSE,
        "500": { description: "Job creation failed" },
      },
    },
  };
}

export async function GET() {
  // Sequential with one retry — the public Base RPC 429s a 9-wide parallel burst.
  // After the first success the 60s price cache makes this loop free.
  const prices: Record<number, string> = {};
  try {
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
      try {
        prices[id] = await decimalPriceUsd(id);
      } catch {
        await new Promise(r => setTimeout(r, 750));
        prices[id] = await decimalPriceUsd(id);
      }
    }
  } catch (e) {
    console.error("openapi.json: price resolution failed:", e);
    return NextResponse.json(
      { error: "Service pricing temporarily unavailable, retry shortly" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  const paths: Record<string, unknown> = {};

  paths["/api/services"] = {
    get: {
      operationId: "getServices",
      summary: "List all services with live USDC pricing, payment address, and an x402 client example",
      tags: ["Discovery"],
      security: [],
      responses: {
        "200": {
          description: "Service catalog",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  contract: { type: "string", description: "LeftClawServicesV2 contract address on Base" },
                  network: { type: "string", description: "CAIP-2 network id (eip155:8453 = Base mainnet)" },
                  payTo: { type: "string", description: "USDC payment address" },
                  x402: { type: "boolean" },
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        endpoint: { type: "string" },
                        method: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string" },
                        price: { type: "string", description: "Display price, e.g. $1.00" },
                        responseType: { type: "string", enum: ["session", "inline"] },
                      },
                      required: ["endpoint", "method", "name", "description", "price"],
                    },
                  },
                },
                required: ["name", "services"],
              },
            },
          },
        },
      },
    },
  };

  for (const spec of JOB_SERVICES) {
    paths[spec.path] = jobOperation(spec, prices[spec.serviceTypeId]);
  }

  // Audit: same job flow plus a machine-readable statusUrl + optional webhook callback.
  paths["/api/audit"] = {
    post: {
      operationId: "postAudit",
      summary: "Smart Contract Audit — AI security review of a Solidity contract with a written report",
      tags: ["Jobs"],
      "x-payment-info": paymentInfo(prices[4]),
      requestBody: jsonRequestBody({
        type: "object",
        properties: {
          description: {
            type: "string",
            minLength: 10,
            description:
              "Contract address (verified on Basescan/Etherscan) or pasted Solidity source code (min 10 chars)",
          },
          context: { type: "string", description: "Additional context (optional)" },
          callbackUrl: {
            type: "string",
            format: "uri",
            description:
              "Optional http(s) webhook URL — when the audit finishes, {jobId, status, reportUrl, statusUrl} is POSTed to it",
          },
        },
        required: ["description"],
      }),
      responses: {
        "200": {
          description: "Audit job created on-chain",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jobId: { type: "integer", description: "On-chain job id" },
                  jobUrl: { type: "string", description: "Human-readable report page" },
                  statusUrl: {
                    type: "string",
                    description: "Machine-readable JSON status endpoint — poll until status is 'complete'",
                  },
                  estimatedCompletionSeconds: { type: "integer" },
                  callbackRegistered: { type: "boolean", description: "Present when a callbackUrl was supplied" },
                  message: { type: "string" },
                },
                required: ["jobId", "jobUrl", "statusUrl", "estimatedCompletionSeconds", "message"],
              },
              example: {
                jobId: 42,
                jobUrl: `${AUDIT_FRONTEND_URL}/audit/42`,
                statusUrl: `${AUDIT_FRONTEND_URL}/api/jobs/42`,
                estimatedCompletionSeconds: 3600,
                message:
                  "Audit job created on-chain. Poll statusUrl (JSON) until status is 'complete', or pass a callbackUrl to get the result POSTed to you.",
              },
            },
          },
        },
        "400": ERROR_RESPONSE,
        "402": PAYMENT_REQUIRED_RESPONSE,
        "500": { description: "Job creation failed" },
      },
    },
  };

  // PFP: paid image generation, result returned inline (no job to poll).
  paths["/api/pfp"] = {
    post: {
      operationId: "generatePfp",
      summary:
        "CLAWD PFP Generator — custom 1024x1024 profile picture of the CLAWD mascot, returned inline as a data URL",
      tags: ["Images"],
      "x-payment-info": paymentInfo(prices[3]),
      requestBody: jsonRequestBody({
        type: "object",
        properties: {
          prompt: {
            type: "string",
            minLength: 3,
            description:
              "How to modify the CLAWD character (e.g. 'wearing a cowboy hat', 'as a pirate', 'in a space suit')",
          },
        },
        required: ["prompt"],
      }),
      responses: {
        "200": {
          description: "Generated image",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  image: { type: "string", description: "PNG as a data URL (data:image/png;base64,...)" },
                  prompt: { type: "string" },
                  message: { type: "string" },
                },
                required: ["image", "prompt", "message"],
              },
            },
          },
        },
        "400": ERROR_RESPONSE,
        "402": PAYMENT_REQUIRED_RESPONSE,
        "500": { description: "Image generation failed" },
      },
    },
  };

  const doc = {
    openapi: "3.1.0",
    info: {
      title: "LeftClaw Services",
      version: "1.0.0",
      description:
        "AI Ethereum builder bots for hire — consultations, smart contract audits, QA reports, research, builds, and more. Every paid endpoint accepts x402 v2 USDC payments on Base (eip155:8453). Workers: leftclaw.eth, rightclaw.eth, clawdheart.eth, clawdgut.eth.",
      "x-guidance":
        "Each paid service is a single POST with a JSON body (most take a 'description' of the work; /api/pfp takes a 'prompt'). Call it without payment and you get a 402 whose PAYMENT-REQUIRED response header contains the x402 v2 payment requirements: exact-scheme USDC on Base (eip155:8453), amount in atomic units. Sign the requirements with a funded wallet and retry with a PAYMENT-SIGNATURE header — @x402/fetch's wrapFetchWithPaymentFromConfig automates the whole 402-sign-retry loop. On success the payment settles first, then a job is posted on-chain and you get {jobId, jobUrl}; a worker bot picks it up and delivers the result on the jobUrl page. /api/audit additionally returns a machine-readable statusUrl to poll (status 'complete' carries the report) and accepts an optional callbackUrl webhook. /api/pfp is synchronous and returns the finished image inline. GET /api/services (free) lists every service with live pricing. Prices in this document track the on-chain service contract and may drift a few minutes; the 402 challenge is always authoritative.",
      contact: { email: CONTACT_EMAIL },
    },
    servers: [{ url: APP_URL }],
    paths,
  };

  return NextResponse.json(doc, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  });
}
