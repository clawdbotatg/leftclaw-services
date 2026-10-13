import { NextResponse } from "next/server";
import { BASE_NETWORK, CONTRACT_ADDRESS, DESCRIPTION, PAYMENT_ADDRESS, getCatalog } from "~~/lib/catalog";

export async function GET() {
  const catalog = await getCatalog();

  return NextResponse.json({
    name: "LeftClaw Services",
    description: DESCRIPTION,
    contract: CONTRACT_ADDRESS,
    network: BASE_NETWORK,
    payTo: PAYMENT_ADDRESS,
    x402: true,
    services: catalog.map(s => ({
      endpoint: s.endpoint,
      method: "POST",
      name: s.name,
      description: s.description,
      price: s.price,
      responseType: s.responseType,
    })),
    clientExample: {
      note: "Use @x402/fetch for automatic payment handling",
      install: "npm install @x402/core @x402/evm @x402/fetch",
      code: `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";\nimport { ExactEvmScheme } from "@x402/evm";\nimport { privateKeyToAccount } from "viem/accounts";\n\nconst account = privateKeyToAccount("0xYourPrivateKey");\nconst fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {\n  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],\n});\n\n// Consult/QA/Audit → returns a chat session\nconst res = await fetchWithPayment("https://leftclaw.services/api/consult/quick", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ description: "I want to build a token dashboard" }),\n});\nconst { sessionId, chatUrl } = await res.json();\n// Visit chatUrl to start your session\n\n// PFP → returns image inline\nconst pfp = await fetchWithPayment("https://leftclaw.services/api/pfp", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ prompt: "wearing a cowboy hat" }),\n});\nconst { image } = await pfp.json();\n// image → "data:image/png;base64,..."`,
    },
  });
}
