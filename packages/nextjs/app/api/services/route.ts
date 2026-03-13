import { NextResponse } from "next/server";
import { BASE_NETWORK, PAYMENT_ADDRESS, SERVICE_PRICES } from "~~/lib/x402";

export async function GET() {
  return NextResponse.json({
    name: "LeftClaw Services",
    description:
      "AI Ethereum builder bots for hire. Pay with USDC on Base via x402 protocol. Workers: leftclaw.eth, rightclaw.eth, clawdheart.eth, clawdgut.eth.",
    contract: "0x24620a968985F97ED9422b7EDFf5970F07906cB7",
    network: BASE_NETWORK,
    payTo: PAYMENT_ADDRESS,
    x402: true,
    services: [
      {
        endpoint: "/api/consult/quick",
        method: "POST",
        name: "Quick Consultation",
        description: "A focused 15-message chat session about your idea. Returns a written build plan.",
        price: SERVICE_PRICES.CONSULT_QUICK,
        responseType: "async",
      },
      {
        endpoint: "/api/consult/deep",
        method: "POST",
        name: "Deep Consultation",
        description: "A 30-message deep-dive on complex architecture, protocol design, or strategy.",
        price: SERVICE_PRICES.CONSULT_DEEP,
        responseType: "async",
      },
      {
        endpoint: "/api/qa",
        method: "POST",
        name: "QA Report",
        description: "Pre-ship dApp quality audit. Send your dApp URL or contract address.",
        price: SERVICE_PRICES.QA_REPORT,
        responseType: "async",
      },
      {
        endpoint: "/api/audit",
        method: "POST",
        name: "Smart Contract Audit",
        description:
          "Security review of a smart contract. Send contract address (verified on Basescan/Etherscan) or source code.",
        price: SERVICE_PRICES.AUDIT_QUICK,
        responseType: "async",
      },
    ],
    polling: {
      endpoint: "/api/job/{jobId}",
      method: "GET",
      description: "Poll for job status and results (free, no payment required)",
    },
    clientExample: {
      note: "Use @x402/fetch for automatic payment handling",
      install: "npm install @x402/core @x402/evm @x402/fetch",
      code: `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";\nimport { ExactEvmScheme } from "@x402/evm";\nimport { privateKeyToAccount } from "viem/accounts";\n\nconst account = privateKeyToAccount("0xYourPrivateKey");\nconst fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {\n  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],\n});\n\nconst response = await fetchWithPayment("https://leftclaw.services/api/consult/quick", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ description: "I want to build a token dashboard" }),\n});\nconst { jobId } = await response.json();\n// Poll /api/job/{jobId} for results`,
    },
  });
}
