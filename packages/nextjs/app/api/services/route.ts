import { NextResponse } from "next/server";
import deployedContracts from "~~/contracts/deployedContracts";
import { BASE_NETWORK, PAYMENT_ADDRESS, getContractPriceUsd } from "~~/lib/x402";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address;

export async function GET() {
  // Contract is 1-indexed. IDs 1-9 exist on-chain.
  const [consultQuick, consultDeep, pfp, audit, qa, build, research, judge] = await Promise.all([
    getContractPriceUsd(1),
    getContractPriceUsd(2),
    getContractPriceUsd(3),
    getContractPriceUsd(4),
    getContractPriceUsd(5),
    getContractPriceUsd(6),
    getContractPriceUsd(7),
    getContractPriceUsd(8),
  ]);

  return NextResponse.json({
    name: "LeftClaw Services",
    description:
      "AI Ethereum builder bots for hire. Pay with USDC on Base via x402 protocol. Workers: leftclaw.eth, rightclaw.eth, clawdheart.eth, clawdgut.eth.",
    contract: CONTRACT_ADDRESS,
    network: BASE_NETWORK,
    payTo: PAYMENT_ADDRESS,
    x402: true,
    services: [
      {
        endpoint: "/api/consult/quick",
        method: "POST",
        name: "Quick Consultation",
        description: "A focused 15-message chat session about your idea. Returns a written build plan.",
        price: consultQuick,
        responseType: "session",
      },
      {
        endpoint: "/api/consult/deep",
        method: "POST",
        name: "Deep Consultation",
        description: "A deep-dive chat on complex architecture, protocol design, or strategy.",
        price: consultDeep,
        responseType: "session",
      },
      {
        endpoint: "/api/qa",
        method: "POST",
        name: "Frontend QA Audit",
        description: "Pre-ship dApp quality audit. Send your dApp URL or contract address.",
        price: qa,
        responseType: "session",
      },
      {
        endpoint: "/api/audit",
        method: "POST",
        name: "Smart Contract Audit",
        description:
          "Security review of a smart contract. Send contract address (verified on Basescan/Etherscan) or source code.",
        price: audit,
        responseType: "session",
      },
      {
        endpoint: "/api/pfp",
        method: "POST",
        name: "CLAWD PFP Generator",
        description:
          "Custom CLAWD mascot profile picture. Describe how to modify the character, get a 1024x1024 PNG inline.",
        price: pfp,
        responseType: "inline",
      },
      {
        endpoint: "/api/build",
        method: "POST",
        name: "Build",
        description: "A dedicated build session. LeftClaw builds and ships your plan.",
        price: build,
        responseType: "session",
      },
      {
        endpoint: "/api/research",
        method: "POST",
        name: "Research Report",
        description: "Comprehensive research on a protocol, topic, or codebase.",
        price: research,
        responseType: "session",
      },
      {
        endpoint: "/api/judge",
        method: "POST",
        name: "Judge / Oracle",
        description: "Impartial evaluation of disputes, design decisions, or architecture choices.",
        price: judge,
        responseType: "session",
      },
    ],
    clientExample: {
      note: "Use @x402/fetch for automatic payment handling",
      install: "npm install @x402/core @x402/evm @x402/fetch",
      code: `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";\nimport { ExactEvmScheme } from "@x402/evm";\nimport { privateKeyToAccount } from "viem/accounts";\n\nconst account = privateKeyToAccount("0xYourPrivateKey");\nconst fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {\n  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],\n});\n\n// Consult/QA/Audit → returns a chat session\nconst res = await fetchWithPayment("https://leftclaw.services/api/consult/quick", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ description: "I want to build a token dashboard" }),\n});\nconst { sessionId, chatUrl } = await res.json();\n// Visit chatUrl to start your session\n\n// PFP → returns image inline\nconst pfp = await fetchWithPayment("https://leftclaw.services/api/pfp", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ prompt: "wearing a cowboy hat" }),\n});\nconst { image } = await pfp.json();\n// image → "data:image/png;base64,..."`,
    },
  });
}
