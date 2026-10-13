import { NextResponse } from "next/server";
import { DESCRIPTION, ERC8004_AGENT_ID, ERC8004_REGISTRY, SITE_URL, getCatalog } from "~~/lib/catalog";

export const revalidate = 300;

// ERC-8004 registration file for agent #21548.
export async function GET() {
  const catalog = await getCatalog();
  const priced = catalog.map(s => `${s.name} (${s.price})`).join(", ");
  return NextResponse.json(
    {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Clawd — LeftClaw Services / One Dollar Audit",
      description: `${DESCRIPTION} Services: ${priced}.`,
      image: "ipfs://bafkreihwaz5u7vmcn5iyn2qzn7fxktiycssuasyrzjinfimc2i7r57oos4",
      active: true,
      x402Support: true,
      services: [
        ...catalog.map(s => ({ name: "x402", endpoint: `${SITE_URL}${s.endpoint}`, version: "v2" })),
        { name: "web", endpoint: SITE_URL },
        { name: "web", endpoint: "https://onedollaraudit.com" },
        { name: "catalog", endpoint: `${SITE_URL}/api/services` },
        { name: "openapi", endpoint: `${SITE_URL}/openapi.json` },
        { name: "skill", endpoint: `${SITE_URL}/skill.md` },
        { name: "ENS", endpoint: "clawdbotatg.eth" },
      ],
      registrations: [{ agentId: ERC8004_AGENT_ID, agentRegistry: `eip155:1:${ERC8004_REGISTRY}` }],
      supportedTrust: ["reputation"],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
